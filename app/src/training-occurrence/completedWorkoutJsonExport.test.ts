import { describe, expect, it } from 'vitest';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { completeReads } from './workoutSourceDiagnostics.fixtures';
import type { SessionResponse } from '../responses/models';
import { exportCompletedWorkoutToJson, formatCompletedWorkoutJson, resolveCompletedWorkoutDuration } from './completedWorkoutJsonExport';

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
                        rest: { prescribedSeconds: 180, actualSeconds: 1500, endReason: 'session_ended' },
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
            performed: { workSets: 2, warmupSets: 1, totalReps: 9, warmupReps: 5, tonnageKg: 1080 },
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
                rest: { actualSeconds: 1500, prescribedSeconds: 180, endReason: 'session_ended' },
            },
        ]);
        expect(result.exercises[1]!.performed).toMatchObject({
            workSets: 1,
            warmupSets: 0,
            totalReps: 0,
            tonnageKg: 0,
            totalDurationSeconds: 45,
        });
        expect(result.exercises[1]!.performed.sets[0]).toMatchObject({ kind: 'duration', durationSeconds: 45 });
        // Trailing session_ended rest stays on the set row with its endReason, but never inflates totalPerformedRestSeconds.
        expect(result.summary).toEqual({
            exercises: 2,
            workSets: 3,
            totalReps: 9,
            warmupReps: 5,
            tonnageKg: 1080,
            totalDurationSeconds: 45,
            totalPerformedRestSeconds: 205,
        });
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

    it('exports a carried load, the performed exercise after a swap, and exercises added during the session', () => {
        const base = structuredView.structured!;
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: {
                ...base,
                steps: [
                    {
                        stepId: 'press', exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
                        title: 'Single-arm Dumbbell Floor Press', plannedTitle: 'Bench Press',
                        performedExerciseRef: { kind: 'catalog', exerciseId: 'single_arm_dumbbell_floor_press' },
                        isOptional: false, prescribed: { sets: 3, reps: 8 }, sets: [],
                    },
                    {
                        stepId: 'carry', exerciseRef: { kind: 'catalog', exerciseId: 'farmer_carry' }, title: 'Farmer Carry',
                        isOptional: false, prescribed: { sets: 1, meters: 40 },
                        sets: [{
                            entryId: 'c1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:20:00.000Z',
                            payload: { kind: 'distance', meters: 40, loadKg: 48 },
                        }],
                    },
                    {
                        stepId: 'added-1', title: 'Back Extension', unplanned: true,
                        exerciseRef: { kind: 'unresolved_free_text', name: 'Back Extension' },
                        isOptional: false, prescribed: { sets: 0 }, sets: [],
                    },
                ],
            },
        };

        const [press, carry, added] = exportCompletedWorkoutToJson(view, EXPORTED_AT).exercises;

        expect(press.name).toBe('Single-arm Dumbbell Floor Press');
        expect(press.plannedName).toBe('Bench Press');
        expect(press.performedExercise).toEqual({ kind: 'catalog', exerciseId: 'single_arm_dumbbell_floor_press' });
        expect(carry.performed.sets[0]).toEqual(expect.objectContaining({ distanceMeters: 40, weightKg: 48 }));
        expect(added.unplanned).toBe(true);
        expect(added.name).toBe('Back Extension');
    });

    it('flags a choice-only step without claiming a prescription', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: {
                ...structuredView.structured!,
                steps: [{
                    stepId: 'gate', title: 'Gate', isOptional: false, choiceOnly: true, prescribed: { sets: 0 },
                    choices: [{ choiceEntryId: 'ce-c', effective: true, choiceId: 'c', optionId: 'o', completedAt: '2026-08-26T07:00:00.000Z' }], sets: [],
                }],
            },
        };
        const [gate] = exportCompletedWorkoutToJson(view, EXPORTED_AT).exercises;
        expect(gate.choiceOnly).toBe(true);
        expect(gate.prescribed.sets).toBe(0);
        expect(exportCompletedWorkoutToJson(structuredView, EXPORTED_AT).exercises.some(e => e.choiceOnly)).toBe(false);
    });

    const withFirstStep = (patch: Record<string, unknown>): CompletedWorkoutView => ({
        ...structuredView,
        structured: {
            ...structuredView.structured!,
            steps: [{ ...structuredView.structured!.steps[0], ...patch }, ...structuredView.structured!.steps.slice(1)],
        },
    });

    const response = (over: Partial<SessionResponse>): SessionResponse => ({
        userId: 'u1',
        responseId: 'r',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-26' },
        window: 'immediate',
        date: '2026-08-26',
        checkinRef: { date: '2026-08-26' },
        createdAt: '2026-08-26T08:00:00.000Z',
        updatedAt: '2026-08-26T08:00:00.000Z',
        ...over,
    });

    it('exports prescribed tempo and notes', () => {
        const view = withFirstStep({ prescribed: { sets: 3, tempo: '3-1-1-0', notes: 'Pause at bottom' } });
        const [first, second] = exportCompletedWorkoutToJson(view, EXPORTED_AT).exercises;
        expect(first.prescribed).toEqual(expect.objectContaining({ tempo: '3-1-1-0', notes: 'Pause at bottom' }));
        expect('tempo' in second.prescribed).toBe(false);
        expect('notes' in second.prescribed).toBe(false);
    });

    it('exports step choices', () => {
        const choices = [{ choiceEntryId: 'ce-c1', effective: true, choiceId: 'c1', optionId: 'o1', optionLabel: 'Heavy', reason: 'Felt strong', completedAt: '2026-08-26T07:00:00.000Z' }];
        const [first, second] = exportCompletedWorkoutToJson(withFirstStep({ choices }), EXPORTED_AT).exercises;
        expect(first.choices).toEqual(choices);
        expect('choices' in second).toBe(false);
    });

    it('includes responses in window order and omits the key when not supplied', () => {
        expect('responses' in exportCompletedWorkoutToJson(structuredView, EXPORTED_AT)).toBe(false);
        const result = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, [
            response({ responseId: 'a', window: 'next_morning', sessionRpe: 5 }),
            response({ responseId: 'b', window: 'later_day', createdAt: '2026-08-26T12:00:00.000Z', note: 'later' }),
            response({ responseId: 'c', window: 'immediate', sessionRpe: 7, completedFraction: 0.8, unexpectedFatigue: true, techniqueNote: 'knees' }),
            response({ responseId: 'd', window: 'later_day', createdAt: '2026-08-26T10:00:00.000Z', note: 'earlier' }),
        ]);
        const dates = { date: '2026-08-26', sourceSessionDate: '2026-08-26' };
        expect(result.responses).toEqual([
            { window: 'immediate', ...dates, sessionRpe: 7, completedFraction: 0.8, unexpectedFatigue: true, techniqueNote: 'knees' },
            { window: 'later_day', ...dates, note: 'earlier' },
            { window: 'later_day', ...dates, note: 'later' },
            { window: 'next_morning', ...dates, sessionRpe: 5 },
        ]);
        expect(result.responseRead).toEqual({ status: 'complete' });
        expect(result.responseWindows).toEqual({ immediate: 'recorded', later_day: 'recorded', next_morning: 'recorded' });
        expect(JSON.stringify(result.responses)).not.toContain('responseId');
    });

    it('keeps the response date separate from the source-session date', () => {
        const [next] = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, [
            response({ responseId: 'n', window: 'next_morning', date: '2026-08-27' }),
        ]).responses as Exclude<ReturnType<typeof exportCompletedWorkoutToJson>['responses'], 'unavailable' | undefined>;
        expect(next).toMatchObject({ window: 'next_morning', date: '2026-08-27', sourceSessionDate: '2026-08-26' });
    });

    it('marks missing windows not_recorded only after a complete read', () => {
        const complete = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, [response({ responseId: 'a', window: 'immediate' })]);
        expect(complete.responseWindows).toEqual({ immediate: 'recorded', later_day: 'not_recorded', next_morning: 'not_recorded' });
        const partial = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, {
            status: 'read', responses: [response({ responseId: 'a', window: 'immediate' })], invalidRecords: 2,
        });
        expect(partial.responseRead).toEqual({ status: 'partial', invalidRecords: 2 });
        expect(partial.responseWindows).toEqual({ immediate: 'recorded', later_day: 'unknown', next_morning: 'unknown' });
    });

    it('marks responses unavailable', () => {
        const failed = exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, 'unavailable');
        expect(failed.responses).toBe('unavailable');
        expect(failed.responseRead).toEqual({ status: 'failed' });
        expect(failed.responseWindows).toEqual({ immediate: 'unknown', later_day: 'unknown', next_morning: 'unknown' });
        expect(exportCompletedWorkoutToJson(structuredView, EXPORTED_AT, { status: 'failed' }).responses).toBe('unavailable');
        expect(JSON.parse(formatCompletedWorkoutJson(structuredView, EXPORTED_AT, 'unavailable')).responses).toBe('unavailable');
    });

    it('reports set-log completeness and per-exercise performed status', () => {
        const step = (stepId: string, sets: NonNullable<CompletedWorkoutView['structured']>['steps'][number]['sets']) => ({
            stepId, title: stepId, isOptional: false, prescribed: { sets: 1, reps: 5 }, sets,
        });
        const set = { entryId: 'e', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:00:00.000Z' };
        const view = (entryInvalidRecords: number | undefined): CompletedWorkoutView => ({
            ...structuredView,
            structured: {
                ...structuredView.structured!,
                entryInvalidRecords,
                steps: [
                    step('done', [{ ...set, payload: { kind: 'checkoff', completed: true } }]),
                    step('failed', [{ ...set, payload: { kind: 'checkoff', completed: false } }]),
                    step('empty', []),
                ],
            },
        });
        const complete = exportCompletedWorkoutToJson(view(0), EXPORTED_AT);
        expect(complete.structuredEntries).toEqual({ status: 'complete' });
        expect(complete.exercises.map(e => e.performedStatus)).toEqual(['performed', 'not_performed', 'not_performed']);
        const partial = exportCompletedWorkoutToJson(view(3), EXPORTED_AT);
        expect(partial.structuredEntries).toEqual({ status: 'partial', invalidRecords: 3 });
        expect(partial.exercises.map(e => e.performedStatus)).toEqual(['performed', 'unknown', 'unknown']);
        expect(exportCompletedWorkoutToJson(view(undefined), EXPORTED_AT).structuredEntries).toEqual({ status: 'unknown', reason: 'not_hydrated' });

        const failedWrites = { ...view(0), sourceReads: { ...view(0).sourceReads, outbox: { status: 'read' as const, queued: 0, failed: 2 } } };
        const withFailed = exportCompletedWorkoutToJson(failedWrites, EXPORTED_AT);
        expect(withFailed.structuredEntries).toEqual({ status: 'unknown', reason: 'diary_writes_failed', failedWrites: 2 });
        expect(withFailed.exercises.map(e => e.performedStatus)).toEqual(['performed', 'unknown', 'unknown']);
        const unreadableOutbox = { ...view(0), sourceReads: { ...view(0).sourceReads, outbox: { status: 'unreadable' as const } } };
        expect(exportCompletedWorkoutToJson(unreadableOutbox, EXPORTED_AT).structuredEntries)
            .toEqual({ status: 'unknown', reason: 'diary_outbox_unreadable' });
    });

    it('reports structuredEntries as unknown when the set log read itself failed', () => {
        const failed: CompletedWorkoutView = {
            ...structuredView,
            structured: undefined,
            sourceReads: { ...structuredView.sourceReads, structured: { status: 'entries_unavailable' } },
        };
        expect(exportCompletedWorkoutToJson(failed, EXPORTED_AT).structuredEntries)
            .toEqual({ status: 'unknown', reason: 'entries_unavailable' });
        const notLinked: CompletedWorkoutView = {
            ...structuredView,
            structured: undefined,
            sourceReads: { ...structuredView.sourceReads, structured: { status: 'not_linked' } },
        };
        expect('structuredEntries' in exportCompletedWorkoutToJson(notLinked, EXPORTED_AT)).toBe(false);
    });

    it('exports governing-choice refs on sets and session-level choices', () => {
        const choice = { choiceEntryId: 'ch-9', effective: true, choiceId: 'route', optionId: 'indoor', completedAt: '2026-08-26T07:00:00.000Z' };
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: {
                ...structuredView.structured!,
                sessionChoices: [choice],
                steps: [{
                    stepId: 'sq', title: 'Squat', isOptional: false, prescribed: { sets: 1, reps: 5 },
                    sets: [{
                        entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:00:00.000Z',
                        payload: { kind: 'repetition', setIndex: 1, reps: 5 }, governingChoiceEntryId: 'ch-1', selectedOptionId: 'heavy',
                    }],
                }],
            },
        };
        const result = exportCompletedWorkoutToJson(view, EXPORTED_AT);
        expect(result.sessionChoices).toEqual([choice]);
        expect(result.exercises[0].performed.sets[0]).toMatchObject({ governingChoiceEntryId: 'ch-1', selectedOptionId: 'heavy' });
        expect('sessionChoices' in exportCompletedWorkoutToJson(structuredView, EXPORTED_AT)).toBe(false);
    });
});

