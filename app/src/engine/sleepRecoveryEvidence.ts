import type { DailyReadiness } from './models';

/**
 * Phase 3 of the sleep-decision-authority plan (docs/analysis/2026-08-29-sleep-data-
 * training-recommendations-analysis.md §18). A shadow-only categorical read on sleep-
 * related recovery evidence, built on Phase 2's derived sleep-duration/timing fields.
 *
 * Genuinely shadow: nothing in rules.ts/fatigue.ts calls this, and it must not become a
 * silent readiness input by another route -- it only ever reads DailyReadiness (the same
 * input rules.ts already receives), never writes to it, and returns a pure value.
 *
 * The classification thresholds below are a deliberate first cut, not a validated model.
 * Per the reviewed analysis's own promotion criteria (§14), exact thresholds get tuned
 * against real outcomes in Phase 4/5 (replay/prospective evaluation) before any activation
 * decision -- picking "better" numbers now without that evidence would just be guessing
 * with more confidence. They're named constants specifically so that tuning is a
 * one-line change, not a rewrite.
 */

export type SleepRecoveryEvidenceState =
    | 'normal'
    | 'minor_disruption'
    | 'meaningful_sleep_deficit'
    | 'persistent_sleep_deficit'
    | 'uncertain';

export type SleepRecoveryEvidenceConfidence = 'high' | 'moderate' | 'low';

export interface SleepRecoveryEvidence {
    state: SleepRecoveryEvidenceState;
    confidence: SleepRecoveryEvidenceConfidence;
    /** Signed minutes vs the 7-day median baseline -- positive = shortfall (short night),
     *  negative = surplus (long night). Note this is the OPPOSITE sign convention from
     *  EngineObjectiveInput.sleep_duration_delta_7d_min (current - baseline): "deficit"
     *  reads more naturally as positive-when-short, matching accumulated2d/3dDeficitMin's
     *  existing convention below. Null if no 7d baseline is available yet. */
    acuteDurationDeficitMin: number | null;
    /** Signed accumulated deficit (minutes) over the most recent 2/3 nights through and
     *  including tonight vs the 28d median baseline -- positive = net shortfall, negative
     *  = net surplus. Pass-through of EngineObjectiveInput's own fields (already in this
     *  sign convention). Null if unavailable (see that field's docstring). */
    accumulated2dDeficitMin: number | null;
    accumulated3dDeficitMin: number | null;
    /** Whether self-reported sleep quality agrees with the objective sleep-duration signal.
     *  Null when the subjective score sits in the deliberately neutral middle band, or when
     *  there is no objective signal to compare against (state === 'uncertain'). */
    subjectiveConcordance: boolean | null;
    /** Whether HRV/RHR deviations materially agree with the objective deficit. Raw sign is
     *  not enough: a deviation must exceed the person's 28d variability (with the same
     *  conservative floors used by the live readiness engine). Mixed/within-noise signals
     *  remain null rather than fabricating agreement/disagreement. */
    physiologicalConcordance: boolean | null;
    /** Human-readable strings explaining what informed this classification -- always
     *  populated (even for 'normal'/'uncertain'), since "what evidence, if any, led here"
     *  should never require re-deriving the classification to answer. */
    evidence: string[];
}

// --- Provisional classification thresholds (minutes) -- see the module docstring. ---
const PERSISTENT_ACCUMULATED_3D_DEFICIT_MIN = 90;
const MEANINGFUL_ACUTE_DEFICIT_MIN = 60;
const MEANINGFUL_ACCUMULATED_DEFICIT_MIN = 60;
const MINOR_ACUTE_DEFICIT_MIN = 20;

// A neutral subjective band avoids converting an ordinary mid-scale answer into a forced
// agreement/disagreement. These remain provisional shadow thresholds.
const SUBJECTIVE_LOW_QUALITY_THRESHOLD = 4; // sleepQuality on a 1-10 scale
const SUBJECTIVE_HIGH_QUALITY_THRESHOLD = 7;

// Mirror the live readiness engine's personal-variability floors without importing rules.ts
// into this shadow module. A raw +/- epsilon must never count as physiological concordance.
const HRV_STDEV_FLOOR_MS = 3;
const RHR_STDEV_FLOOR_BPM = 1.5;

type Direction = 'adverse' | 'favorable' | 'neutral' | 'unavailable';

function classifyDirection(
    delta: number | null,
    variability: number | null,
    floor: number,
    adverseWhenPositive: boolean,
): Direction {
    if (delta === null) return 'unavailable';
    const threshold = Math.max(variability ?? floor, floor);
    if (Math.abs(delta) < threshold) return 'neutral';
    const adverse = adverseWhenPositive ? delta > 0 : delta < 0;
    return adverse ? 'adverse' : 'favorable';
}

