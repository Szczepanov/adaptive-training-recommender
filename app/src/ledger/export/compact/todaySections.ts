import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerFlag, LedgerRecord, LedgerState } from '../schema.ts';
import { PLACEMENT_FORWARD_DAYS } from '../window.ts';
import { absentRecordLine, baselinedRecordLines, CHECKIN_BASELINES, RECOVERY_BASELINES } from './baselineLines.ts';
import { placementBlock } from './placementBlocks.ts';
import { yesterdaySection } from './yesterdaySection.ts';

export interface TodaySections {
    lines: string[];
    /** Record ids already shown here; later sections skip them so nothing is printed twice. */
    consumedIds: ReadonlySet<string>;
}

function flagsLine(flags: LedgerFlag[], date: string): string {
    const today = flags.filter(flag => flag.observedOn === date);
    if (!today.length) return `flags: none evaluated for ${text(date)}`;
    const active = today.filter(flag => flag.active === true).map(flag => `${text(flag.id)} active${flag.state === 'measured' ? '' : ` (${text(flag.state)})`}`);
    const unknown = today.filter(flag => flag.active !== true && (flag.active === null || flag.state !== 'measured'))
        .map(flag => `${text(flag.id)} unknown (${text(flag.state)})`);
    return `flags: ${[...active, ...unknown].join('; ') || 'none active'}`;
}

const placementDate = (ledger: LedgerExport, date: string) => ledger.coachingHistory.placements.items.filter(row => row.observedOn === date);

function todayRecords(
    ledger: LedgerExport, label: string, collection: { state: LedgerState; items: LedgerRecord[] },
    derivedId: string, baselines: Readonly<Record<string, string>>, consumed: Set<string>,
): string[] {
    const rows = collection.items.filter(row => row.observedOn === ledger.asOfDate);
    if (!rows.length) return [absentRecordLine(label, ledger.asOfDate, collection.state)];
    rows.forEach(row => consumed.add(row.id));
    return [`${label}:`, ...rows.flatMap(row => baselinedRecordLines(ledger, row, derivedId, baselines))];
}

function upcomingSection(ledger: LedgerExport, consumed: Set<string>): string[] {
    const forward = PLACEMENT_FORWARD_DAYS[ledger.purpose];
    if (forward === 0) return [];
    const start = addDaysToLocalDateString(ledger.asOfDate, 1);
    const end = addDaysToLocalDateString(ledger.window.endDate, forward);
    const placements = ledger.coachingHistory.placements;
    const rows = placements.items.filter(row => row.observedOn !== null && row.observedOn > ledger.asOfDate)
        .sort((a, b) => (a.observedOn ?? '').localeCompare(b.observedOn ?? '') || a.id.localeCompare(b.id));
    rows.forEach(row => consumed.add(row.id));
    const empty = rows.length ? [] : [`placements: ${text(placements.state)}, none after ${text(ledger.asOfDate)}`];
    return [`## Upcoming (${text(start)}…${text(end)})`, ...empty, ...rows.flatMap(placementBlock), ''];
}

/** Today, Yesterday and Upcoming: what the athlete needs first; sets the ids they consumed. */
export function renderTodaySections(ledger: LedgerExport): TodaySections {
    const consumed = new Set<string>();
    const todays = placementDate(ledger, ledger.asOfDate);
    todays.forEach(row => consumed.add(row.id));
    const lines = [
        `## Today (${text(ledger.asOfDate)})`,
        ...todayRecords(ledger, 'check-in', ledger.facts.checkins, 'subjective_baselines', CHECKIN_BASELINES, consumed),
        ...todayRecords(ledger, 'recovery', ledger.facts.recovery, 'biometric_baselines', RECOVERY_BASELINES, consumed),
        flagsLine(ledger.flags, ledger.asOfDate),
        ...(todays.length ? todays.flatMap(placementBlock) : [`placements: none dated ${text(ledger.asOfDate)}`]),
        '',
        ...yesterdaySection(ledger, consumed),
        ...upcomingSection(ledger, consumed),
    ];
    return { lines, consumedIds: consumed };
}
