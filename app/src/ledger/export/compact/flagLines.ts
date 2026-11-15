import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerFlag } from '../schema.ts';
import { dominantSource, entryLines, type FieldEntry } from './compactLines.ts';

function dateRange(dates: string[]): string {
    return dates.length === 1 ? text(dates[0]) : `${text(dates[0])}…${text(dates[dates.length - 1])}`;
}

function flagLabel(flag: LedgerFlag): string {
    if (flag.active === false) return flag.state === 'measured' ? 'inactive' : `inactive (${flag.state})`;
    return `unknown (${flag.state})`;
}

/** Evaluations of one id only merge when label, definition version and session scope all agree. */
const scopeKey = (flag: LedgerFlag) => [flagLabel(flag), flag.definitionVersion ?? '', flag.sessionRef ?? ''].join('\u0000');

function activeFlagLines(flag: LedgerFlag): string[] {
    const entries: FieldEntry[] = flag.inputs.map(input => [input.name, input.value]);
    const group = dominantSource(entries);
    return [
        `#### ${text(flag.id)} (${text(flag.observedOn)})`,
        ...(flag.state === 'measured' ? [] : [`state: ${text(flag.state)}`]),
        ...(flag.definitionVersion ? [`definition: ${text(flag.definitionVersion)}`] : []),
        ...(flag.evaluatedAt ? [`evaluatedAt: ${text(flag.evaluatedAt)}`] : []),
        ...(flag.sessionRef ? [`sessionRef: ${text(flag.sessionRef)}`] : []),
        `threshold: ${text(flag.threshold)}`,
        ...(group ? [`inputs: source ${text(group)}`] : []),
        ...entryLines(entries, group),
    ];
}

interface Run { label: string; key: string; dates: string[]; flag: LedgerFlag; single: boolean }

/** `illness_anomaly-v1` on the `illness_anomaly` line reads `v1`; the id is already on the line. */
const shortVersion = (flag: LedgerFlag) => (flag.definitionVersion ?? '').replace(`${flag.id}-`, '');

/**
 * `definition <v>`, `session <ref>` and, when several evaluations share the id and date,
 * `evaluated <instant>`: what tells two evaluations of one flag apart. Shared with Today.
 */
export function flagScopeParts(flag: LedgerFlag, sameDayRepeat: boolean): string[] {
    return [
        flag.definitionVersion ? `definition ${text(shortVersion(flag))}` : '',
        flag.sessionRef ? `session ${text(flag.sessionRef)}` : '',
        // Same-day re-evaluations stay separate, told apart by their persisted instant.
        sameDayRepeat ? `evaluated ${flag.evaluatedAt ? text(flag.evaluatedAt) : 'time not persisted'}` : '',
    ].filter(Boolean);
}

function scopeNotes(run: Run): string {
    const notes = flagScopeParts(run.flag, run.single);
    return notes.length ? ` (${notes.join('; ')})` : '';
}

/**
 * Non-active flags: one line per run of calendar-consecutive dates sharing label, definition version
 * and session scope. A gap day, an active evaluation, or a second evaluation on the same date ends a
 * run, so a range never implies days that were not evaluated or hides a within-day transition.
 */
function inactiveFlagLines(flags: LedgerFlag[]): string[] {
    const lines: string[] = [];
    for (const id of new Set(flags.map(flag => flag.id))) {
        const own = flags.filter(flag => flag.id === id)
            .sort((a, b) => a.observedOn.localeCompare(b.observedOn) || (a.evaluatedAt ?? '').localeCompare(b.evaluatedAt ?? ''));
        const perDate = new Map<string, number>();
        own.forEach(flag => perDate.set(flag.observedOn, (perDate.get(flag.observedOn) ?? 0) + 1));
        const open: { run: Run | null } = { run: null };
        const flush = () => {
            const { run } = open;
            if (run) lines.push(`${text(id)}: ${text(run.label)} ${dateRange(run.dates)}${scopeNotes(run)}`);
            open.run = null;
        };
        for (const flag of own) {
            if (flag.active === true) { flush(); continue; }
            const multiple = (perDate.get(flag.observedOn) ?? 0) > 1;
            const key = scopeKey(flag);
            const { run } = open;
            const last = run?.dates[run.dates.length - 1];
            if (run && !multiple && !run.single && run.key === key && last !== undefined
                && addDaysToLocalDateString(last, 1) === flag.observedOn) {
                run.dates.push(flag.observedOn);
                continue;
            }
            flush();
            open.run = { label: flagLabel(flag), key, dates: [flag.observedOn], flag, single: multiple };
        }
        flush();
    }
    return lines;
}

export function flagsSection(ledger: LedgerExport): string[] {
    if (!ledger.flags.length) return ['## Flags', 'flags: none evaluated', ''];
    // Today's non-active evaluations are summarised under Today; active detail stays here.
    const shown = ledger.flags.filter(flag => flag.observedOn !== ledger.asOfDate || flag.active === true);
    if (!shown.length) return ['## Flags', `flags: only ${text(ledger.asOfDate)} evaluated (see Today)`, ''];
    const active = shown.filter(flag => flag.active === true);
    return ['## Flags', ...active.flatMap(activeFlagLines), ...inactiveFlagLines(shown), ''];
}
