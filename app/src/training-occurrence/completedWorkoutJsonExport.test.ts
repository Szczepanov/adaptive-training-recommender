import { describe, expect, it } from 'vitest';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { completeReads } from './workoutSourceDiagnostics.fixtures';
import { exportCompletedWorkoutToJson, resolveCompletedWorkoutDuration } from './completedWorkoutJsonExport';

const EXPORTED_AT = '2026-08-26T10:00:00.000Z';

const warmup = { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 60, isWarmup: true } as const;
const set1 = { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 120, gauge: { scale: 'rpe_rts', value: 8 } } as const;
const set2 = { kind: 'repetition', setIndex: 2, reps: 4, weightKg: 120, gauge: { scale: 'rir', value: 1 } } as const;
const plank = { kind: 'duration', seconds: 45 } as const;

const structuredView: CompletedWorkoutView = {
    performedOccurrenceId: 'pto-1',
    sourceKeys: ['structured_execution:exec-1'],
    localDate: '2026-08-26',
    modality: 'strength',
    // A reconciled window that differs from what the app recorded -- the app must win.
    startedAt: '2026-08-26T06:00:00.000Z',
    endedAt: '2026-08-26T08:00:00.000Z',
    sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
    reconciliation: { state: 'single_source' },
    structured: {
        title: 'Heavy Squat Day',
        comparison: {
            definitionId: 'w-1', revision: 1, title: 'Heavy Squat Day',
            totalPlannedSteps: 2, completedStepsCount: 1, missingRequiredStepsCount: 1, stepComparisons: [],
            summary: { totalReps: 9, totalTonnageKg: 1080, totalDurationSeconds: 45, totalDistanceMeters: 0 },
        },
        steps: [
            {
                stepId: 's1', exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' }, title: 'Back Squat', isOptional: false,
                prescribed: { sets: 3, reps: { min: 4, max: 6 }, load: { kind: 'mass', kg: 120 }, effort: { rpe: 8 }, restSeconds: 180 },
                sets: [
                    { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: '2026-08-26T06:55:00.000Z', payload: warmup },
                    {
                        entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:00:00.000Z', payload: set1,
                        rest: { prescribedSeconds: 180, actualSeconds: 205, endReason: 'next_set_started' },
                    },
                    {
                        entryId: 'e2', setNumber: 2, isWarmup: false, completedAt: '2026-08-26T07:04:00.000Z', payload: set2,
                        exerciseRef: { kind: 'catalog', exerciseId: 'safety_bar_squat' },
                    },
                ],
            },
            {
                stepId: 's2', title: 'Plank', isOptional: true,
                prescribed: { sets: 1, seconds: 60 },
                sets: [{ entryId: 'p1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:10:00.000Z', payload: plank }],
            },
        ],
        performedRest: 'recorded',
        execution: {
            executionId: 'exec-1',
            state: 'completed',
            startedAt: '2026-08-26T06:50:00.000Z',
            completedAt: '2026-08-26T07:32:30.000Z',
            sessionRpe: 7,
            completedFraction: 0.8,
        },
    },
    garminExerciseSetsAreDiagnosticOnly: true,
    sourceReads: { ...completeReads, provider: 'not_linked' },
};

describe('exportCompletedWorkoutToJson', () => {
    it('exports every exercise with prescribed target and each performed set, weight, RPE/RIR and rest', () => {
        const result = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT);

        expect(result.schemaVersion).toBe('completed_workout_v1');
        expect(result.exportedAt).toBe(EXPORTED_AT);
        expect(result.title).toBe('Heavy Squat Day');
        expect(result.exercises).toHaveLength(2);

        const squat = result.exercises[0]!;
        expect(squat).toMatchObject({
            stepId: 's1',
            name: 'Back Squat',
            exercise: { kind: 'catalog', exerciseId: 'barbell_back_squat' },
            prescribed: { sets: 3, reps: { min: 4, max: 6 }, load: { kind: 'mass', kg: 120 }, targetRpe: 8, restSeconds: 180 },
            performed: { workSets: 2, warmupSets: 1, totalReps: 9, tonnageKg: 1080 },
        });
        expect(squat.performed.sets).toEqual([
            { setNumber: 1, isWarmup: true, completedAt: '2026-08-26T06:55:00.000Z', kind: 'repetition', reps: 5, weightKg: 60 },
            {
                setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:00:00.000Z', kind: 'repetition', reps: 5, weightKg: 120,
                effort: { rpe: 8 },
                rest: { actualSeconds: 205, prescribedSeconds: 180, endReason: 'next_set_started' },
            },
            {
                setNumber: 2, isWarmup: false, completedAt: '2026-08-26T07:04:00.000Z', kind: 'repetition', reps: 4, weightKg: 120,
                effort: { rir: 1 },
                performedExercise: { kind: 'catalog', exerciseId: 'safety_bar_squat' },
            },
        ]);
        expect(result.exercises[1]!.performed.sets[0]).toMatchObject({ kind: 'duration', durationSeconds: 45 });
        expect(result.summary).toEqual({ exercises: 2, workSets: 3, totalReps: 9, tonnageKg: 1080, totalPerformedRestSeconds: 205 });
        expect(result.performedRest).toBe('recorded');
    });

    it('uses the app-recorded execution duration and session RPE, not the prescription or reconciled window', () => {
        const result = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT);

        expect(result.duration).toEqual({
            seconds: 2550,
            minutes: 43,
            source: 'app_execution',
            startedAt: '2026-08-26T06:50:00.000Z',
            endedAt: '2026-08-26T07:32:30.000Z',
        });
        expect(result.session).toEqual({ executionId: 'exec-1', state: 'completed', sessionRpe: 7, completedFraction: 0.8 });
    });

    it('falls back to the occurrence window, then the provider recording, when the app has no finish time', () => {
        const unfinished: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, execution: { executionId: 'exec-1', state: 'in_progress', startedAt: '2026-08-26T06:50:00.000Z' } },
        };
        expect(resolveCompletedWorkoutDuration(unfinished)).toMatchObject({ seconds: 7200, source: 'occurrence' });

        const garminOnly: CompletedWorkoutView = {
            ...structuredView,
            startedAt: undefined,
            endedAt: undefined,
            structured: undefined,
            sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
            garmin: {
                activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40,
                trainingEffectAerobic: 2, trainingEffectAnaerobic: 1, averageHr: 120, maxHr: 150,
                activityTrainingLoad: 80, intensityTag: 'moderate',
            },
        };
        const result = exportCompletedWorkoutToJson(garminOnly, EXPORTED_AT);
        expect(result.duration).toMatchObject({ seconds: 2400, minutes: 40, source: 'provider' });
        expect(result.title).toBe('strength training');
        expect(result.exercises).toEqual([]);
        expect(result.summary).toBeUndefined();
        expect(result.providerActivity?.activityId).toBe('act-1');
    });

    it('omits duration rather than inventing one when no source has timing', () => {
        const noTiming: CompletedWorkoutView = {
            ...structuredView,
            startedAt: undefined,
            endedAt: undefined,
            structured: { ...structuredView.structured!, execution: undefined },
        };
        const result = exportCompletedWorkoutToJson(noTiming, EXPORTED_AT);
        expect(result.duration).toBeUndefined();
        expect(result.session).toBeUndefined();
    });
});
