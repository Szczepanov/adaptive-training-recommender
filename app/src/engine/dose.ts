import type { PlanEnvelope } from './models';

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

function clampDose(dose: number): number {
    return Math.max(0, Math.min(1, dose));
}

/**
 * Resolves the concrete session dose from the plan's desired dose, the independent
 * clinical/readiness ceiling, and an optional athlete adjustment. An athlete can make
 * a session easier at any time, but a harder request is never allowed to exceed the
 * readiness/clinical ceiling.
 */
export function resolveExecutionDose(
    plannedDose: number,
    safety: PlanEnvelope,
    userAdjustment: 'easier' | 'harder' | null
): number {
    const adjustment = userAdjustment === 'easier'
        ? -USER_ADJUSTMENT_DELTA
        : userAdjustment === 'harder'
            ? USER_ADJUSTMENT_DELTA
            : 0;
    const requestedDose = clampDose(plannedDose + adjustment);
    return Math.min(requestedDose, MAX_EXECUTION_DOSE_BY_TIER[safety.maxAllowableTier]);
}
