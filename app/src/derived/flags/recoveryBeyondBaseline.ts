import { worstState } from '../../ledger/export/ledgerValue.ts';
import type { LedgerState } from '../../ledger/export/schema.ts';
import type { DailyRecoverySnapshot } from '../../ledger/models.ts';
import type { FlagEvaluation } from './flagEvaluation.ts';

/*
 * D-FLAGS recovery metric beyond baseline (ADR-0052, ADR-0024), #1144 PR1-5.
 *
 * One flag, `recovery_beyond_baseline`, active when any of HRV, resting HR or sleep score is
 * adverse (owner decision Q4, #962). Each metric compares the as-of-date value's 7-day delta
 * with the athlete's 28-day night-to-night variability, floored by the same personal
 * variability floors the live engine uses; within that band reads as "at baseline". A sleep
 * score below the absolute floor is adverse regardless of baseline.
 *
 * Pure: reads only the already-fetched snapshot. Missing, provider-fallback-dated and
 * implausible values are reported with their own state and are never read as normal recovery.
 * `engine/contextBriefRecoverySynthesis.ts` renders the per-metric results as display text.
 */

export const RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION = 'recovery_beyond_baseline-v1';

export type RecoveryMetric = 'hrv' | 'rhr' | 'sleep';

/**
 * Personal-variability floors for the 7-day delta band, per metric (HRV ms, resting HR bpm,
 * sleep score points). `engine/rules.ts` keeps a private copy (`HRV_STDEV_FLOOR_MS`,
 * `RHR_STDEV_FLOOR_BPM`, `SLEEP_STDEV_FLOOR_PTS`) until ADR-0052 Phase 3; the parity is pinned
 * by `knowledge/readinessSleepHrvPolicyAlignment.test.ts` (claim
 * `readiness.physiological_strain_model`).
 */
export const RECOVERY_VARIABILITY_FLOORS: Readonly<Record<RecoveryMetric, number>> = {
    hrv: 3,
    rhr: 1.5,
    sleep: 4,
};

/** Sleep score strictly below this is adverse on its own. Mirrors `rules.ts` SLEEP_SCORE_ABSOLUTE_FLOOR. */
export const SLEEP_SCORE_ABSOLUTE_FLOOR = 50;

/** Plausible ranges for raw wearable and subjective values; `engine/dataConfidence.ts` reads them too. */
export const PHYSIOLOGICAL_BOUNDS = {
    hrv: { min: 8, max: 300, warnMin: 15, warnMax: 200, unit: 'ms' },
    rhr: { min: 28, max: 140, warnMin: 35, warnMax: 100, unit: 'bpm' },
    sleepScore: { min: 0, max: 100, unit: 'pts' },
    sleepDurationMin: { min: 60, max: 900, warnMin: 180, warnMax: 720, unit: 'min' },
    respiration: { min: 6, max: 35, warnMin: 8, warnMax: 25, unit: 'brpm' },
    bodyBattery: { min: 0, max: 100, unit: 'pts' },
    steps: { min: 0, max: 100000, warnMax: 50000, unit: 'steps' },
    subjectiveScale: { min: 1, max: 10, unit: '1-10' },
} as const;

interface MetricDefinition {
    unit: string;
    /** +1 when a higher value is adverse (RHR), -1 when a lower value is adverse. */
    adverseSign: 1 | -1;
    bounds: { min: number; max: number };
}

const METRIC_DEFINITIONS: Readonly<Record<RecoveryMetric, MetricDefinition>> = {
    hrv: { unit: 'ms', adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.hrv },
    rhr: { unit: 'bpm', adverseSign: 1, bounds: PHYSIOLOGICAL_BOUNDS.rhr },
    sleep: { unit: 'pts', adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.sleepScore },
};

export const RECOVERY_METRICS: readonly RecoveryMetric[] = ['hrv', 'rhr', 'sleep'];

export type RecoveryMetricReason =
    | 'not_recorded'
    | 'stale_metric_date'
    | 'implausible'
    | 'below_absolute_floor'
    | 'no_baseline_delta'
    | 'at_baseline'
    | 'adverse_vs_baseline'
    | 'favorable_vs_baseline';

/** Which number set the band: the athlete's own 28-day stdev, or the variability floor. */
export type RecoveryBandSource = 'personal_28d_stdev' | 'variability_floor';

export interface RecoveryMetricInput {
    current: number | null | undefined;
    delta7d: number | null | undefined;
    sd28d: number | null | undefined;
    /** The date the value describes; the provider may fall back to D-1 (`source.metricDates`). */
    metricDate: string;
}

