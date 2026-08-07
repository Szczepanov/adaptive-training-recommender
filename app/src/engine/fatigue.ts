import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    WorkoutCostProfile,
} from './models';

export const DECAY_HALF_LIVES_HOURS: Record<keyof DimensionalFatigue, number> = {
    systemic: 36,
    cardiovascular: 24,
    lowerBody: 48,
    upperBody: 36,
    impactTissue: 48,
    neuromuscular: 36,
};

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

    const systemic = Math.min(1, 0.4 * subFatigue + 0.3 * hrvDrop + 0.3 * sleepDeficit);
    const cardiovascular = Math.min(1, 0.5 * rhrElevated + 0.5 * hrvDrop);
    const lowerBody = subSoreness;
    const upperBody = subSoreness * 0.7; // default soreness split
    const impactTissue = subSoreness;
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
    costProfile: WorkoutCostProfile
): FatigueState {
    // 1. Calculate hours between last update and completed session date
    const d1 = new Date(currentState.lastUpdatedDate + 'T00:00:00');
    const d2 = new Date(completedDateStr + 'T00:00:00');
    const elapsedHours = Math.max(0, (d2.getTime() - d1.getTime()) / (1000 * 60 * 60));

    // 2. Decay previous external load
    const decayedExternal = decayFatigue(currentState.externalLoadFatigue, elapsedHours);

    // 3. Add new session cost to external load
    const newExternal: DimensionalFatigue = {
        systemic: Math.min(1, decayedExternal.systemic + costProfile.systemic),
        cardiovascular: Math.min(1, decayedExternal.cardiovascular + costProfile.cardiovascular),
        lowerBody: Math.min(1, decayedExternal.lowerBody + costProfile.lowerBody),
        upperBody: Math.min(1, decayedExternal.upperBody + costProfile.upperBody),
        impactTissue: Math.min(1, decayedExternal.impactTissue + costProfile.impactTissue),
        neuromuscular: Math.min(1, decayedExternal.neuromuscular + costProfile.neuromuscular),
    };

    // 4. Combined fatigue = max(externalLoad, internalResponse)
    const combined: DimensionalFatigue = {
        systemic: Math.max(newExternal.systemic, currentState.internalResponseStrain.systemic),
        cardiovascular: Math.max(newExternal.cardiovascular, currentState.internalResponseStrain.cardiovascular),
        lowerBody: Math.max(newExternal.lowerBody, currentState.internalResponseStrain.lowerBody),
        upperBody: Math.max(newExternal.upperBody, currentState.internalResponseStrain.upperBody),
        impactTissue: Math.max(newExternal.impactTissue, currentState.internalResponseStrain.impactTissue),
        neuromuscular: Math.max(newExternal.neuromuscular, currentState.internalResponseStrain.neuromuscular),
    };

    return {
        lastUpdatedDate: completedDateStr,
        externalLoadFatigue: newExternal,
        internalResponseStrain: currentState.internalResponseStrain,
        combinedFatigue: combined,
    };
}
