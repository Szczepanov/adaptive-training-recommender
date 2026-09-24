import { describe, expect, it } from 'vitest';
import {
    PERFORMANCE_GOAL_PLANNING_RULES,
    directCoverageExerciseIds,
    getPerformanceGoalPlanningRule,
    workoutProvidesDirectCoverage,
    type PerformanceGoalPlanningRule,
} from './performanceGoalPlanningRules';
import { PERFORMANCE_TARGET_POLICIES } from './performanceTargetPolicy';
import { getPerformanceTestDefinition } from '../observations/performanceTestingCatalog';
import { WORKOUTS, WORKOUTS_BY_ID } from '../workouts/catalog';
import { EXERCISES_BY_ID } from '../workouts/exercises';
import type { WorkoutDefinition } from '../workouts/models';
import { repsStep, timeStep } from '../workouts/catalog/helpers';

function requireWorkout(id: string): WorkoutDefinition {
    const workout = WORKOUTS_BY_ID.get(id);
    if (!workout) throw new Error(`Expected catalog workout "${id}" to exist`);
    return workout;
}

function requireSeedWorkout(): WorkoutDefinition {
    const seed = WORKOUTS.find(workout => workout.status === 'active');
    if (!seed) throw new Error('Expected at least one active workout fixture');
    return seed;
}

function workoutWithBlocks(overrides: Partial<WorkoutDefinition>): WorkoutDefinition {
    return { ...requireSeedWorkout(), ...overrides };
}

describe('PERFORMANCE_GOAL_PLANNING_RULES / PERFORMANCE_TARGET_POLICIES alignment', () => {
    it('registers exactly one planning rule per target-eligible metric, with matching family', () => {
        const policyMetricIds = PERFORMANCE_TARGET_POLICIES.map(policy => policy.metricId).sort();
        const ruleMetricIds = PERFORMANCE_GOAL_PLANNING_RULES.map(rule => rule.metricId).sort();
        expect(ruleMetricIds).toEqual(policyMetricIds);

        for (const policy of PERFORMANCE_TARGET_POLICIES) {
            const rule = getPerformanceGoalPlanningRule(policy.metricId);
            expect(rule, `Expected a planning rule for ${policy.metricId}`).not.toBeNull();
            expect(rule?.family).toBe(policy.family);
            expect(rule?.directCoverage.subjectKind).toBe(policy.subjectKind);
        }
    });

    it('references registered performance tests and canonical training exercises', () => {
        for (const rule of PERFORMANCE_GOAL_PLANNING_RULES) {
            if (rule.directCoverage.subjectKind !== 'performance_test') continue;
            for (const [performanceTestId, exerciseIds] of Object.entries(
                rule.directCoverage.exerciseIdsByPerformanceTestId,
            )) {
                const testDefinition = getPerformanceTestDefinition(performanceTestId);
                expect(
                    testDefinition.protocol.metricIds,
                    `${performanceTestId} must declare planning-rule metric ${rule.metricId}`,
                ).toContain(rule.metricId);
                for (const exerciseId of exerciseIds) {
                    expect(
                        EXERCISES_BY_ID.has(exerciseId),
                        `${rule.metricId}/${performanceTestId} references unknown exercise ${exerciseId}`,
                    ).toBe(true);
                }
            }
        }
    });

    it('returns null for an unregistered metric', () => {
        expect(getPerformanceGoalPlanningRule('unknown_metric_id')).toBeNull();
    });
});

