import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    WorkoutCostProfile,
} from './models';
import type { CompletedExposure } from './microcycleHistory';
import { getDayDiff } from '../utils/localDate';

export const DECAY_HALF_LIVES_HOURS: Record<keyof DimensionalFatigue, number> = {
    systemic: 36,
    cardiovascular: 24,
    lowerBody: 48,
    upperBody: 36,
    impactTissue: 48,
    neuromuscular: 36,
};

const RUN_OR_FIELD_SPORT_REGEX = /run|soccer|football|trail/i;
const WALK_OR_HIKE_REGEX = /walk|hike/i;

/** Production remains on `max`. The additive option is accepted only by the simulation
 * harness so a fatigue-policy experiment cannot reach a live recommendation by accident. */
export type FatigueFusionPolicy = 'max' | 'additive';

export function combineFatigue(
    external: DimensionalFatigue,
    internal: DimensionalFatigue,
    policy: FatigueFusionPolicy = 'max',
): DimensionalFatigue {
    if (policy === 'additive') {
        return {
            systemic: Math.min(1, external.systemic + internal.systemic),
            cardiovascular: Math.min(1, external.cardiovascular + internal.cardiovascular),
            lowerBody: Math.min(1, external.lowerBody + internal.lowerBody),
            upperBody: Math.min(1, external.upperBody + internal.upperBody),
            impactTissue: Math.min(1, external.impactTissue + internal.impactTissue),
            neuromuscular: Math.min(1, external.neuromuscular + internal.neuromuscular),
        };
    }
    return {
        systemic: Math.max(external.systemic, internal.systemic),
        cardiovascular: Math.max(external.cardiovascular, internal.cardiovascular),
        lowerBody: Math.max(external.lowerBody, internal.lowerBody),
        upperBody: Math.max(external.upperBody, internal.upperBody),
        impactTissue: Math.max(external.impactTissue, internal.impactTissue),
        neuromuscular: Math.max(external.neuromuscular, internal.neuromuscular),
    };
}

export function createEmptyFatigue(dateStr: string): FatigueState {
    const zero: DimensionalFatigue = {
        systemic: 0,
        cardiovascular: 0,
        lowerBody: 0,
        upperBody: 0,
        impactTissue: 0,
        neuromuscular: 0,
    };
    return {
        lastUpdatedDate: dateStr,
        externalLoadFatigue: { ...zero },
        internalResponseStrain: { ...zero },
        combinedFatigue: { ...zero },
    };
}

/**
 * Applies exponential decay to a dimensional fatigue vector over elapsed hours.
 * Formula: F_t = F_0 * (0.5 ^ (hours / halflife))
 */
export function decayFatigue(
    fatigue: DimensionalFatigue,
    elapsedHours: number
): DimensionalFatigue {
    if (elapsedHours <= 0) return { ...fatigue };
    return {
        systemic: Math.max(0, fatigue.systemic * Math.pow(0.5, elapsedHours / 36)),
        cardiovascular: Math.max(0, fatigue.cardiovascular * Math.pow(0.5, elapsedHours / 24)),
        lowerBody: Math.max(0, fatigue.lowerBody * Math.pow(0.5, elapsedHours / 48)),
        upperBody: Math.max(0, fatigue.upperBody * Math.pow(0.5, elapsedHours / 36)),
        impactTissue: Math.max(0, fatigue.impactTissue * Math.pow(0.5, elapsedHours / 48)),
        neuromuscular: Math.max(0, fatigue.neuromuscular * Math.pow(0.5, elapsedHours / 36)),
    };
}

/**
 * Estimates the step contribution from a logged Garmin activity so structured sessions
 * (runs, soccer, hikes) are not double-counted as unlogged ambient walking surge.
 */
export function estimateActivitySteps(training: { type?: string; duration_min?: number } | null | undefined): number {
    if (!training || !training.duration_min || training.duration_min <= 0) return 0;
    const type = training.type || '';

    // Running and high-cadence field sports: ~155 steps/min
    if (RUN_OR_FIELD_SPORT_REGEX.test(type)) {
        return Math.round(training.duration_min * 155);
    }
    // Dedicated walking or hiking activities: ~110 steps/min
    if (WALK_OR_HIKE_REGEX.test(type)) {
        return Math.round(training.duration_min * 110);
    }
    // Other sports (cycling, swimming, gym strength) do not produce primary ambulatory impact steps
    return 0;
}

/**
 * Computes internal response strain vector from subjective check-in and objective Garmin deltas.
 */
