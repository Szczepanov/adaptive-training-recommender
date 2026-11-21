import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerFlag, LedgerValue } from '../schema.ts';
import { dominantSource, entryLines, formatNumber, type FieldEntry } from './compactLines.ts';

function dateRange(dates: string[]): string {
    return dates.length === 1 ? text(dates[0]) : `${text(dates[0])}…${text(dates[dates.length - 1])}`;
}

function flagLabel(flag: LedgerFlag): string {
    if (flag.active === false) return flag.state === 'measured' ? 'inactive' : `inactive (${flag.state})`;
    return `unknown (${flag.state})`;
}

/** Evaluations of one id only merge when label, definition version and session scope all agree. */
const scopeKey = (flag: LedgerFlag) => [flagLabel(flag), flag.definitionVersion ?? '', flag.sessionRef ?? ''].join('\u0000');

const isNumericValue = (leaf: LedgerValue<unknown> | undefined): leaf is LedgerValue<number> =>
    leaf !== undefined && typeof leaf.value === 'number' && Number.isFinite(leaf.value);

function formatTrigger(
    metric: string,
    val: LedgerValue<number>,
    delta: LedgerValue<number>,
    band: LedgerValue<number>,
): string {
    const valState = val.state === 'measured' ? '' : ` (${text(val.state)})`;
    const deltaState = delta.state === 'measured' ? '' : ` (${text(delta.state)})`;
    const bandState = band.state === 'measured' ? '' : ` (${text(band.state)})`;
    const unit = val.unit ? ` ${text(val.unit)}` : '';
    const d = delta.value as number;
    const signed = d > 0 ? `+${formatNumber(d)}` : d < 0 ? `\u2212${formatNumber(Math.abs(d))}` : '0';
    return `${text(metric)} ${formatNumber(val.value as number)}${unit}${valState} (7d ${signed}${deltaState} vs band ${formatNumber(band.value as number)}${bandState})`;
}

function activeFlagInputLines(flag: LedgerFlag, entries: readonly FieldEntry[], group: string | undefined): string[] {
    if (flag.id !== 'recovery_beyond_baseline') return entryLines(entries, group);
    const byName = new Map(entries);
    const consumed = new Set<string>();
    const triggers: string[] = [];
    for (const metric of ['hrv', 'rhr', 'sleep']) {
        const val = byName.get(metric);
        const delta = byName.get(`${metric}_delta7d`);
        const band = byName.get(`${metric}_band`);
        if (isNumericValue(val) && isNumericValue(delta) && isNumericValue(band)) {
            consumed.add(metric);
            consumed.add(`${metric}_delta7d`);
            consumed.add(`${metric}_band`);
            triggers.push(formatTrigger(metric, val, delta, band));
        }
    }
    const remaining = entries.filter(([name]) => !consumed.has(name));
    return [
        ...(triggers.length ? [`triggers: ${triggers.join(' · ')}`] : []),
        ...entryLines(remaining, group),
    ];
}

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
        ...activeFlagInputLines(flag, entries, group),
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
 * and session scope, grouping flag ids that share the exact same state/range/scope.
 */
function inactiveFlagLines(flags: LedgerFlag[]): string[] {
    const grouped = new Map<string, string[]>();
    const addRun = (id: string, run: Run) => {
        const suffix = `${text(run.label)} ${dateRange(run.dates)}${scopeNotes(run)}`;
        const ids = grouped.get(suffix) ?? [];
        if (!ids.includes(id)) ids.push(id);
        grouped.set(suffix, ids);
    };
    for (const id of new Set(flags.map(flag => flag.id))) {
        const own = flags.filter(flag => flag.id === id)
            .sort((a, b) => a.observedOn.localeCompare(b.observedOn) || (a.evaluatedAt ?? '').localeCompare(b.evaluatedAt ?? ''));
        const perDate = new Map<string, number>();
        own.forEach(flag => perDate.set(flag.observedOn, (perDate.get(flag.observedOn) ?? 0) + 1));
        const open: { run: Run | null } = { run: null };
        const flush = () => {
            if (open.run) addRun(id, open.run);
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
    return [...grouped].map(([suffix, ids]) => `${ids.map(text).join(', ')}: ${suffix}`);
}

export function flagsSection(ledger: LedgerExport): string[] {
    if (!ledger.flags.length) return ['## Flags', 'flags: none evaluated', ''];
    // Today's non-active evaluations are summarised under Today; active detail stays here.
    const shown = ledger.flags.filter(flag => flag.observedOn !== ledger.asOfDate || flag.active === true);
    if (!shown.length) return ['## Flags', `flags: only ${text(ledger.asOfDate)} evaluated (see Today)`, ''];
    const active = shown.filter(flag => flag.active === true);
    return ['## Flags', ...active.flatMap(activeFlagLines), ...inactiveFlagLines(shown), ''];
}
