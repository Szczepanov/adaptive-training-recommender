import { CHECKIN_BASELINE_KEYS, deltaKeyOf, RECOVERY_BASELINE_KEYS } from '../baselineDeltas.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerRecord, LedgerState, LedgerValue } from '../schema.ts';
import { entryLines, fieldLine, type FieldEntry } from './compactLines.ts';

/** Field -> 28-day baseline metric key in the derived baseline metrics (owned by the JSON builder). */
export const CHECKIN_BASELINES: Readonly<Record<string, string>> = CHECKIN_BASELINE_KEYS;
export const RECOVERY_BASELINES: Readonly<Record<string, string>> = RECOVERY_BASELINE_KEYS;

const round1 = (value: number) => Math.round(value * 10) / 10;

function signed(delta: number): string {
    const rounded = round1(delta);
    if (rounded === 0) return '0';
    return rounded > 0 ? `+${rounded}` : `\u2212${Math.abs(rounded)}`;
}

function baselineOf(ledger: LedgerExport, derivedId: string, key: string): LedgerValue<number> | null {
    return ledger.derived.find(metric => metric.id === derivedId)?.metrics?.[key] ?? null;
}

/** The exported delta leaf only; the renderer never subtracts. */
function deltaText(delta: LedgerValue<number> | null): string {
    if (delta === null) return ', delta: unavailable';
    if (typeof delta.value !== 'number') return `, delta: ${text(delta.state)}`;
    return `, ${signed(delta.value)}${delta.state === 'measured' ? '' : ` (${text(delta.state)})`}`;
}

function baselineSuffix(baseline: LedgerValue<number> | null, delta: LedgerValue<number> | null): string {
    if (baseline === null) return ' (28d baseline: unavailable)';
    if (baseline.value === null || baseline.value === undefined) return ` (28d baseline: ${text(baseline.state)})`;
    const state = baseline.state === 'measured' ? '' : ` (${text(baseline.state)})`;
    return ` (28d ${round1(baseline.value)}${state}${deltaText(delta)})`;
}

/** `readiness: 6 (28d 7.2, −1.2)`; a missing value prints its state and stays in the missing line. */
function baselineLine(
    name: string, value: LedgerValue<unknown>, baseline: LedgerValue<number> | null, delta: LedgerValue<number> | null,
): string {
    if (value.value === null || value.value === undefined) return `${text(name)}: ${text(value.state)}`;
    const unit = value.unit && value.unit !== 'score' ? ` ${text(value.unit)}` : '';
    const provenance = fieldLine(name, { ...value, unit: undefined }).slice(`${text(name)}: ${text(value.value)}`.length);
    return `${text(name)}: ${text(value.value)}${unit}${baselineSuffix(baseline, delta)}${provenance}`;
}

/** A record's fields: baselined fields with value + 28d + delta, then the rest and one missing line. */
export function baselinedRecordLines(
    ledger: LedgerExport, row: LedgerRecord, derivedId: string, baselines: Readonly<Record<string, string>>,
): string[] {
    const entries = Object.entries(row.fields);
    const withBaseline = entries.filter(([name]) => name in baselines);
    const rest: FieldEntry[] = entries.filter(([name]) => !(name in baselines));
    const missingBaselined: FieldEntry[] = withBaseline.filter(([, value]) => value.value === null || value.value === undefined);
    return [
        ...withBaseline.map(([name, value]) => baselineLine(name, value,
            baselineOf(ledger, derivedId, baselines[name]), baselineOf(ledger, derivedId, deltaKeyOf(name)))),
        ...entryLines([...rest, ...missingBaselined]),
    ];
}

export function absentRecordLine(label: string, date: string, state: LedgerState): string {
    return `${label}: no record for ${text(date)} (${text(state)})`;
}