export interface RecoveryMetricResult {
    metric: RecoveryMetric;
    unit: string;
    /** `measured` when the value could be judged; otherwise why it could not. */
    state: LedgerState;
    reasonCode: RecoveryMetricReason;
    /** null when the metric could not be judged. */
    adverse: boolean | null;
    current: number | null;
    delta7d: number | null;
    /** Usual night-to-night variation (±band); null when no delta could be compared. */
    band: number | null;
    bandSource: RecoveryBandSource | null;
    metricDate: string;
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const REASON_STATE: Readonly<Record<RecoveryMetricReason, LedgerState>> = {
    not_recorded: 'missing',
    stale_metric_date: 'stale',
    implausible: 'invalid',
    below_absolute_floor: 'measured',
    no_baseline_delta: 'unavailable',
    at_baseline: 'measured',
    adverse_vs_baseline: 'measured',
    favorable_vs_baseline: 'measured',
};

const REASON_ADVERSE: Readonly<Record<RecoveryMetricReason, boolean | null>> = {
    not_recorded: null,
    stale_metric_date: null,
    implausible: null,
    below_absolute_floor: true,
    no_baseline_delta: null,
    at_baseline: false,
    adverse_vs_baseline: true,
    favorable_vs_baseline: false,
};

function bandFor(metric: RecoveryMetric, sd28d: number | null | undefined): { band: number; bandSource: RecoveryBandSource } {
    const floor = RECOVERY_VARIABILITY_FLOORS[metric];
    const band = Math.max(isNum(sd28d) ? sd28d : floor, floor);
    return { band, bandSource: isNum(sd28d) && sd28d > floor ? 'personal_28d_stdev' : 'variability_floor' };
}

function reasonFor(metric: RecoveryMetric, input: RecoveryMetricInput, asOfDate: string, band: number | null): RecoveryMetricReason {
    const { adverseSign, bounds } = METRIC_DEFINITIONS[metric];
    const { current, delta7d } = input;
    if (!isNum(current)) return 'not_recorded';
    if (input.metricDate !== asOfDate) return 'stale_metric_date';
    if (current < bounds.min || current > bounds.max) return 'implausible';
    if (metric === 'sleep' && current < SLEEP_SCORE_ABSOLUTE_FLOOR) return 'below_absolute_floor';
    if (!isNum(delta7d) || band === null) return 'no_baseline_delta';
    if (Math.abs(delta7d) < band) return 'at_baseline';
    return adverseSign * delta7d > 0 ? 'adverse_vs_baseline' : 'favorable_vs_baseline';
}

/** Pure. Classifies one metric for `asOfDate`; a value dated another day is stale, not current. */
export function classifyRecoveryMetric(metric: RecoveryMetric, input: RecoveryMetricInput, asOfDate: string): RecoveryMetricResult {
    const delta7d = isNum(input.delta7d) ? input.delta7d : null;
    const { band, bandSource } = delta7d === null ? { band: null, bandSource: null } : bandFor(metric, input.sd28d);
    const reasonCode = reasonFor(metric, input, asOfDate, band);
    return {
        metric,
        unit: METRIC_DEFINITIONS[metric].unit,
        state: REASON_STATE[reasonCode],
        reasonCode,
        adverse: REASON_ADVERSE[reasonCode],
        current: isNum(input.current) ? input.current : null,
        delta7d,
        band,
        bandSource,
        metricDate: input.metricDate,
    };
}

/** The three metric inputs a snapshot carries, each dated by `source.metricDates`. */
export function recoveryMetricInputs(snapshot: DailyRecoverySnapshot): Record<RecoveryMetric, RecoveryMetricInput> {
    const { raw, derived } = snapshot;
    const dates = snapshot.source?.metricDates;
    return {
        hrv: { current: raw.hrvOvernightAvg, delta7d: derived.deltas.hrvVs7d, sd28d: derived.hrv28dStdev, metricDate: dates?.hrv ?? snapshot.date },
        rhr: { current: raw.restingHr, delta7d: derived.deltas.restingHrVs7d, sd28d: derived.restingHr28dStdev, metricDate: dates?.restingHr ?? snapshot.date },
        sleep: { current: raw.sleepScore, delta7d: derived.deltas.sleepScoreVs7d, sd28d: derived.sleepScore28dStdev, metricDate: dates?.sleep ?? snapshot.date },
    };
}

export interface RecoveryBeyondBaselineEvaluation {
    flag: FlagEvaluation;
    /** Empty when the snapshot as a whole could not be read (missing, stale, immature baseline). */
    metrics: RecoveryMetricResult[];
}

const SNAPSHOT_SOURCE = 'daily_recovery_snapshot';

const THRESHOLD = 'Active when any of HRV, resting HR or sleep score is adverse: a 7-day delta in the adverse '
    + 'direction at least max(28-day stdev, variability floor HRV '
    + `${RECOVERY_VARIABILITY_FLOORS.hrv} ms / RHR ${RECOVERY_VARIABILITY_FLOORS.rhr} bpm / sleep `
    + `${RECOVERY_VARIABILITY_FLOORS.sleep} pts), or a sleep score below ${SLEEP_SCORE_ABSOLUTE_FLOOR}. `
    + 'Only the 7-day delta is compared; the 28-day drift term of the engine strain model is not used. '
    + 'Not active only when all three metrics are measured on the as-of date; a metric dated D-1 '
    + '(provider fallback) is stale and is never counted, so a missing, stale, implausible or '
    + 'delta-less metric without an adverse one leaves the flag unevaluated';

/**
 * Baseline window label for persisting the flag as a `LedgerFlag` (`baselineWindow`). The flag
 * matches the pre-extraction context-brief synthesis, not `rules.ts` `metricStrain`, which also
 * adds a 28-day chronic-drift term.
 */
export const RECOVERY_BEYOND_BASELINE_WINDOW =
    '7-day delta vs 28-day variability; excludes the 28-day chronic-drift term';

function metricInputs(metrics: readonly RecoveryMetricResult[]): FlagEvaluation['inputs'] {
    return metrics.map(result => ({
        name: result.metric,
        value: {
            value: result.current,
            unit: result.unit,
            source: SNAPSHOT_SOURCE,
            state: result.state,
            observedOn: result.metricDate,
        },
    }));
}

function notEvaluated(reasonCode: string, state: LedgerState, snapshotDate: string | null): RecoveryBeyondBaselineEvaluation {
    return {
        flag: {
            id: 'recovery_beyond_baseline',
            active: null,
            state,
            reasonCode,
            definitionVersion: RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION,
            inputs: [{
                name: 'snapshot',
                value: { value: snapshotDate, source: SNAPSHOT_SOURCE, state, ...(snapshotDate ? { observedOn: snapshotDate } : {}) },
            }],
            threshold: THRESHOLD,
        },
        metrics: [],
    };
}

/**
 * Pure. Evaluates `recovery_beyond_baseline` for `asOfDate` from the latest snapshot on or
 * before it. A missing or stale snapshot, or a baseline with fewer than 7 days, cannot be
 * judged (`active: null`).
 *
 * Otherwise any adverse metric makes the flag active (owner decision Q4), whatever the state of
 * the others. A negative (`active: false`) needs all three metrics `measured`: without an
 * adverse metric, any unjudged one leaves `active: null`, with the worst unjudged state
 * (`worstState`: `stale` only when every unjudged metric is stale). A D-1 provider-fallback
 * value is stale and is not counted; counting it would need an owner decision.
 */
export function evaluateRecoveryBeyondBaseline(
    snapshot: DailyRecoverySnapshot | null | undefined,
    asOfDate: string,
): RecoveryBeyondBaselineEvaluation {
    if (!snapshot) return notEvaluated('no_snapshot', 'missing', null);
    if (snapshot.date !== asOfDate) return notEvaluated('snapshot_stale', 'stale', snapshot.date);
    if (!snapshot.dataQuality?.baseline28dReady && !snapshot.dataQuality?.baseline7dReady) {
        return notEvaluated('baseline_immature', 'unavailable', snapshot.date);
    }
    const inputs = recoveryMetricInputs(snapshot);
    const metrics = RECOVERY_METRICS.map(metric => classifyRecoveryMetric(metric, inputs[metric], asOfDate));
    const adverse = metrics.filter(result => result.adverse === true);
    const unjudged = metrics.filter(result => result.adverse === null);
    const base = {
        id: 'recovery_beyond_baseline' as const,
        definitionVersion: RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION,
        inputs: metricInputs(metrics),
        threshold: THRESHOLD,
    };
    if (adverse.length > 0) {
        const reasonCode = `adverse:${adverse.map(result => result.metric).join('+')}`;
        return { flag: { ...base, active: true, state: 'measured', reasonCode }, metrics };
    }
    if (unjudged.length === 0) {
        return { flag: { ...base, active: false, state: 'measured', reasonCode: 'none_adverse' }, metrics };
    }
    const state = worstState(unjudged.map(result => result.state));
    const reasonCode = unjudged.length === metrics.length ? 'no_judged_metric' : 'incomplete_none_adverse';
    return { flag: { ...base, active: null, state, reasonCode }, metrics };
}
