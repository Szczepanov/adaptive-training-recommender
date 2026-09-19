import type { AdaptationKey } from './evergreenStrategy';
import type { PerformanceGoalFamily, PerformanceSubjectRef } from './performanceTargetPolicy';
import type { WorkoutDefinition } from '../workouts/models';

/**
 * Stage 2/PG5.2 (plan section "PG5 -- goal-to-planning projection and coverage semantics"):
 * the reviewed mapping from a target-eligible metric to (a) the existing evergreen dose
 * vocabulary its broad demand should refine and (b) which canonical training exerciseIds
 * count as direct/specific coverage for the athlete's exact declared subject.
 *
 * `broadAdaptation` is typed as the existing `AdaptationKey` from evergreenStrategy.ts on
 * purpose -- the plan's PG5.2 section explicitly forbids inventing a new broad-adaptation
 * string merely to make this table compile, so the type system rejects that rather than a
 * lint rule. No new AdaptationKey value is introduced here.
 *
 * Coverage classification resolves against `WorkoutDefinition.blocks[].steps[].exerciseId`
 * (`workouts/models.ts`), the schema the evergreen dose-packing pipeline
 * (`weeklyDosePacking.ts`'s `exactWorkoutIds`/`EVERGREEN_PACKING_COVERAGE`) actually resolves
 * coverage through -- not the `sessions/models.ts` `SessionStep.exerciseRef` schema targeted
 * by `authoredSessionProfiles.ts`'s `requiredExerciseSteps`/`classifyStep`, which is a
 * different, still-inert pipeline (see this capability's
 * docs/analysis/2026-09-19-stage2-weekly-allocation-integration-points.md, section 5, which
 * scoped this exact schema question before this file was written).
 *
 * Per plan P4 ("outcome-test identity and training coverage are different"), a
 * `performance_test` subject's direct-coverage exerciseIds are deliberately NOT the test's own
 * protocol/session exercise -- they are ordinary training movements that build the tested
 * quality (e.g. `sprint_10m_standing-r1` is covered by acceleration practice
 * `sprint_falling_start_10m`, not by scheduling the formal timed test itself every week).
 *
 * PG5.2 only: this module has no production consumer yet
 * (performanceGoalPlanningRules.architecture.test.ts enforces that), matching PG5.1's
 * shipped-but-unread pattern. PG7 wires `workoutProvidesDirectCoverage` into real weekly
 * allocation/reservation once the priority-tier ADR referenced by the plan's PG5
 * "Recommended next-session sequencing" note exists.
 */

type DirectCoverageRule =
    | { subjectKind: 'exercise' }
    | {
        subjectKind: 'performance_test';
        /** Keyed by PerformanceTestDefinition id (app/src/observations/performanceTestingCatalog.ts). */
        exerciseIdsByPerformanceTestId: Readonly<Record<string, readonly string[]>>;
    };

export interface PerformanceGoalPlanningRule {
    /** Same identity as PerformanceTargetPolicy.metricId (engine/performanceTargetPolicy.ts). */
    metricId: string;
    family: PerformanceGoalFamily;
    /** Existing evergreen dose channel this target's broad demand should refine (PG5.3), never a
     *  second parallel requirement for the same adaptation. */
    broadAdaptation: AdaptationKey;
    directCoverage: DirectCoverageRule;
    /** One-line product rationale. Documentation only -- never read by the classifier. */
    rationale: string;
}

/**
 * First vertical slice (mirrors PERFORMANCE_TARGET_POLICIES' three metrics exactly --
 * performanceGoalPlanningRules.test.ts asserts that 1:1 correspondence so the two registries
 * cannot silently drift apart). Extending this list is a registry edit, never a new subsystem.
 */
