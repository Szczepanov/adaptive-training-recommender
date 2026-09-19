/**
 * PG1.3/ADR-0041: the smallest goal-specific policy layer needed to map a registered
 * observations metric onto a strength/speed/power performance-goal family and an
 * eligible subject shape. This owns none of unit, direction, protocol instructions or
 * comparison-series logic -- those stay owned by app/src/observations/*.
 *
 * Deliberately zero imports from observations/* or workouts/* (Stage 2/PG5.1): this
 * module is reachable from production selection/ranking modules (optimizer.ts,
 * planner.ts, rules.ts, evergreenPlanning.ts, sequenceSearch.ts) via
 * engine/adapters.ts -> engine/eligibility.ts, and observations/architecture.test.ts's
 * OV1.4 boundary forbids those modules from reaching observations/* even transitively.
 * Semantic validators that DO need observations/workouts registries
 * (validatePerformanceTarget, validatePerformanceTargetForDomain) live in the sibling
 * engine/performanceTargetValidation.ts instead, which only goalService.ts (not
 * reachable from any selection module) and the Goals.tsx UI import.
 */
export type PerformanceGoalFamily = 'strength' | 'speed' | 'power';

export type PerformanceSubjectRef =
    | { kind: 'exercise'; exerciseId: string }
    | { kind: 'performance_test'; performanceTestId: string };

export interface GoalPerformanceTarget {
    kind: 'performance_metric';
    metricId: string;
    subjectRef: PerformanceSubjectRef;
    targetValue: number;
}

export interface PerformanceTargetPolicy {
    metricId: string;
    family: PerformanceGoalFamily;
    subjectKind: PerformanceSubjectRef['kind'];
    /** Structural plausibility bound only -- not a feasibility judgment. */
    targetRange?: { min: number; max: number };
    /** `exercise` subjects only: canonical exercise ids eligible for this metric. */
    eligibleExerciseIds?: readonly string[];
}

/**
 * First vertical slice (ADR-0041): one representative target per family, plus the
 * catalog-verified deadlift/front-squat/bench-press strength exercises. Extending this
 * list is a registry/policy edit, never a new goal subsystem.
 */
export const PERFORMANCE_TARGET_POLICIES: readonly PerformanceTargetPolicy[] = [
    {
        metricId: 'strength_1rm_kg',
        family: 'strength',
        subjectKind: 'exercise',
        targetRange: { min: 1, max: 500 },
        eligibleExerciseIds: ['conventional_deadlift', 'front_squat', 'bench_press', 'romanian_deadlift'],
    },
    {
        metricId: 'sprint_elapsed_time_s',
        family: 'speed',
        subjectKind: 'performance_test',
        targetRange: { min: 0.5, max: 10 },
    },
    {
        metricId: 'cycling_5s_peak_power_w',
        family: 'power',
        subjectKind: 'performance_test',
        targetRange: { min: 50, max: 3000 },
    },
];

const POLICY_BY_METRIC_ID = new Map(PERFORMANCE_TARGET_POLICIES.map(policy => [policy.metricId, policy] as const));

export function getPerformanceTargetPolicy(metricId: string): PerformanceTargetPolicy | null {
    return POLICY_BY_METRIC_ID.get(metricId) ?? null;
}

export function isPerformanceTargetEligibleMetric(metricId: string): boolean {
    return POLICY_BY_METRIC_ID.has(metricId);
}

export function listPerformanceTargetPolicies(): readonly PerformanceTargetPolicy[] {
    return PERFORMANCE_TARGET_POLICIES;
}