export function computeInternalResponseStrain(readiness: DailyReadiness): DimensionalFatigue {
    const { subjective, objective } = readiness;

    // Normalize subjective scores 1-10 to 0-1
    const subFatigue = (subjective.fatigue - 1) / 9;
    const subSoreness = (subjective.soreness - 1) / 9;

    // Objective strain signals
    const hrvDrop = objective.hrv_delta !== null && objective.hrv_delta < 0 ? Math.min(1, Math.abs(objective.hrv_delta) / 15) : 0;
    const rhrElevated = objective.rhr_delta !== null && objective.rhr_delta > 0 ? Math.min(1, objective.rhr_delta / 10) : 0;
    const sleepDeficit = objective.sleep_score !== null && objective.sleep_score < 75 ? (75 - objective.sleep_score) / 50 : 0;

    // Acute ambulatory surge (unlogged high-volume walking/hiking)
    // Evaluates net ambient steps (totalSteps - estimatedActivitySteps) against the 7-day baseline.
    // Triggers when ambient steps >= 1.8x baseline AND excess >= +6,000 steps above baseline.
    let ambulatoryTissueStrain = 0;
    const steps7dAvg = objective.steps_7d_avg;
    const totalSteps = objective.total_steps;
    if (
        totalSteps !== null &&
        totalSteps !== undefined &&
        steps7dAvg !== null &&
        steps7dAvg !== undefined &&
        steps7dAvg > 0
    ) {
        const activitySteps = estimateActivitySteps(objective.yesterday_training);
        const ambientSteps = Math.max(0, totalSteps - activitySteps);
        const excessAmbientSteps = ambientSteps - steps7dAvg;
        const surgeRatio = ambientSteps / steps7dAvg;
        if (surgeRatio >= 1.8 && excessAmbientSteps >= 6000) {
            // Scale smoothly up to a 0.4 dampening cap for a +15,000 excess ambient step surge
            ambulatoryTissueStrain = Math.min(0.4, (excessAmbientSteps / 15000) * 0.4);
        }
    }

    const bbDepletion = objective.body_battery_wake !== null && objective.body_battery_wake < 50
        ? Math.min(1, Math.max(0, (50 - objective.body_battery_wake) / 30))
        : 0;

    // Acute non-diluted floors for single-axis subjective distress and severe autonomic collapse:
    // 1. High subjective fatigue (>= 8/10) directly limits systemic capacity.
    // When accompanied by low readiness (<= 4) or high stress (>= 8), it triggers recover-tier strain.
    const severeSubjectiveDistress = (subjective.fatigue >= 8 && subjective.readiness <= 4) ||
        (subjective.readiness <= 3 && subjective.stress >= 8) ||
        (subjective.fatigue >= 8 && subjective.stress >= 8);
    const acuteSubjectiveFatigueFloor = severeSubjectiveDistress ? 0.65 : (subjective.fatigue >= 8 ? 0.60 : 0);

    // 2. High life stress (>= 9/10) impairs autonomic recovery and heightens injury risk.
    const acuteSubjectiveStressFloor = subjective.stress >= 9 ? 0.60 : 0;

    // 3. Severe autonomic collapse: simultaneous acute collapse across HRV, RHR, and Body Battery.
    const severeAutonomicCollapse = (
        objective.hrv_delta !== null && objective.hrv_delta <= -10 &&
        objective.rhr_delta !== null && objective.rhr_delta >= 5 &&
        objective.body_battery_wake !== null && objective.body_battery_wake <= 35
    ) || (hrvDrop >= 0.8 && rhrElevated >= 0.6 && bbDepletion >= 0.7);
    const autonomicCollapseFloor = severeAutonomicCollapse ? 0.80 : 0;

    // 4. Acute tissue soreness: soreness >= 8/10 represents substantial muscular breakdown
    // requiring 48h to clear below modify/recover thresholds.
    const acuteTissueStrain = subjective.soreness >= 8 ? 0.88 : subSoreness;

    const baseSystemic = 0.3 * subFatigue + 0.25 * hrvDrop + 0.25 * sleepDeficit + 0.2 * bbDepletion;
    const systemic = Math.min(1, Math.max(baseSystemic, acuteSubjectiveFatigueFloor, acuteSubjectiveStressFloor, autonomicCollapseFloor));

    const baseCardiovascular = 0.5 * rhrElevated + 0.5 * hrvDrop;
    const cardiovascular = Math.min(1, Math.max(baseCardiovascular, autonomicCollapseFloor));

    const lowerBody = Math.min(1, acuteTissueStrain + ambulatoryTissueStrain);
    const upperBody = acuteTissueStrain * 0.7; // default soreness split
    const impactTissue = Math.min(1, acuteTissueStrain + ambulatoryTissueStrain);

    const baseNeuromuscular = 0.5 * subFatigue + 0.5 * (1 - (subjective.motivation / 10));
    const neuromuscular = Math.min(1, baseNeuromuscular);

    return {
        systemic,
        cardiovascular,
        lowerBody,
        upperBody,
        impactTissue,
        neuromuscular,
    };
}