function buildEvidenceStrings(params: {
    state: SleepRecoveryEvidenceState;
    acuteDeficitMin: number | null;
    accumulated2dDeficitMin: number | null;
    accumulated3dDeficitMin: number | null;
    subjectiveConcordance: boolean | null;
    physiologicalConcordance: boolean | null;
    sleepQuality: number;
    hrvDeltaMs: number | null;
    rhrDeltaBpm: number | null;
    hrvDirection: Direction;
    rhrDirection: Direction;
}): string[] {
    const evidence: string[] = [];
    const {
        state,
        acuteDeficitMin,
        accumulated2dDeficitMin,
        accumulated3dDeficitMin,
        subjectiveConcordance,
        physiologicalConcordance,
        sleepQuality,
        hrvDeltaMs,
        rhrDeltaBpm,
        hrvDirection,
        rhrDirection,
    } = params;

    if (state === 'uncertain') {
        evidence.push('No sleep-duration baseline available yet -- insufficient history to classify.');
        return evidence;
    }

    if (acuteDeficitMin !== null) {
        evidence.push(
            acuteDeficitMin > 0
                ? `Acute sleep-duration deficit: ${Math.round(acuteDeficitMin)} min vs 7-day baseline.`
                : `Sleep duration at or above 7-day baseline (surplus ${Math.round(-acuteDeficitMin)} min).`,
        );
    }
    if (accumulated3dDeficitMin !== null) {
        evidence.push(
            accumulated3dDeficitMin > 0
                ? `3-night accumulated deficit: ${Math.round(accumulated3dDeficitMin)} min vs 28-day baseline.`
                : `3-night window at or above 28-day baseline (net surplus ${Math.round(-accumulated3dDeficitMin)} min).`,
        );
    } else if (accumulated2dDeficitMin !== null) {
        evidence.push(
            accumulated2dDeficitMin > 0
                ? `2-night accumulated deficit: ${Math.round(accumulated2dDeficitMin)} min vs 28-day baseline.`
                : `2-night window at or above 28-day baseline (net surplus ${Math.round(-accumulated2dDeficitMin)} min).`,
        );
    }

    if (subjectiveConcordance !== null) {
        const signal = state === 'normal' ? 'normal objective sleep-duration signal' : 'objective sleep-deficit signal';
        evidence.push(
            `Self-reported sleep quality (${sleepQuality}/10) ${subjectiveConcordance ? 'agrees' : 'does not agree'} with the ${signal}.`,
        );
    }

    if (physiologicalConcordance === true) {
        const parts: string[] = [];
        if (hrvDirection === 'adverse' && hrvDeltaMs !== null) {
            parts.push(`HRV materially suppressed ${Math.round(-hrvDeltaMs)}ms`);
        }
        if (rhrDirection === 'adverse' && rhrDeltaBpm !== null) {
            parts.push(`RHR materially elevated ${Math.round(rhrDeltaBpm)}bpm`);
        }
        evidence.push(`${parts.join(' and ')} vs baseline, consistent with reduced recovery.`);
    } else if (physiologicalConcordance === false) {
        const parts: string[] = [];
        if (hrvDirection === 'favorable' && hrvDeltaMs !== null) {
            parts.push(`HRV materially above baseline by ${Math.round(hrvDeltaMs)}ms`);
        }
        if (rhrDirection === 'favorable' && rhrDeltaBpm !== null) {
            parts.push(`RHR materially below baseline by ${Math.round(-rhrDeltaBpm)}bpm`);
        }
        evidence.push(`${parts.join(' and ')} despite the objective sleep deficit.`);
    }

    if (evidence.length === 0) {
        evidence.push('No meaningful sleep-duration deviation vs personal baseline.');
    }
    return evidence;
}

/**
 * Pure, synchronous classification -- no Firestore read, no async signature (D-SUBJPURE's
 * precedent, see DailyReadiness.subjectiveBaseline's docstring). Reads only
 * `readiness.objective`/`readiness.subjective`, never mutates either.
 */
