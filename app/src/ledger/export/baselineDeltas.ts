/**
 * Phase 2b: state-bearing `value - baseline` deltas for today's check-in and recovery values
 * that have a matching 28-day baseline in `derived`. A delta is `measured` only when both
 * sides are measured and describe the same semantic date; otherwise its value is null with
 * the worst contributing state. Metrics with no baseline (e.g. D-1 `totalSteps`) get no delta.
 */
import type { LedgerCollection, LedgerRecord, LedgerState, LedgerValue } from './schema.ts';
import { worstState } from './ledgerValue.ts';

/** Recovery field -> its 28-day baseline key in `biometric_baselines.metrics`. */
export const RECOVERY_BASELINE_KEYS = {
    sleepScore: 'sleepScore28dAvg',
    restingHr: 'restingHr28dAvg',
    hrvOvernightAvg: 'hrv28dAvg',
    respirationAvg: 'respiration28dAvg',
} as const;

/** Check-in field -> its 28-day baseline key in `subjective_baselines.metrics`. */
export const CHECKIN_BASELINE_KEYS = {
    readiness: 'readiness_longAvg',
    sleepQuality: 'sleepQuality_longAvg',
    fatigue: 'fatigue_longAvg',
    soreness: 'soreness_longAvg',
    mentalStress: 'mentalStress_longAvg',
    motivation: 'motivation_longAvg',
} as const;

export const DELTA_SUFFIX = '_delta28d';
export const deltaKeyOf = (field: string): string => `${field}${DELTA_SUFFIX}`;

/** The delta keys each baseline metric always carries (the export's delta inventory). */
export const BASELINE_DELTA_KEYS = {
    biometric_baselines: Object.keys(RECOVERY_BASELINE_KEYS).map(deltaKeyOf),
    subjective_baselines: Object.keys(CHECKIN_BASELINE_KEYS).map(deltaKeyOf),
} as const;

export interface DeltaSpec {
    /** The day's facts collection (today's row is matched by `observedOn === asOfDate`). */
    collection: LedgerCollection<LedgerRecord>;
    /** State of a value when the collection was read but has no row for today. */
    absentRow: LedgerState;
    baselines: Readonly<Record<string, string>>;
    metrics: Readonly<Record<string, LedgerValue<number>>>;
    source: string;
    asOfDate: string;
}

/** Thousandths: removes binary noise (62 - 64.4) without hiding a real difference. */
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function rowValue(spec: DeltaSpec, field: string): LedgerValue<unknown> {
    const row = spec.collection.items.find(item => item.observedOn === spec.asOfDate);
    const value = row?.fields[field];
    if (value) return value;
    return { value: null, source: spec.source, state: spec.collection.state === 'measured' ? spec.absentRow : spec.collection.state };
}

function deltaOf(spec: DeltaSpec, field: string, baselineKey: string): LedgerValue<number> {
    const value = rowValue(spec, field);
    const baseline = spec.metrics[baselineKey];
    const common = { source: spec.source, observedOn: spec.asOfDate, ...(value.unit ? { unit: value.unit } : {}) };
    const bothMeasured = value.state === 'measured' && baseline?.state === 'measured';
    if (bothMeasured && typeof value.value === 'number' && typeof baseline.value === 'number'
        && value.observedOn === baseline.observedOn) {
        return { value: round3(value.value - baseline.value), ...common, state: 'measured' };
    }
    // Both measured but for different semantic dates: the comparison does not apply.
    const mismatch: LedgerState = value.observedOn !== undefined && value.observedOn < spec.asOfDate ? 'stale' : 'not_applicable';
    const state = bothMeasured ? mismatch : worstState([value.state, baseline?.state ?? 'unavailable']);
    return { value: null, ...common, state: state === 'measured' ? 'not_applicable' : state };
}

/** `<field>_delta28d` for every field with a declared baseline. */
export function baselineDeltas(spec: DeltaSpec): Record<string, LedgerValue<number>> {
    return Object.fromEntries(Object.entries(spec.baselines)
        .map(([field, baselineKey]) => [deltaKeyOf(field), deltaOf(spec, field, baselineKey)]));
}
