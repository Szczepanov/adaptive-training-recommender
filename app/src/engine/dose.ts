import type { PlannedDose, PlanEnvelope } from './models';

/** Execution dose is a normalized 0..1 input to structured-workout variant selection.
 * It is intentionally separate from a template's raw systemic cost: Phase 3b derives
 * the desired dose from objectives and periodization, while this module only makes the
 * final safety/user-adjustment intersection. */
const MAX_EXECUTION_DOSE_BY_TIER: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0,
    Mobility: 0.2,
    Easy: 0.5,
    Moderate: 0.8,
    Hard: 1,
};

const USER_ADJUSTMENT_DELTA = 0.15;
const MAX_PLANNED_INTENSITY = 1.2;

function clampDose(dose: number): number {
    return Math.max(0, Math.min(1, dose));
}

function isValidPlannedDose(dose: PlannedDose): boolean {
    return Number.isFinite(dose.volume)
        && Number.isFinite(dose.intensity)
        && dose.intensity >= 0
        && dose.intensity <= MAX_PLANNED_INTENSITY;
}

/**
 * Resolves the concrete session dose from the plan's desired dose, the independent
 * clinical/readiness ceiling, and an optional athlete adjustment. An athlete can make
 * a session easier at any time, but a harder request is never allowed to exceed the
 * readiness/clinical ceiling.
 *
 * Invalid/non-finite inputs fail closed. They must not be normalized into a seemingly
 * valid recommendation because persisted recommendation audits require finite volume in
 * 0..1 and intensity in 0..1.2.
 */
export function resolveExecutionDose(
    plannedDose: PlannedDose,
    safety: PlanEnvelope,
    userAdjustment: 'easier' | 'harder' | null
): PlannedDose | undefined {
    if (!isValidPlannedDose(plannedDose)) return undefined;

    const adjustment = userAdjustment === 'easier'
        ? -USER_ADJUSTMENT_DELTA
        : userAdjustment === 'harder'
            ? USER_ADJUSTMENT_DELTA
            : 0;
    const requestedVolume = clampDose(plannedDose.volume + adjustment);
    return {
        volume: Math.min(requestedVolume, MAX_EXECUTION_DOSE_BY_TIER[safety.maxAllowableTier]),
        // Intensity is not a duration ceiling. It was already consumed as a candidate
        // admissibility gate before the selected template reached execution dosing.
        intensity: plannedDose.intensity,
    };
}
