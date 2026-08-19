import { describe, expect, it } from 'vitest';
import {
    matchExecutionsToGarminActivities,
    sessionExecutionOccurrenceKey,
    summarizeExecutionForReconciliation,
    type ExecutionOccurrenceSummary,
} from './occurrenceReconciliation';
import type { NormalizedGarminActivity } from '../engine/models';

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'act-1', date: '2026-08-19', type: 'cycling', durationMin: 30,
        trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null,
        activityTrainingLoad: null, intensityTag: 'easy',
        ...overrides,
    };
}

function execution(overrides: Partial<ExecutionOccurrenceSummary> = {}): ExecutionOccurrenceSummary {
    return { executionId: 'exec-1', date: '2026-08-19', modality: 'cycling', durationMin: 28, ...overrides };
}

describe('sessionExecutionOccurrenceKey', () => {
    it('keys by occurrenceId when the execution has selection authority', () => {
        expect(sessionExecutionOccurrenceKey({ executionId: 'e1', occurrenceId: 'occ-1' })).toBe('occurrence:occ-1');
    });

    it('keys by executionId for an unplanned/companion execution with no occurrence', () => {
        expect(sessionExecutionOccurrenceKey({ executionId: 'e1' })).toBe('execution:e1');
    });
});

describe('summarizeExecutionForReconciliation', () => {
    it('computes duration in minutes from started/completed timestamps', () => {
        const summary = summarizeExecutionForReconciliation({
            executionId: 'e1', date: '2026-08-19',
            startedAt: '2026-08-19T10:00:00.000Z', completedAt: '2026-08-19T10:28:00.000Z',
        }, 'cycling');
        expect(summary).toEqual({ executionId: 'e1', occurrenceId: undefined, date: '2026-08-19', modality: 'cycling', durationMin: 28 });
    });

    it('reports null duration for a still-in-progress execution', () => {
        const summary = summarizeExecutionForReconciliation({
            executionId: 'e1', date: '2026-08-19', startedAt: '2026-08-19T10:00:00.000Z',
        });
        expect(summary.durationMin).toBeNull();
    });
});

describe('matchExecutionsToGarminActivities', () => {
    it('matches a companion execution to the corresponding Garmin ride within tolerance', () => {
        const matches = matchExecutionsToGarminActivities([execution()], [activity()]);
        expect(matches).toEqual([{ executionId: 'exec-1', activityId: 'act-1', executionDurationMin: 28, activityDurationMin: 30 }]);
    });

    it('does not match across a different date', () => {
        const matches = matchExecutionsToGarminActivities([execution()], [activity({ date: '2026-08-18' })]);
        expect(matches).toEqual([]);
    });

    it('does not match across an incompatible modality', () => {
        const matches = matchExecutionsToGarminActivities([execution({ modality: 'strength' })], [activity({ type: 'cycling' })]);
        expect(matches).toEqual([]);
    });

    it('matches on date/duration alone when the execution has no resolved modality', () => {
        const matches = matchExecutionsToGarminActivities([execution({ modality: undefined })], [activity({ type: 'unknown_sport' })]);
        expect(matches).toHaveLength(1);
    });

    it('does not match outside the duration tolerance', () => {
        const matches = matchExecutionsToGarminActivities([execution({ durationMin: 5 })], [activity({ durationMin: 60 })]);
        expect(matches).toEqual([]);
    });

    it('never matches an execution with no completed duration', () => {
        const matches = matchExecutionsToGarminActivities([execution({ durationMin: null })], [activity()]);
        expect(matches).toEqual([]);
    });

    it('claims each Garmin activity for at most one execution, preferring the closer duration match', () => {
        const matches = matchExecutionsToGarminActivities(
            [execution({ executionId: 'exec-a', durationMin: 29 }), execution({ executionId: 'exec-b', durationMin: 20 })],
            [activity({ durationMin: 30 })],
        );
        // Both are within tolerance of the same single activity; sorted execution order
        // (exec-a before exec-b) claims it first -- exactly one match, never two, for one
        // Garmin activity.
        expect(matches).toEqual([{ executionId: 'exec-a', activityId: 'act-1', executionDurationMin: 29, activityDurationMin: 30 }]);
    });

    it('never matches the same Garmin activity to two different executions', () => {
        const matches = matchExecutionsToGarminActivities(
            [execution({ executionId: 'exec-a' }), execution({ executionId: 'exec-b' })],
            [activity()],
        );
        expect(matches).toHaveLength(1);
    });
});
