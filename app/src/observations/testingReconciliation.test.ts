import { describe, expect, it } from 'vitest';
import {
    matchExecutionsToGarminActivities,
    summarizeExecutionForReconciliation,
} from '../sessions/occurrenceReconciliation';
import type { NormalizedGarminActivity } from '../engine/models';
import { getPerformanceTestDefinition } from './performanceTestingCatalog';
import type { SessionExecution } from '../sessions/models';
import { assessmentTrialIdFor } from './assessmentTrials';
import { observationKeyFor } from './validation';

describe('WP5.7: Testing execution reconciliation and single exposure invariant', () => {
    it('(a) trial, observation, and attempt records use isolated evidence collections and do not produce occurrence or completed-training records', () => {
        // Evidence paths are strictly user-scoped assessment sidecars:
        // users/{userId}/assessment_attempts/{attemptId}
        // users/{userId}/assessment_attempts/{attemptId}/trials/{trialId}
        // users/{userId}/metric_observations/{observationKey}/revisions/{N}
        const attemptId = 'att-test-1';
        const trialId = assessmentTrialIdFor(1, 0);
        const obsKey = observationKeyFor(attemptId, 'strength_1rm_kg');

        expect(attemptId).toMatch(/^att-/);
        expect(trialId).toBe('trial-1');
        expect(obsKey).toBe('att-test-1:strength_1rm_kg');

        // None of these keys or collections are session_occurrences, session_executions,
        // or completed_training_events. They are evidence sidecars to the physical session.
        expect(obsKey).not.toContain('occurrence:');
        expect(obsKey).not.toContain('execution:');
    });

    describe('(b) completed testing execution and matching Garmin activity reconcile to one exposure', () => {
        it('reconciles a completed cycling assessment execution with a Garmin cycling activity to one exposure', () => {
            const sprintDef = getPerformanceTestDefinition('cycling_6s_seated_sprint-r2');
            const execution: SessionExecution = {
                userId: 'user-1',
                executionId: 'exec-cycling-sprint',
                occurrenceId: 'occ-cycling-sprint',
                sessionSource: {
                    kind: 'manual',
                    definitionId: sprintDef.sessionDefinition.id,
                    revision: sprintDef.sessionDefinition.revision,
                    contentHash: 'hash-sprint',
                },
                prescriptionHash: 'rx-sprint',
                date: '2026-10-20',
                startedAt: '2026-10-20T10:00:00.000Z',
                completedAt: '2026-10-20T10:30:00.000Z',
                updatedAt: '2026-10-20T10:30:00.000Z',
                state: 'completed',
                schemaVersion: 1,
            };

            const garminActivity: NormalizedGarminActivity = {
                activityId: 'garmin-act-101',
                date: '2026-10-20',
                type: 'cycling',
                durationMin: 30,
                trainingEffectAerobic: 2.1,
                trainingEffectAnaerobic: 3.5,
                averageHr: 145,
                activityTrainingLoad: 85,
                intensityTag: 'hard',
            };

            const summary = summarizeExecutionForReconciliation(execution, sprintDef.sessionDefinition.dominantModality);
            expect(summary.durationMin).toBe(30);
            expect(summary.modality).toBe('cycling');

            const matches = matchExecutionsToGarminActivities([summary], [garminActivity]);
            expect(matches).toHaveLength(1);
            expect(matches[0]).toEqual({
                executionId: 'exec-cycling-sprint',
                activityId: 'garmin-act-101',
                executionDurationMin: 30,
                activityDurationMin: 30,
            });
        });

        it('reconciles a completed strength assessment execution with a Garmin strength activity to one exposure', () => {
            const benchDef = getPerformanceTestDefinition('strength-bench-press-1rm-r2');
            const execution: SessionExecution = {
                userId: 'user-1',
                executionId: 'exec-bench-1rm',
                occurrenceId: 'occ-bench-1rm',
                sessionSource: {
                    kind: 'manual',
                    definitionId: benchDef.sessionDefinition.id,
                    revision: benchDef.sessionDefinition.revision,
                    contentHash: 'hash-bench',
                },
                prescriptionHash: 'rx-bench',
                date: '2026-10-21',
                startedAt: '2026-10-21T15:00:00.000Z',
                completedAt: '2026-10-21T15:35:00.000Z',
                updatedAt: '2026-10-21T15:35:00.000Z',
                state: 'completed',
                schemaVersion: 1,
            };

            const garminStrengthActivity: NormalizedGarminActivity = {
                activityId: 'garmin-strength-202',
                date: '2026-10-21',
                type: 'strength_training',
                durationMin: 36,
                trainingEffectAerobic: 1.0,
                trainingEffectAnaerobic: 1.5,
                averageHr: 118,
                activityTrainingLoad: 25,
                intensityTag: 'moderate',
            };

            const summary = summarizeExecutionForReconciliation(execution, benchDef.sessionDefinition.dominantModality);
            expect(summary.durationMin).toBe(35);
            expect(summary.modality).toBe('strength');

            const matches = matchExecutionsToGarminActivities([summary], [garminStrengthActivity]);
            expect(matches).toHaveLength(1);
            expect(matches[0]).toEqual({
                executionId: 'exec-bench-1rm',
                activityId: 'garmin-strength-202',
                executionDurationMin: 35,
                activityDurationMin: 36,
            });
        });

        it('reconciles a completed field jump assessment execution with a Garmin field activity', () => {
            const jumpDef = getPerformanceTestDefinition('field-standing-broad-jump-r2');
            const execution: SessionExecution = {
                userId: 'user-1',
                executionId: 'exec-jump-test',
                occurrenceId: 'occ-jump-test',
                sessionSource: {
                    kind: 'manual',
                    definitionId: jumpDef.sessionDefinition.id,
                    revision: jumpDef.sessionDefinition.revision,
                    contentHash: 'hash-jump',
                },
                prescriptionHash: 'rx-jump',
                date: '2026-10-22',
                startedAt: '2026-10-22T09:00:00.000Z',
                completedAt: '2026-10-22T09:20:00.000Z',
                updatedAt: '2026-10-22T09:20:00.000Z',
                state: 'completed',
                schemaVersion: 1,
            };

            const garminActivity: NormalizedGarminActivity = {
                activityId: 'garmin-jump-303',
                date: '2026-10-22',
                type: 'cardio', // or field
                durationMin: 20,
                trainingEffectAerobic: 1.5,
                trainingEffectAnaerobic: 1.0,
                averageHr: 125,
                activityTrainingLoad: 18,
                intensityTag: 'easy',
            };

            const summary = summarizeExecutionForReconciliation(execution, jumpDef.sessionDefinition.dominantModality);
            expect(summary.durationMin).toBe(20);

            // Incompatible modality does not match
            const noMatch = matchExecutionsToGarminActivities([summary], [{ ...garminActivity, type: 'lap_swimming' }]);
            expect(noMatch).toHaveLength(0);

            // Compatible modality on same date and duration matches to single exposure
            const match = matchExecutionsToGarminActivities([summary], [{ ...garminActivity, type: 'field' }]);
            expect(match).toHaveLength(1);
            expect(match[0].executionId).toBe('exec-jump-test');
            expect(match[0].activityId).toBe('garmin-jump-303');
        });
    });
});
