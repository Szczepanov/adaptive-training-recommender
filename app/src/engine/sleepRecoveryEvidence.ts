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
    /** Whether self-reported sleep quality agrees with the objective deficit direction.
     *  Null when there's no objective signal to compare against (state === 'uncertain') --
     *  never defaulted to a specific boolean, which would fabricate agreement/disagreement
     *  that was never actually evaluated. */
    subjectiveConcordance: boolean | null;
    /** Whether HRV/RHR deviation direction agrees with the objective deficit -- true if at
     *  least one of HRV-suppressed or RHR-elevated is observed alongside a real deficit.
     *  Null when there's no objective deficit signal, or when neither HRV nor RHR delta is
     *  available at all. */
    physiologicalConcordance: boolean | null;
    /** Human-readable strings explaining what informed this classification -- always
     *  populated (even for 'normal'/'uncertain'), since "what evidence, if any, led here"
     *  should never require re-deriving the classification to answer. */
    evidence: string[];
}

// --- Provisional classification thresholds (minutes) -- see the module docstring. ---
const PERSISTENT_ACCUMULATED_3D_DEFICIT_MIN = 90;
const MEANINGFUL_ACUTE_DEFICIT_MIN = 60;
const MEANINGFUL_ACCUMULATED_2D_DEFICIT_MIN = 60;
const MINOR_ACUTE_DEFICIT_MIN = 20;
// Below this magnitude, a subjective/physiological signal is treated as "no strong
// direction" rather than actively agreeing or disagreeing with an objective deficit.
const SUBJECTIVE_LOW_QUALITY_THRESHOLD = 5; // sleepQuality on a 1-10 scale
const SUBJECTIVE_HIGH_QUALITY_THRESHOLD = 6;

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

    if (subjectiveConcordance === true) {
        evidence.push(`Self-reported sleep quality (${sleepQuality}/10) agrees with the objective deficit.`);
    } else if (subjectiveConcordance === false) {
        evidence.push(`Self-reported sleep quality (${sleepQuality}/10) does not agree with the objective deficit.`);
    }

    if (physiologicalConcordance === true) {
        const parts: string[] = [];
        if (hrvDeltaMs !== null && hrvDeltaMs < 0) parts.push(`HRV suppressed ${Math.round(-hrvDeltaMs)}ms`);
        if (rhrDeltaBpm !== null && rhrDeltaBpm > 0) parts.push(`RHR elevated ${Math.round(rhrDeltaBpm)}bpm`);
        evidence.push(`${parts.join(' and ')} vs baseline, consistent with reduced recovery.`);
    } else if (physiologicalConcordance === false) {
        evidence.push('HRV/RHR do not show the expected direction alongside the objective deficit.');
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
        && acuteDeficitMin > 0
    ) {
        state = 'persistent_sleep_deficit';
    } else if (
        acuteDeficitMin >= MEANINGFUL_ACUTE_DEFICIT_MIN
        || (accumulated2dDeficitMin !== null && accumulated2dDeficitMin >= MEANINGFUL_ACCUMULATED_2D_DEFICIT_MIN)
    ) {
        state = 'meaningful_sleep_deficit';
    } else if (acuteDeficitMin >= MINOR_ACUTE_DEFICIT_MIN) {
        state = 'minor_disruption';
    } else {
        state = 'normal';
    }

    // 'uncertain' already returned above -- state here is always one of the other four.
    const hasObjectiveDeficitSignal = state !== 'normal';

    let subjectiveConcordance: boolean | null = null;
    if (hasObjectiveDeficitSignal) {
        subjectiveConcordance = subjective.sleepQuality <= SUBJECTIVE_LOW_QUALITY_THRESHOLD;
    } else if (state === 'normal') {
        subjectiveConcordance = subjective.sleepQuality >= SUBJECTIVE_HIGH_QUALITY_THRESHOLD;
    }

    const hrvDeltaMs = objective.hrv_delta;
    const rhrDeltaBpm = objective.rhr_delta;
    let physiologicalConcordance: boolean | null = null;
    if (hasObjectiveDeficitSignal && (hrvDeltaMs !== null || rhrDeltaBpm !== null)) {
        physiologicalConcordance = (hrvDeltaMs !== null && hrvDeltaMs < 0) || (rhrDeltaBpm !== null && rhrDeltaBpm > 0);
    }

    // Confidence follows how much history actually backs the classification, not the
    // magnitude of the deficit itself -- a huge deficit computed from a barely-mature
    // baseline is still a low-confidence read.
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
