import { describe, expect, it } from 'vitest';
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { formatCompletedWorkoutMarkdown } from './completedWorkoutMarkdown';
import { completeReads } from './workoutSourceDiagnostics.fixtures';

const EXPORTED_AT = '2026-11-14T10:00:00.000Z';

const rep = (setIndex: number, reps: number, weightKg: number, extra: Record<string, unknown> = {}) =>
    ({ kind: 'repetition', setIndex, reps, weightKg, ...extra }) as const;

const structuredView: CompletedWorkoutView = {
    performedOccurrenceId: 'pto-1',
    sourceKeys: ['structured_execution:exec-1'],
    localDate: '2026-11-14',
    modality: 'strength',
    sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] },
    reconciliation: { state: 'single_source' },
    structured: {
        title: 'Heavy Squat Day',
        comparison: {
            definitionId: 'w-1', revision: 1, title: 'Heavy Squat Day',
            totalPlannedSteps: 4, completedStepsCount: 3, missingRequiredStepsCount: 1, stepComparisons: [],
            summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        },
        steps: [
            {
                stepId: 's1', exerciseRef: { kind: 'catalog', exerciseId: 'barbell_back_squat' }, title: 'Back Squat', isOptional: false,
                prescribed: {
                    sets: 3, reps: { min: 4, max: 6 }, load: { kind: 'mass', kg: 120 }, effort: { rir: 2 },
                    restSeconds: 180, tempo: '3-1-1-0', notes: 'Pause at the bottom',
                },
                choices: [{ choiceId: 'c1', optionId: 'heavy', optionLabel: 'Heavy top set', reason: 'Felt strong', completedAt: '2026-11-14T06:50:00.000Z' }],
                sets: [
                    { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: '2026-11-14T06:55:00.000Z', payload: rep(0, 5, 60, { isWarmup: true }) },
                    { entryId: 'w2', setNumber: 2, isWarmup: true, completedAt: '2026-11-14T06:57:00.000Z', payload: rep(0, 3, 90, { isWarmup: true }) },
                    {
                        entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: '2026-11-14T07:00:00.000Z',
                        payload: rep(1, 5, 120, { gauge: { scale: 'rir', value: 2 } }),
                        rest: { prescribedSeconds: 180, actualSeconds: 205, endReason: 'next_set_started' },
                    },
                    {
                        entryId: 'e2', setNumber: 2, isWarmup: false, completedAt: '2026-11-14T07:04:00.000Z',
                        payload: rep(2, 4, 120, { gauge: { scale: 'rpe_rts', value: 9 } }),
                        rest: { prescribedSeconds: 180, actualSeconds: 1500, endReason: 'session_ended' },
                    },
                ],
            },
            {
                stepId: 's2', exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' }, title: 'Dumbbell Floor Press',
                plannedTitle: 'Bench Press', isOptional: false,
                prescribed: { sets: 3, reps: 8, load: { kind: 'mass', kg: { min: 60, max: 70 } } },
                sets: [{ entryId: 'p1', setNumber: 1, isWarmup: false, completedAt: '2026-11-14T07:15:00.000Z', payload: rep(1, 8, 30) }],
            },
            {
                stepId: 'added-1', title: 'Back Extension', unplanned: true,
                exerciseRef: { kind: 'unresolved_free_text', name: 'Back Extension' },
                isOptional: false, prescribed: { sets: 0 },
                sets: [{ entryId: 'a1', setNumber: 1, isWarmup: false, completedAt: '2026-11-14T07:25:00.000Z', payload: rep(1, 12, 0) }],
            },
            {
                stepId: 's4', title: 'Plank', isOptional: false,
                prescribed: { sets: 2, seconds: 45 }, sets: [],
            },
        ],
        performedRest: 'recorded',
        execution: {
            executionId: 'exec-1', state: 'completed', executedDefinition: 'reduced',
            startedAt: '2026-11-14T06:50:00.000Z', completedAt: '2026-11-14T07:32:30.000Z',
            sessionRpe: 7, completedFraction: 0.8, unexpectedFatigue: false, note: 'Left knee felt tight\nafter set 2',
        },
    },
    garmin: {
        activityId: 'garmin-act-secret-77', date: '2026-11-14', type: 'strength_training', durationMin: 44,
        trainingEffectAerobic: 2.1, trainingEffectAnaerobic: 1.4, averageHr: 118, maxHr: 156,
        activityTrainingLoad: 85, intensityTag: 'moderate',
    },
    garminExerciseSetsAreDiagnosticOnly: true,
    sourceReads: completeReads,
};

const providerOnlyView: CompletedWorkoutView = {
    ...structuredView,
    structured: undefined,
    sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
    garmin: { ...structuredView.garmin!, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, maxHr: undefined, activityTrainingLoad: null },
};