export const PERFORMANCE_GOAL_PLANNING_RULES: readonly PerformanceGoalPlanningRule[] = [
    {
        metricId: 'strength_1rm_kg',
        family: 'strength',
        broadAdaptation: 'strength',
        // Exercise-subject targets: direct coverage is the exact same canonical exercise the
        // athlete targeted. A Romanian-deadlift-only workout must not credit a
        // conventional-deadlift goal (plan acceptance scenario A) -- there is deliberately no
        // substitution/near-neighbor table here.
        directCoverage: { subjectKind: 'exercise' },
        rationale: 'A tested 1RM target requires meaningful direct practice of that exact lift; '
            + 'PG1\'s eligibleExerciseIds already bounds which exercises may be targeted.',
    },
    {
        metricId: 'sprint_elapsed_time_s',
        family: 'speed',
        broadAdaptation: 'high_intensity',
        directCoverage: {
            subjectKind: 'performance_test',
            exerciseIdsByPerformanceTestId: {
                // 'sprint_10m_standing-r1': app/src/observations/performanceTestingCatalog.ts.
                // 'sprint_falling_start_10m': app/src/workouts/exercises-base.ts -- already used
                // by active catalog workouts field_sprint_mechanics_foundation_01 and
                // field_acceleration_braking_01 (workouts/catalog/field-technique.ts).
                'sprint_10m_standing-r1': ['sprint_falling_start_10m'],
            },
        },
        rationale: 'A standing-start sprint target is driven by acceleration-oriented practice, '
            + 'not weekly maximal-effort testing (plan P4/G).',
    },
    {
        metricId: 'cycling_5s_peak_power_w',
        family: 'power',
        broadAdaptation: 'high_intensity',
        directCoverage: {
            subjectKind: 'performance_test',
            exerciseIdsByPerformanceTestId: {
                // 'cycling_5s_peak_power-r1': app/src/observations/performanceTestingCatalog.ts.
                // 'bike_sprint_power': app/src/workouts/exercises-base.ts -- declared in the
                // exercise catalog but NOT YET used by any active WorkoutDefinition as of this
                // writing (a real PG6 gap; see this rule's directCoverage returning a non-empty
                // exerciseId list with zero matching active workouts today,
                // performanceGoalPlanningRules.test.ts documents this explicitly). The existing
                // bike_short_surge exercise is deliberately excluded: its own catalog notes say
                // "Do not turn every surge into a sprint test," so crediting it here would
                // silently satisfy a maximal-power target with submaximal work.
                'cycling_5s_peak_power-r1': ['bike_sprint_power'],
            },
        },
        rationale: 'A 5 s peak-power target is driven by short maximal cycling-sprint practice, '
            + 'reusing the existing maximal cycling-sprint exercise rather than crediting '
            + 'submaximal surge work.',
    },
];

const RULE_BY_METRIC_ID = new Map(PERFORMANCE_GOAL_PLANNING_RULES.map(rule => [rule.metricId, rule] as const));

export function getPerformanceGoalPlanningRule(metricId: string): PerformanceGoalPlanningRule | null {
    return RULE_BY_METRIC_ID.get(metricId) ?? null;
}

/**
 * Direct/specific-coverage exerciseIds for one goal's exact declared subject.
 *
 * Returns:
 * - `null` when no rule is registered for `metricId`, or the rule's subjectKind does not match
 *   `subjectRef.kind` -- both indicate data inconsistent with PG1's policy and must never
 *   silently degrade to "no coverage ids" the way an empty array does;
 * - `[]` when the subject is legitimately eligible but no direct-coverage exercise is
 *   registered for that exact performance-test subject yet -- a real, explicit PG6 catalog
 *   gap, not an error;
 * - a non-empty list of canonical training exerciseIds otherwise.
 */
export function directCoverageExerciseIds(
    rule: PerformanceGoalPlanningRule,
    subjectRef: PerformanceSubjectRef,
): readonly string[] | null {
    if (subjectRef.kind === 'exercise') {
        if (rule.directCoverage.subjectKind !== 'exercise') return null;
        return [subjectRef.exerciseId];
    }
    if (rule.directCoverage.subjectKind !== 'performance_test') return null;
    return rule.directCoverage.exerciseIdsByPerformanceTestId[subjectRef.performanceTestId] ?? [];
}

/**
 * Whether `workout` provides direct/specific coverage for the exact subject a performance goal
 * declares, per `WorkoutStep.exerciseId` across every block. Pure and read-only: never mutates
 * `workout`, never consults target value, current capability or dose.
 */
export function workoutProvidesDirectCoverage(
    workout: WorkoutDefinition,
    metricId: string,
    subjectRef: PerformanceSubjectRef,
): boolean {
    const rule = getPerformanceGoalPlanningRule(metricId);
    if (!rule) return false;
    const exerciseIds = directCoverageExerciseIds(rule, subjectRef);
    if (!exerciseIds || exerciseIds.length === 0) return false;
    const eligible = new Set(exerciseIds);
    return workout.blocks.some(block => block.steps.some(step => eligible.has(step.exerciseId)));
}
