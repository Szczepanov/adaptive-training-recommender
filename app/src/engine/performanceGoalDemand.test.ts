import { describe, expect, it } from 'vitest';
import { goalToPerformanceGoalDemand, mapGoalsToPerformanceGoalDemands } from './performanceGoalDemand';
import type { UserGoal } from './models';

function testGoal(overrides: Partial<UserGoal> & { id?: string } = {}): UserGoal & { id?: string } {
    return {
        userId: 'athlete', category: 'long-term', domain: 'strength', title: 'Deadlift goal',
        priority: 4, status: 'active', schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        id: 'goal-1',
        performanceTarget: {
            kind: 'performance_metric',
            metricId: 'strength_1rm_kg',
            subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
            targetValue: 220,
        },
        targetDate: '2026-12-01',
        ...overrides,
    };
}

describe('goalToPerformanceGoalDemand (Stage 2/PG5.1)', () => {
    it('projects an active strength goal, preserving exact exercise identity', () => {
        const demand = goalToPerformanceGoalDemand(testGoal());
        expect(demand).toEqual({
            goalId: 'goal-1',
            metricId: 'strength_1rm_kg',
            subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
            family: 'strength',
            targetValue: 220,
            priority: 4,
            targetDate: '2026-12-01',
        });
    });

    it('keeps two different performance-test subjects distinguishable by performanceTestId', () => {
        const standing = goalToPerformanceGoalDemand(testGoal({
            id: 'goal-speed-1',
            domain: 'speed',
            performanceTarget: {
                kind: 'performance_metric',
                metricId: 'sprint_elapsed_time_s',
                subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
                targetValue: 1.75,
            },
        }));
        const other = goalToPerformanceGoalDemand(testGoal({
            id: 'goal-speed-2',
            domain: 'speed',
            performanceTarget: {
                kind: 'performance_metric',
                metricId: 'sprint_elapsed_time_s',
                subjectRef: { kind: 'performance_test', performanceTestId: 'a-different-test-id' },
                targetValue: 1.75,
            },
        }));
        expect(standing?.subjectRef).not.toEqual(other?.subjectRef);
    });

    it('changing targetValue does not change family or subjectRef, only the value itself', () => {
        const lower = goalToPerformanceGoalDemand(testGoal({
            performanceTarget: {
                kind: 'performance_metric', metricId: 'strength_1rm_kg',
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' }, targetValue: 100,
            },
        }));
        const higher = goalToPerformanceGoalDemand(testGoal({
            performanceTarget: {
                kind: 'performance_metric', metricId: 'strength_1rm_kg',
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' }, targetValue: 220,
            },
        }));
        expect(lower?.family).toBe(higher?.family);
        expect(lower?.subjectRef).toEqual(higher?.subjectRef);
        expect(lower?.goalId).toBe(higher?.goalId);
        expect(lower?.targetValue).toBe(100);
        expect(higher?.targetValue).toBe(220);
    });

    it('produces no demand for a paused, archived or completed goal', () => {
        expect(goalToPerformanceGoalDemand(testGoal({ status: 'paused' }))).toBeNull();
        expect(goalToPerformanceGoalDemand(testGoal({ status: 'archived' }))).toBeNull();
        expect(goalToPerformanceGoalDemand(testGoal({ status: 'completed' }))).toBeNull();
    });

    it('produces no demand for a legacy goal with no typed performanceTarget', () => {
        const demand = goalToPerformanceGoalDemand(testGoal({
            performanceTarget: undefined, targetMetric: 'deadlift', targetValue: 220, targetUnit: 'kg',
        }));
        expect(demand).toBeNull();
    });

    it('produces no demand for a goal missing a stable id -- there is no title-fallback identity path', () => {
        const demand = goalToPerformanceGoalDemand(testGoal({ id: undefined, title: 'Deadlift 220kg' }));
        expect(demand).toBeNull();
    });

    it('fails safe (returns null, never throws) for a metric with no registered target-eligibility policy', () => {
        const demand = goalToPerformanceGoalDemand(testGoal({
            performanceTarget: {
                kind: 'performance_metric', metricId: 'a_deregistered_metric',
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' }, targetValue: 220,
            },
        }));
        expect(demand).toBeNull();
    });
});

describe('mapGoalsToPerformanceGoalDemands', () => {
    it('filters nulls and applies priority/date/id order independent of caller or Firestore order', () => {
        const goals = [
            testGoal({ id: 'priority-3', priority: 3, targetDate: '2026-10-01' }),
            testGoal({ id: 'same-date-z', priority: 5, targetDate: '2026-12-01' }),
            testGoal({ id: 'open-ended', priority: 5, targetDate: undefined }),
            testGoal({ id: 'later-date', priority: 5, targetDate: '2027-01-01' }),
            testGoal({ id: 'same-date-a', priority: 5, targetDate: '2026-12-01' }),
            testGoal({ id: 'filtered-paused', priority: 5, targetDate: '2026-01-01', status: 'paused' }),
        ];
        const expected = ['same-date-a', 'same-date-z', 'later-date', 'open-ended', 'priority-3'];

        expect(mapGoalsToPerformanceGoalDemands(goals).map(d => d.goalId)).toEqual(expected);
        expect(mapGoalsToPerformanceGoalDemands([...goals].reverse()).map(d => d.goalId)).toEqual(expected);
    });
});