export function evaluateSleepRecoveryEvidence(readiness: DailyReadiness): SleepRecoveryEvidence {
    const { objective, subjective } = readiness;

    const delta7dMin = objective.sleep_duration_delta_7d_min ?? null;
    const acuteDeficitMin = delta7dMin === null ? null : -delta7dMin;
    const accumulated2dDeficitMin = objective.sleep_duration_accumulated_2d_deficit_min ?? null;
    const accumulated3dDeficitMin = objective.sleep_duration_accumulated_3d_deficit_min ?? null;

    if (acuteDeficitMin === null) {
        const evidence = buildEvidenceStrings({
            state: 'uncertain',
            acuteDeficitMin: null,
            accumulated2dDeficitMin,
            accumulated3dDeficitMin,
            subjectiveConcordance: null,
            physiologicalConcordance: null,
            sleepQuality: subjective.sleepQuality,
            hrvDeltaMs: objective.hrv_delta,
            rhrDeltaBpm: objective.rhr_delta,
            hrvDirection: 'unavailable',
            rhrDirection: 'unavailable',
        });
        return {
            state: 'uncertain',
            confidence: 'low',
            acuteDurationDeficitMin: null,
            accumulated2dDeficitMin,
            accumulated3dDeficitMin,
            subjectiveConcordance: null,
            physiologicalConcordance: null,
            evidence,
        };
    }

    let state: SleepRecoveryEvidenceState;
    if (
        accumulated3dDeficitMin !== null
        && accumulated3dDeficitMin >= PERSISTENT_ACCUMULATED_3D_DEFICIT_MIN
        && acuteDeficitMin >= MINOR_ACUTE_DEFICIT_MIN
    ) {
        state = 'persistent_sleep_deficit';
    } else if (
        acuteDeficitMin >= MEANINGFUL_ACUTE_DEFICIT_MIN
        || (accumulated2dDeficitMin !== null && accumulated2dDeficitMin >= MEANINGFUL_ACCUMULATED_DEFICIT_MIN)
        || (accumulated3dDeficitMin !== null && accumulated3dDeficitMin >= MEANINGFUL_ACCUMULATED_DEFICIT_MIN)
    ) {
        state = 'meaningful_sleep_deficit';
    } else if (acuteDeficitMin >= MINOR_ACUTE_DEFICIT_MIN) {
        state = 'minor_disruption';
    } else {
        state = 'normal';
    }

    const hasObjectiveDeficitSignal = state !== 'normal';

    let subjectiveConcordance: boolean | null = null;
    if (hasObjectiveDeficitSignal) {
        if (subjective.sleepQuality <= SUBJECTIVE_LOW_QUALITY_THRESHOLD) subjectiveConcordance = true;
        else if (subjective.sleepQuality >= SUBJECTIVE_HIGH_QUALITY_THRESHOLD) subjectiveConcordance = false;
    } else {
        if (subjective.sleepQuality >= SUBJECTIVE_HIGH_QUALITY_THRESHOLD) subjectiveConcordance = true;
        else if (subjective.sleepQuality <= SUBJECTIVE_LOW_QUALITY_THRESHOLD) subjectiveConcordance = false;
    }

    const hrvDeltaMs = objective.hrv_delta;
    const rhrDeltaBpm = objective.rhr_delta;
    const hrvDirection = classifyDirection(hrvDeltaMs, objective.hrv_stdev_28d, HRV_STDEV_FLOOR_MS, false);
    const rhrDirection = classifyDirection(rhrDeltaBpm, objective.rhr_stdev_28d, RHR_STDEV_FLOOR_BPM, true);

    let physiologicalConcordance: boolean | null = null;
    if (hasObjectiveDeficitSignal) {
        const adverseCount = Number(hrvDirection === 'adverse') + Number(rhrDirection === 'adverse');
        const favorableCount = Number(hrvDirection === 'favorable') + Number(rhrDirection === 'favorable');
        if (adverseCount > 0 && favorableCount === 0) physiologicalConcordance = true;
        else if (favorableCount > 0 && adverseCount === 0) physiologicalConcordance = false;
    }

    // Confidence is deliberately *history confidence*, not an end-to-end data-quality score.
    // Finality/freshness/identity are separate gates elsewhere in the architecture and must be
    // incorporated before any future promotion from shadow to decision authority.
    let confidence: SleepRecoveryEvidenceConfidence;
    if (objective.sleep_duration_delta_28d_min !== null && objective.sleep_duration_delta_28d_min !== undefined && accumulated3dDeficitMin !== null) {
        confidence = 'high';
    } else if (delta7dMin !== null) {
        confidence = 'moderate';
    } else {
        confidence = 'low';
    }

    const evidence = buildEvidenceStrings({
        state,
        acuteDeficitMin,
        accumulated2dDeficitMin,
        accumulated3dDeficitMin,
        subjectiveConcordance,
        physiologicalConcordance,
        sleepQuality: subjective.sleepQuality,
        hrvDeltaMs,
        rhrDeltaBpm,
        hrvDirection,
        rhrDirection,
    });

    return {
        state,
        confidence,
        acuteDurationDeficitMin: acuteDeficitMin,
        accumulated2dDeficitMin,
        accumulated3dDeficitMin,
        subjectiveConcordance,
        physiologicalConcordance,
        evidence,
    };
}