/**
 * Updates FatigueState when a training session or fixed activity is completed.
 * Charges external load fatigue strictly from completed activity cost.
 */
export function applyCompletedSessionLoad(
    currentState: FatigueState,
    completedDateStr: string,
    costProfile: WorkoutCostProfile,
    fusionPolicy: FatigueFusionPolicy = 'max',
): FatigueState {
    // 1. Calculate hours between last update and completed session date
    const elapsedHours = Math.max(0, getDayDiff(completedDateStr, currentState.lastUpdatedDate) * 24);

    // 2. Decay previous external load (both saturated and raw latent)
    const decayedExternal = decayFatigue(currentState.externalLoadFatigue, elapsedHours);
    const decayedRawExternal = currentState.rawExternalLoadFatigue
        ? decayFatigue(currentState.rawExternalLoadFatigue, elapsedHours)
        : decayedExternal;

    // 3. Add new session cost to unsaturated raw external load, then clamp for externalLoadFatigue
    const rawExternal: DimensionalFatigue = {
        systemic: decayedRawExternal.systemic + costProfile.systemic,
        cardiovascular: decayedRawExternal.cardiovascular + costProfile.cardiovascular,
        lowerBody: decayedRawExternal.lowerBody + costProfile.lowerBody,
        upperBody: decayedRawExternal.upperBody + costProfile.upperBody,
        impactTissue: decayedRawExternal.impactTissue + costProfile.impactTissue,
        neuromuscular: decayedRawExternal.neuromuscular + costProfile.neuromuscular,
    };

    const newExternal: DimensionalFatigue = {
        systemic: Math.min(1, rawExternal.systemic),
        cardiovascular: Math.min(1, rawExternal.cardiovascular),
        lowerBody: Math.min(1, rawExternal.lowerBody),
        upperBody: Math.min(1, rawExternal.upperBody),
        impactTissue: Math.min(1, rawExternal.impactTissue),
        neuromuscular: Math.min(1, rawExternal.neuromuscular),
    };

    const combined = combineFatigue(newExternal, currentState.internalResponseStrain, fusionPolicy);

    return {
        lastUpdatedDate: completedDateStr,
        externalLoadFatigue: newExternal,
        rawExternalLoadFatigue: rawExternal,
        internalResponseStrain: currentState.internalResponseStrain,
        combinedFatigue: combined,
    };
}

/** Replays completed external load, then combines it with today's real internal
 * readiness response. Historic external work must not disappear just because today's
 * HRV/check-in happens to be favourable. */
export function buildFatigueStateFromHistory(
    history: CompletedExposure[],
    internalStrain: DimensionalFatigue,
    asOfDate: string,
    fusionPolicy: FatigueFusionPolicy = 'max',
): FatigueState {
    let sortedHistory = history;
    // Assert chronological ordering invariant; sort if out of order to prevent silent mis-decay
    for (let i = 1; i < history.length; i++) {
        if (history[i].date < history[i - 1].date) {
            console.warn(`[buildFatigueStateFromHistory] Chronological ordering invariant violated: item at ${i} (${history[i].date}) is before ${history[i - 1].date}. Sorting history.`);
            sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date));
            break;
        }
    }

    const emptyCost: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const replayed = sortedHistory.reduce(
        (state, exposure) => applyCompletedSessionLoad(state, exposure.date, exposure.costProfile, fusionPolicy),
        createEmptyFatigue(sortedHistory[0]?.date ?? asOfDate)
    );
    const decayed = applyCompletedSessionLoad(replayed, asOfDate, emptyCost, fusionPolicy);
    const combined = combineFatigue(decayed.externalLoadFatigue, internalStrain, fusionPolicy);
    return { ...decayed, lastUpdatedDate: asOfDate, internalResponseStrain: internalStrain, combinedFatigue: combined };
}
