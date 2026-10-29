const RUN_OR_FIELD_SPORT_REGEX = /run|soccer|football|trail/i;
const WALK_OR_HIKE_REGEX = /walk|hike/i;

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
 * Deducts estimated structured-activity steps from D-1 total steps, flooring at 0
 * and preserving null when total steps were not recorded (ADR-0003 / I3).
 */
export function deriveAmbientSteps(
    totalSteps: number | null | undefined,
    yesterdayTraining: { type?: string; duration_min?: number } | null | undefined,
): { activitySteps: number; ambientSteps: number | null } {
    const activitySteps = estimateActivitySteps(yesterdayTraining);
    const ambientSteps = totalSteps !== null && totalSteps !== undefined
        ? Math.max(0, totalSteps - activitySteps)
        : null;
    return { activitySteps, ambientSteps };
}
