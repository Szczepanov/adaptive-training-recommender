import { CHECKIN_BASELINE_KEYS, deltaKeyOf, RECOVERY_BASELINE_KEYS } from '../baselineDeltas.ts';
import { text } from '../markdownText.ts';
import type { LedgerExport, LedgerRecord, LedgerState, LedgerValue } from '../schema.ts';
import { entryLines, fieldProvenance, formatNumber, formatValue, type FieldEntry } from './compactLines.ts';

/** Field -> 28-day baseline metric key in the derived baseline metrics (owned by the JSON builder). */
export const CHECKIN_BASELINES: Readonly<Record<string, string>> = CHECKIN_BASELINE_KEYS;
export const RECOVERY_BASELINES: Readonly<Record<string, string>> = RECOVERY_BASELINE_KEYS;

export interface BaselineTripletKeys {
    avg7d: string;
    avg28d: string;
    disp: string;
    dispTag: string;
}

export const RECOVERY_BASELINE_TRIPLETS: Readonly<Record<string, BaselineTripletKeys>> = {
    sleepScore: { avg7d: 'sleepScore7dAvg', avg28d: 'sleepScore28dAvg', disp: 'sleepScore28dStdev', dispTag: 'sd' },
    restingHr: { avg7d: 'restingHr7dAvg', avg28d: 'restingHr28dAvg', disp: 'restingHr28dStdev', dispTag: 'sd' },
    hrvOvernightAvg: { avg7d: 'hrv7dAvg', avg28d: 'hrv28dAvg', disp: 'hrv28dStdev', dispTag: 'sd' },
    respirationAvg: { avg7d: 'respiration7dAvg', avg28d: 'respiration28dAvg', disp: 'respiration28dMad', dispTag: 'mad' },
};

export const CHECKIN_BASELINE_TRIPLETS: Readonly<Record<string, BaselineTripletKeys>> = Object.fromEntries(
    Object.keys(CHECKIN_BASELINE_KEYS).map(field => [
        field,
        { avg7d: `${field}_recentAvg`, avg28d: `${field}_longAvg`, disp: `${field}_variability`, dispTag: 'var' },
    ]),
);

function signed(delta: number): string {
    if (!Number.isFinite(delta)) return String(delta);
    const formatted = formatNumber(delta);
    if (formatted === '0') return '0';
    return delta > 0 ? `+${formatted}` : `\u2212${formatNumber(Math.abs(delta))}`;
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

function numericLeafText(leaf: LedgerValue<number> | null): string {
    if (!leaf || typeof leaf.value !== 'number') return '';
    const state = leaf.state === 'measured' ? '' : ` (${text(leaf.state)})`;
    return `${formatNumber(leaf.value)}${state}`;
}

function baselineSuffix(
    avg7d: LedgerValue<number> | null,
    baseline: LedgerValue<number> | null,
    disp: LedgerValue<number> | null,
    delta: LedgerValue<number> | null,
): string {
    const avg7dText = numericLeafText(avg7d);
    const dispText = numericLeafText(disp);
    if (baseline === null || baseline.value === null || baseline.value === undefined) {
        const missing = baseline === null ? '28d baseline: unavailable' : `28d baseline: ${text(baseline.state)}`;
        const extra = [avg7dText ? `7d ${avg7dText}` : '', dispText ? `±${dispText}` : ''].filter(Boolean).join(' ');
        return extra ? ` (${extra}, ${missing})` : ` (${missing})`;
    }
    const state = baseline.state === 'measured' ? '' : ` (${text(baseline.state)})`;
    const prefix = avg7dText ? `7d ${avg7dText} · ` : '';
    const spread = dispText ? ` ±${dispText}` : '';
    return ` (${prefix}28d ${formatNumber(baseline.value)}${state}${spread}${deltaText(delta)})`;
}

/** `readiness: 6 (28d 7.2, −1.2)`; a missing value prints its state and stays in the missing line. */
function baselineLine(
    name: string, value: LedgerValue<unknown>,
    avg7d: LedgerValue<number> | null, baseline: LedgerValue<number> | null, disp: LedgerValue<number> | null,
    delta: LedgerValue<number> | null, group: string | undefined,
): string {
    if (value.value === null || value.value === undefined) return `${text(name)}: ${text(value.state)}`;
    const unit = value.unit && value.unit !== 'score' ? ` ${text(value.unit)}` : '';
    const provenance = fieldProvenance(value, group);
    return `${text(name)}: ${formatValue(value.value)}${unit}${baselineSuffix(avg7d, baseline, disp, delta)}${provenance}`;
}

/** A record's fields: baselined fields with value + 7d/28d/±sd + delta, then the rest and one missing line. */
export function baselinedRecordLines(
    ledger: LedgerExport, row: LedgerRecord, derivedId: string, triplets: Readonly<Record<string, BaselineTripletKeys>>,
    group: string | undefined,
): string[] {
    const entries = Object.entries(row.fields);
    const withBaseline = entries.filter(([name]) => name in triplets);
    const rest: FieldEntry[] = entries.filter(([name]) => !(name in triplets));
    const missingBaselined: FieldEntry[] = withBaseline.filter(([, value]) => value.value === null || value.value === undefined);
    return [
        ...withBaseline.map(([name, value]) => {
            const spec = triplets[name];
            return baselineLine(
                name,
                value,
                baselineOf(ledger, derivedId, spec.avg7d),
                baselineOf(ledger, derivedId, spec.avg28d),
                baselineOf(ledger, derivedId, spec.disp),
                baselineOf(ledger, derivedId, deltaKeyOf(name)),
                group,
            );
        }),
        ...entryLines([...rest, ...missingBaselined], group),
    ];
}

export function absentRecordLine(label: string, date: string, state: LedgerState): string {
    return `${label}: no record for ${text(date)} (${text(state)})`;
}
