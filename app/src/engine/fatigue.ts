import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    WorkoutCostProfile,
} from './models';
import type { CompletedExposure } from './microcycleHistory';

export const DECAY_HALF_LIVES_HOURS: Record<keyof DimensionalFatigue, number> = {
    systemic: 36,
    cardiovascular: 24,
    lowerBody: 48,
    upperBody: 36,
    impactTissue: 48,
    neuromuscular: 36,
};

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
    const decayed: DimensionalFatigue = { ...fatigue };

    (Object.keys(DECAY_HALF_LIVES_HOURS) as (keyof DimensionalFatigue)[]).forEach(dim => {
        const halfLife = DECAY_HALF_LIVES_HOURS[dim];
        decayed[dim] = Math.max(0, fatigue[dim] * Math.pow(0.5, elapsedHours / halfLife));
    });

    return decayed;
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
    // Triggers when yesterday's step count is >= 1.8x the 7-day average AND >= +6,000 steps above baseline.
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
        const excessSteps = totalSteps - steps7dAvg;
        const surgeRatio = totalSteps / steps7dAvg;
        if (surgeRatio >= 1.8 && excessSteps >= 6000) {
            // Scale smoothly up to a 0.4 dampening cap for a +15,000 excess step surge
            ambulatoryTissueStrain = Math.min(0.4, (excessSteps / 15000) * 0.4);
        }
    }

    const systemic = Math.min(1, 0.4 * subFatigue + 0.3 * hrvDrop + 0.3 * sleepDeficit + 0.5 * ambulatoryTissueStrain);
    const cardiovascular = Math.min(1, 0.5 * rhrElevated + 0.5 * hrvDrop);
    const lowerBody = Math.min(1, subSoreness + ambulatoryTissueStrain);
    const upperBody = subSoreness * 0.7; // default soreness split
    const impactTissue = Math.min(1, subSoreness + ambulatoryTissueStrain);
    const neuromuscular = Math.min(1, 0.5 * subFatigue + 0.5 * (1 - (subjective.motivation / 10)));

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
    const d1 = new Date(currentState.lastUpdatedDate + 'T00:00:00');
    const d2 = new Date(completedDateStr + 'T00:00:00');
    const elapsedHours = Math.max(0, (d2.getTime() - d1.getTime()) / (1000 * 60 * 60));

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