describe('directCoverageExerciseIds', () => {
    const strengthRule = getPerformanceGoalPlanningRule('strength_1rm_kg')!;
    const speedRule = getPerformanceGoalPlanningRule('sprint_elapsed_time_s')!;

    it('returns the exact same exerciseId for an exercise-subject rule', () => {
        expect(directCoverageExerciseIds(strengthRule, { kind: 'exercise', exerciseId: 'conventional_deadlift' }))
            .toEqual(['conventional_deadlift']);
        expect(directCoverageExerciseIds(strengthRule, { kind: 'exercise', exerciseId: 'front_squat' }))
            .toEqual(['front_squat']);
    });

    it('returns null for an exercise id outside the metric policy allowlist', () => {
        expect(directCoverageExerciseIds(strengthRule, { kind: 'exercise', exerciseId: 'typo_deadlift' }))
            .toBeNull();
    });

    it('returns null when subjectRef.kind does not match the rule subjectKind', () => {
        expect(directCoverageExerciseIds(strengthRule, { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' }))
            .toBeNull();
        expect(directCoverageExerciseIds(speedRule, { kind: 'exercise', exerciseId: 'conventional_deadlift' }))
            .toBeNull();
    });

    it('returns the registered training exerciseIds for a known performance-test subject', () => {
        expect(directCoverageExerciseIds(speedRule, { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' }))
            .toEqual(['sprint_falling_start_10m']);
    });

    it('returns null for a performance-test id that has no explicit reviewed registry entry', () => {
        expect(directCoverageExerciseIds(speedRule, { kind: 'performance_test', performanceTestId: 'sprint_flying_10m-r1' }))
            .toBeNull();
    });

    it('returns an empty array only when the registry explicitly declares a reviewed coverage gap', () => {
        const explicitGapRule: PerformanceGoalPlanningRule = {
            metricId: 'synthetic_speed_metric',
            family: 'speed',
            broadAdaptation: 'high_intensity',
            directCoverage: {
                subjectKind: 'performance_test',
                exerciseIdsByPerformanceTestId: { 'synthetic-reviewed-test-r1': [] },
            },
            rationale: 'Synthetic unit fixture for explicit-empty coverage semantics.',
        };
        expect(directCoverageExerciseIds(
            explicitGapRule,
            { kind: 'performance_test', performanceTestId: 'synthetic-reviewed-test-r1' },
        )).toEqual([]);
    });
});

describe('workoutProvidesDirectCoverage against the real catalog', () => {
    it('credits an active workout containing the exact targeted exercise (front squat, bench press)', () => {
        const workout = requireWorkout('strength_full_body_maintenance_01');
        expect(workoutProvidesDirectCoverage(workout, 'strength_1rm_kg', { kind: 'exercise', exerciseId: 'front_squat' })).toBe(true);
        expect(workoutProvidesDirectCoverage(workout, 'strength_1rm_kg', { kind: 'exercise', exerciseId: 'bench_press' })).toBe(true);
    });

    it('does not credit a Romanian-deadlift-only workout for a conventional-deadlift goal (plan acceptance scenario A)', () => {
        const workout = requireWorkout('strength_full_body_maintenance_01');
        expect(workoutProvidesDirectCoverage(workout, 'strength_1rm_kg', { kind: 'exercise', exerciseId: 'conventional_deadlift' })).toBe(false);
    });

    it('closes the PG6 conventional-deadlift catalog gap with exact-lift direct practice', () => {
        const workout = requireWorkout('strength_conventional_deadlift_practice_01');
        expect(workout.status).toBe('active');
        expect(workoutProvidesDirectCoverage(
            workout,
            'strength_1rm_kg',
            { kind: 'exercise', exerciseId: 'conventional_deadlift' },
        )).toBe(true);
        expect(WORKOUTS.some(candidate => candidate.status === 'active' && workoutProvidesDirectCoverage(
            candidate,
            'strength_1rm_kg',
            { kind: 'exercise', exerciseId: 'conventional_deadlift' },
        ))).toBe(true);
    });

    it('credits the active field-technique workouts for a standing 10 m speed target', () => {
        const workout = requireWorkout('field_sprint_mechanics_foundation_01');
        expect(workoutProvidesDirectCoverage(
            workout,
            'sprint_elapsed_time_s',
            { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
        )).toBe(true);
    });

    it('closes the PG6 cycling peak-power catalog gap with the exact maximal-sprint exercise', () => {
        const workout = requireWorkout('cycling_sprint_power_5s_01');
        expect(workout.status).toBe('active');
        expect(workoutProvidesDirectCoverage(
            workout,
            'cycling_5s_peak_power_w',
            { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
        )).toBe(true);
        expect(WORKOUTS.some(candidate => candidate.status === 'active' && workoutProvidesDirectCoverage(
            candidate,
            'cycling_5s_peak_power_w',
            { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
        ))).toBe(true);
    });

    it('keeps return-to-training variants from masquerading as delivered direct coverage', () => {
        const cases = [
            ['strength_conventional_deadlift_practice_01', 'deadlift_main'],
            ['cycling_sprint_power_5s_01', 'sprint_power_main'],
        ] as const;

        for (const [workoutId, directStepId] of cases) {
            const workout = requireWorkout(workoutId);
            const returnVariant = workout.variants.find(variant => variant.id === 'return_to_training');
            expect(returnVariant, `${workoutId} must expose a return-to-training variant`).toBeDefined();
            expect(returnVariant?.stepOverrides).toContainEqual(expect.objectContaining({
                stepId: directStepId,
                omit: true,
            }));
        }
    });

    it('does not credit a submaximal cycling surge workout for the maximal 5 s peak-power target', () => {
        const surgeWorkout = WORKOUTS.find(workout => workout.blocks.some(block => block.steps.some(step => step.exerciseId === 'bike_short_surge')));
        expect(surgeWorkout, 'Expected a catalog workout using bike_short_surge').toBeDefined();
        expect(workoutProvidesDirectCoverage(
            surgeWorkout!,
            'cycling_5s_peak_power_w',
            { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
        )).toBe(false);
    });
});

describe('workoutProvidesDirectCoverage with synthetic fixtures', () => {
    it('credits a synthetic workout once the exact maximal cycling-sprint exercise is present', () => {
        const workout = workoutWithBlocks({
            id: 'test_cycling_sprint_power',
            blocks: [{ id: 'main', name: 'Main', role: 'main', steps: [
                timeStep('sprint', 'bike_sprint_power', 'Maximal cycling sprint', 10),
            ] }],
        });
        expect(workoutProvidesDirectCoverage(
            workout,
            'cycling_5s_peak_power_w',
            { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
        )).toBe(true);
    });

    it('returns false for an unregistered metricId rather than throwing', () => {
        const workout = workoutWithBlocks({ id: 'test_unknown_metric' });
        expect(workoutProvidesDirectCoverage(workout, 'unknown_metric_id', { kind: 'exercise', exerciseId: 'conventional_deadlift' })).toBe(false);
    });

    it('returns false rather than throwing when subjectRef.kind mismatches the registered rule', () => {
        const workout = workoutWithBlocks({ id: 'test_mismatched_subject' });
        expect(workoutProvidesDirectCoverage(
            workout,
            'strength_1rm_kg',
            { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
        )).toBe(false);
    });

    it('returns false for an unreviewed performance-test subject instead of treating it as a coverage gap', () => {
        const workout = workoutWithBlocks({ id: 'test_unreviewed_performance_test' });
        expect(workoutProvidesDirectCoverage(
            workout,
            'sprint_elapsed_time_s',
            { kind: 'performance_test', performanceTestId: 'sprint_flying_10m-r1' },
        )).toBe(false);
    });

    it('is unaffected by target value -- coverage identity does not change with the number', () => {
        const workout = workoutWithBlocks({
            id: 'test_value_independence',
            blocks: [{ id: 'main', name: 'Main', role: 'main', steps: [
                repsStep('squat', 'front_squat', 'Front squat', 5),
            ] }],
        });
        const subjectRef = { kind: 'exercise' as const, exerciseId: 'front_squat' };
        expect(workoutProvidesDirectCoverage(workout, 'strength_1rm_kg', subjectRef)).toBe(true);
    });
});