describe('exportCompletedWorkoutToJson — new set detail', () => {
    it('exports RPE and side for a per-side carry and the best jump of a jump set', () => {
        const base = structuredView.structured!;
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: {
                ...base,
                steps: [
                    {
                        stepId: 'carry', exerciseRef: { kind: 'catalog', exerciseId: 'suitcase_carry' }, title: 'Suitcase Carry',
                        isOptional: false, prescribed: { sets: 1, meters: 20 },
                        sets: [{
                            entryId: 'c1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:20:00.000Z', side: 'left',
                            payload: { kind: 'distance', meters: 20, loadKg: 24, gauge: { scale: 'rpe_rts', value: 7 } },
                        }, {
                            entryId: 'c2', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:21:00.000Z', side: 'right',
                            payload: { kind: 'distance', meters: 20, loadKg: 24 },
                        }],
                    },
                    {
                        stepId: 'cmj', exerciseRef: { kind: 'catalog', exerciseId: 'countermovement_jump' }, title: 'Countermovement Jump',
                        isOptional: false, prescribed: { sets: 1, reps: 3 },
                        sets: [{
                            entryId: 'j1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:25:00.000Z',
                            payload: { kind: 'repetition', setIndex: 1, reps: 3, jumpHeightCm: 41.5 },
                        }],
                    },
                ],
            },
        };

        const [carry, cmj] = exportCompletedWorkoutToJson(view, EXPORTED_AT).exercises;

        expect(carry.performed.sets[0]).toMatchObject({ kind: 'distance', side: 'left', weightKg: 24, effort: { rpe: 7 } });
        // Both sides stay as rows, but a left/right pair is one performed work set.
        expect(carry.performed.sets).toHaveLength(2);
        expect(carry.performed.workSets).toBe(1);
        expect(carry.performed.sets.map(set => set.setNumber)).toEqual([1, 1]);
        expect(cmj.performed.sets[0]).toMatchObject({ kind: 'repetition', reps: 3, jumpHeightCm: 41.5 });
    });

    it('preserves side on repetition, paired duration, and warm-up sets while omitting bilateral', () => {
        const base = structuredView.structured!;
        const stamp = '2026-08-26T07:00:00.000Z';
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: {
                ...base,
                steps: [
                    {
                        stepId: 'split-squat', title: 'Split Squat', isOptional: false, prescribed: { sets: 2, reps: 8 },
                        sets: [
                            { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: stamp, side: 'left', payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 10, isWarmup: true } },
                            { entryId: 'w2', setNumber: 2, isWarmup: true, completedAt: stamp, side: 'bilateral' as never, payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 20, isWarmup: true } },
                            { entryId: 's1', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'left', payload: { kind: 'repetition', setIndex: 1, reps: 8, weightKg: 20 } },
                            { entryId: 's2', setNumber: 2, isWarmup: false, completedAt: stamp, side: 'right', payload: { kind: 'repetition', setIndex: 2, reps: 8, weightKg: 20 } },
                            { entryId: 's3', setNumber: 3, isWarmup: false, completedAt: stamp, side: 'bilateral' as never, payload: { kind: 'repetition', setIndex: 3, reps: 8, weightKg: 40 } },
                        ],
                    },
                    {
                        stepId: 'side-plank', title: 'Side Plank', isOptional: false, prescribed: { sets: 1, seconds: 45 },
                        sets: [
                            { entryId: 'h1', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'left', payload: { kind: 'duration', seconds: 45 } },
                            { entryId: 'h2', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'right', payload: { kind: 'duration', seconds: 45 } },
                        ],
                    },
                ],
            },
        };
        const [splitSquat, sidePlank] = exportCompletedWorkoutToJson(view, EXPORTED_AT).exercises;
        expect(splitSquat.performed.sets.map(set => [set.isWarmup, set.setNumber, set.side])).toEqual([
            [true, 1, 'left'],
            [true, 2, undefined],
            [false, 1, 'left'],
            [false, 2, 'right'],
            [false, 3, undefined],
        ]);
        expect('side' in splitSquat.performed.sets[1]).toBe(false);
        expect('side' in splitSquat.performed.sets[4]).toBe(false);
        expect(sidePlank.performed.workSets).toBe(1);
        expect(sidePlank.performed.sets.map(set => [set.setNumber, set.side])).toEqual([[1, 'left'], [1, 'right']]);
    });
});