const response = (over: Partial<SessionResponse>): SessionResponse => ({
    userId: 'user-secret-1', responseId: 'r', sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-14' },
    window: 'immediate', date: '2026-11-14', checkinRef: { date: '2026-11-14' },
    createdAt: '2026-11-14T08:00:00.000Z', updatedAt: '2026-11-14T08:00:00.000Z', ...over,
});

describe('formatCompletedWorkoutMarkdown', () => {
    it('renders the session sheet', async () => {
        const md = formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, [
            response({ window: 'next_morning', sessionRpe: 6, note: 'Slept well' }),
            response({ window: 'immediate', sessionRpe: 7, unexpectedFatigue: false, techniqueNote: 'Knees caved on rep 4' }),
        ]);
        await expect(md).toMatchFileSnapshot('./completedWorkoutMarkdown.golden.md');
    });

    it('renders a provider-only workout without a structured log', () => {
        const md = formatCompletedWorkoutMarkdown(providerOnlyView, EXPORTED_AT);
        expect(md).toContain('structured log: none (provider recording only)');
        expect(md).toContain('Garmin: 44 min');
        expect(md).not.toContain('TE ');
        expect(md).not.toContain('avg HR');
        expect(md).not.toContain('load 0');
        expect(md).not.toContain('##');
    });

    const withSteps = (steps: NonNullable<CompletedWorkoutView['structured']>['steps']): CompletedWorkoutView => ({
        ...structuredView,
        structured: { ...structuredView.structured!, steps },
    });
    const stamp = '2026-11-14T07:00:00.000Z';

    it('names missing set values instead of printing zero', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([{
            stepId: 'x', title: 'Mixed', isOptional: false, prescribed: { sets: 3 },
            sets: [
                { entryId: '1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: { kind: 'repetition', setIndex: 1 } as never },
                { entryId: '2', setNumber: 2, isWarmup: false, completedAt: stamp, payload: { kind: 'duration', seconds: undefined, loadKg: 10 } as never },
                { entryId: '3', setNumber: 3, isWarmup: false, completedAt: stamp, payload: { kind: 'distance', meters: undefined } as never },
            ],
        }]), EXPORTED_AT);
        expect(md).toContain('1: reps: not recorded');
        expect(md).toContain('2: duration: not recorded @ 10 kg');
        expect(md).toContain('3: distance: not recorded');
        expect(md).not.toMatch(/: 0 (reps|s|m)/);
    });

    it('renders a duration set body', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([{
            stepId: 'x', title: 'Plank', isOptional: false, prescribed: { sets: 1, seconds: 45 },
            sets: [{ entryId: '1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: { kind: 'duration', seconds: 50, loadKg: 10 } }],
        }]), EXPORTED_AT);
        expect(md).toContain('1: 50 s @ 10 kg');
    });

    it('keeps notes and choices on a skipped step and marks it optional', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([{
            stepId: 'x', title: 'Curls', isOptional: true,
            prescribed: { sets: 3, reps: 12, notes: 'Slow' },
            choices: [{ choiceId: 'c', optionId: 'skip', optionLabel: 'Skip step', reason: 'Elbow pain', completedAt: stamp }],
            sets: [],
        }]), EXPORTED_AT);
        expect(md).toContain('## Not performed: Curls (planned 3×12) (optional)');
        expect(md).toContain('notes: Slow');
        expect(md).toContain('choice: Skip step (reason: Elbow pain)');
    });

    it('treats a warm-up-only step as not performed and still lists the warm-up', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([{
            stepId: 'x', title: 'Deadlift', isOptional: false, prescribed: { sets: 3, reps: 5 },
            sets: [{ entryId: '1', setNumber: 1, isWarmup: true, completedAt: stamp, payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 60, isWarmup: true } }],
        }]), EXPORTED_AT);
        expect(md).toContain('## Not performed: Deadlift (planned 3×5)');
        expect(md).toContain('warm-up: 5 @ 60 kg');
    });

    it('prints responses: none recorded for an empty list', () => {
        expect(formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, [])).toContain('responses: none recorded');
    });

    it('names absent sections on the missing line', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, performedRest: 'not_recorded' },
        };
        expect(formatCompletedWorkoutMarkdown(view, EXPORTED_AT)).toContain('missing: performed rest (not_recorded)');
    });

    it('prints responses: unavailable', () => {
        expect(formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, 'unavailable')).toContain('responses: unavailable');
    });

    it('never prints zero for missing sRPE', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, execution: { executionId: 'exec-1', state: 'completed', startedAt: '2026-11-14T06:50:00.000Z' } },
        };
        const md = formatCompletedWorkoutMarkdown(view, EXPORTED_AT);
        expect(md).toContain('sRPE: not recorded');
        expect(md).not.toContain('sRPE 0');
    });

    it('contains no user id', () => {
        const md = formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, [response({ sessionRpe: 7 })]);
        expect(md).not.toContain('garmin-act-secret-77');
        expect(md).not.toContain('user-secret-1');
        expect(md).toContain('ref: pto-1');
        expect(md.split('pto-1')).toHaveLength(2);
    });
});
