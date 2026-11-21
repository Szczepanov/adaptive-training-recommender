import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerFlag, LedgerRecord, LedgerState } from '../schema.ts';
import { PLACEMENT_FORWARD_DAYS } from '../window.ts';
import { absentRecordLine, baselinedRecordLines, CHECKIN_BASELINES, RECOVERY_BASELINES } from './baselineLines.ts';
import { dominantSource, groupLabel } from './compactLines.ts';
import { flagScopeParts } from './flagLines.ts';
import { placementBlock } from './placementBlocks.ts';
import { yesterdaySection } from './yesterdaySection.ts';

export interface TodaySections {
    lines: string[];
    /** Record ids already shown here; later sections skip them so nothing is printed twice. */
    consumedIds: ReadonlySet<string>;
    /** Fact collections whose baselined fields and 28d deltas were rendered under Today. */
    baselinedCollections: ReadonlySet<'recovery' | 'checkins'>;
}

/** `<id> <active|inactive|unknown> (<state>; definition v; session s; evaluated t)`, notes as in Flags. */
function flagsLine(flags: LedgerFlag[], date: string): string {
    const today = flags.filter(flag => flag.observedOn === date);
    if (!today.length) return `flags: none evaluated for ${text(date)}`;
    const repeats = (flag: LedgerFlag) => today.filter(other => other.id === flag.id).length > 1;
    const label = (flag: LedgerFlag) => {
        const word = flag.active === true ? 'active' : flag.active === false ? 'inactive' : 'unknown';
        const state = flag.state === 'measured' && flag.active !== null ? '' : text(flag.state);
        const notes = [state, ...flagScopeParts(flag, repeats(flag))].filter(Boolean);
        return `${word}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    };
    return `flags: ${today.map(flag => `${text(flag.id)} ${label(flag)}`).join('; ')}`;
}

/** Placement group provenance, computed over every exported placement so exceptions stay exceptions. */
function placementGroup(ledger: LedgerExport): { source: string | undefined; label: string } {
    const placements = ledger.coachingHistory.placements;
    const source = dominantSource(placements.items.flatMap(row => Object.entries(row.fields)));
    return { source, label: `placements (${groupLabel(placements.source, source)}):` };
}

const placementDate = (ledger: LedgerExport, date: string) => ledger.coachingHistory.placements.items.filter(row => row.observedOn === date);

function todayRecords(
    ledger: LedgerExport, label: string, collection: { state: LedgerState; source: string; items: LedgerRecord[] },
    derivedId: string, baselines: Readonly<Record<string, string>>, consumed: Set<string>,
): string[] {
    const rows = collection.items.filter(row => row.observedOn === ledger.asOfDate);
    if (!rows.length) return [absentRecordLine(label, ledger.asOfDate, collection.state)];
    rows.forEach(row => consumed.add(row.id));
    const group = dominantSource(collection.items.flatMap(row => Object.entries(row.fields)));
    return [`${label} (${groupLabel(collection.source, group)}):`,
        ...rows.flatMap(row => baselinedRecordLines(ledger, row, derivedId, baselines, group))];
}

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function upcomingSection(ledger: LedgerExport, consumed: Set<string>): string[] {
    const forward = PLACEMENT_FORWARD_DAYS[ledger.purpose];
    if (forward === 0) return [];
    const start = addDaysToLocalDateString(ledger.asOfDate, 1);
    const end = addDaysToLocalDateString(ledger.window.endDate, forward);
    const placements = ledger.coachingHistory.placements;
    const group = placementGroup(ledger);
    const rows = placements.items.filter(row => row.observedOn !== null && row.observedOn > ledger.asOfDate)
        .sort((a, b) => codeUnitCompare(a.observedOn ?? '', b.observedOn ?? '') || codeUnitCompare(a.id, b.id));
    rows.forEach(row => consumed.add(row.id));
    const empty = rows.length ? [] : [`placements: ${text(placements.state)}, none after ${text(ledger.asOfDate)}`];
    return [`## Upcoming (${text(start)}…${text(end)})`, ...empty, ...(rows.length ? [group.label] : []),
        ...rows.flatMap(row => placementBlock(row, group.source)), ''];
}

/** Today, Yesterday and Upcoming: what the athlete needs first; sets the ids they consumed. */
export function renderTodaySections(ledger: LedgerExport): TodaySections {
    const consumed = new Set<string>();
    const baselinedCollections = new Set<'recovery' | 'checkins'>();
    if (ledger.facts.checkins.items.some(row => row.observedOn === ledger.asOfDate)) baselinedCollections.add('checkins');
    if (ledger.facts.recovery.items.some(row => row.observedOn === ledger.asOfDate)) baselinedCollections.add('recovery');
    const group = placementGroup(ledger);
    const todays = placementDate(ledger, ledger.asOfDate);
    todays.forEach(row => consumed.add(row.id));
    const lines = [
        `## Today (${text(ledger.asOfDate)})`,
        ...todayRecords(ledger, 'check-in', ledger.facts.checkins, 'subjective_baselines', CHECKIN_BASELINES, consumed),
        ...todayRecords(ledger, 'recovery', ledger.facts.recovery, 'biometric_baselines', RECOVERY_BASELINES, consumed),
        flagsLine(ledger.flags, ledger.asOfDate),
        ...(todays.length ? [group.label, ...todays.flatMap(row => placementBlock(row, group.source))]
            : [`placements: none dated ${text(ledger.asOfDate)}`]),
        '',
        ...yesterdaySection(ledger, consumed),
        ...upcomingSection(ledger, consumed),
    ];
    return { lines, consumedIds: consumed, baselinedCollections };
}
