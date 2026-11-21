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
                choices: [{ choiceEntryId: 'ce-c1', effective: true, choiceId: 'c1', optionId: 'heavy', optionLabel: 'Heavy top set', reason: 'Felt strong', completedAt: '2026-11-14T06:50:00.000Z' }],
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
        entryInvalidRecords: 0,
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
    sourceReads: { ...completeReads, structured: { status: 'not_linked' } },
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
            choices: [{ choiceEntryId: 'ce-c', effective: true, choiceId: 'c', optionId: 'skip', optionLabel: 'Skip step', reason: 'Elbow pain', completedAt: stamp }],
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

    it('says unavailable, not provider-only, when the structured execution could not be read', () => {
        const unreadable = (structured: CompletedWorkoutView['sourceReads']['structured']): CompletedWorkoutView => ({
            ...providerOnlyView,
            sourceReads: { ...completeReads, structured },
        });
        const missing = formatCompletedWorkoutMarkdown(unreadable({ status: 'execution_missing' }), EXPORTED_AT);
        expect(missing).toContain('structured log: unavailable (execution_missing)');
        expect(missing).not.toContain('provider recording only');
        expect(formatCompletedWorkoutMarkdown(unreadable({ status: 'execution_invalid' }), EXPORTED_AT))
            .toContain('structured log: unavailable (execution_invalid)');
        expect(formatCompletedWorkoutMarkdown(unreadable({ status: 'execution_unavailable' }), EXPORTED_AT))
            .toContain('structured log: unavailable (execution_unavailable)');
        expect(formatCompletedWorkoutMarkdown(unreadable({ status: 'entries_unavailable' }), EXPORTED_AT))
            .toContain('structured log: unavailable (entries_unavailable)');
        expect(formatCompletedWorkoutMarkdown(unreadable({ status: 'definition_unresolved', definition: 'MISSING' }), EXPORTED_AT))
            .toContain('structured log: unavailable (definition_unresolved: MISSING)');
    });

    it('says no exercise steps were recorded when structured data is available but empty', () => {
        const md = formatCompletedWorkoutMarkdown(
            { ...structuredView, structured: { ...structuredView.structured!, steps: [] } },
            EXPORTED_AT,
        );
        expect(md).toContain('structured log: no exercise steps recorded');
        expect(md).not.toContain('provider recording only');
        expect(md).not.toContain('unavailable');
    });

    it('does not claim a provider recording when nothing is linked at all', () => {
        const md = formatCompletedWorkoutMarkdown(
            { ...providerOnlyView, garmin: undefined, sourceBadge: { hasStructured: false, hasProvider: false, providers: [] } },
            EXPORTED_AT,
        );
        expect(md).toContain('structured log: none');
        expect(md).not.toContain('provider recording only');
    });

    it('renders a choice-only step as a Choice heading with no prescription or Not performed', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([{
            stepId: 'gate', title: 'Gate', isOptional: false, choiceOnly: true, prescribed: { sets: 0 },
            choices: [{ choiceEntryId: 'ce-c', effective: true, choiceId: 'c', optionId: 'reduced', optionLabel: 'Reduced version', reason: 'Tired', completedAt: stamp }],
            sets: [],
        }]), EXPORTED_AT);
        expect(md).toContain('## Choice: Gate');
        expect(md).toContain('choice: Reduced version (reason: Tired)');
        expect(md).not.toContain('Not performed: Gate');
        expect(md).not.toContain('planned');
    });

    it('names every window as not recorded after a complete read with no responses', () => {
        const md = formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, []);
        expect(md).toContain('responses:\n- immediate: not recorded\n- later_day: not recorded\n- next_morning: not recorded');
    });

    it('reports a partial response read and leaves absent windows unknown', () => {
        const md = formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, {
            status: 'read', responses: [response({ sessionRpe: 7 })], invalidRecords: 1,
        });
        expect(md).toContain('responses (partially unreadable: 1 records):');
        expect(md).toContain('- immediate: sRPE 7');
        expect(md).toContain('- later_day: unknown');
        expect(md).toContain('- next_morning: unknown');
        expect(md).not.toContain('not recorded\n- next_morning');
    });

    it('prints the response date only when it differs from the session date', () => {
        const md = formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, [
            response({ responseId: 'a', sessionRpe: 7 }),
            response({ responseId: 'b', window: 'next_morning', date: '2026-11-15', note: 'Sore quads' }),
        ]);
        expect(md).toContain('- immediate: sRPE 7');
        expect(md).toContain('- next_morning (recorded 2026-11-15): note: Sore quads');
    });

    it('prints Unknown, not Not performed, when the set log was only partly read', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, entryInvalidRecords: 2 },
        };
        const md = formatCompletedWorkoutMarkdown(view, EXPORTED_AT);
        expect(md).toContain('set log: partially unreadable (2 unreadable records)');
        expect(md).toContain('## Unknown: Plank (planned 2×45 s) — set log not fully readable');
        expect(md).not.toContain('Not performed');
    });

    it('names the governing choice on warm-ups and says when a missing one could not be read', () => {
        const earlier = {
            choiceEntryId: 'ch-1', effective: false, choiceId: 'c', optionId: 'heavy', optionLabel: 'Heavy', supersededByChoiceEntryId: 'ch-2', completedAt: stamp,
        };
        const steps = [{
            stepId: 'sq', title: 'Squat', isOptional: false, prescribed: { sets: 1, reps: 5 },
            choices: [earlier],
            sets: [
                { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: stamp, payload: rep(0, 5, 60, { isWarmup: true }), governingChoiceEntryId: 'ch-1' },
                { entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: rep(1, 5, 120), governingChoiceEntryId: 'ch-missing' },
            ],
        }];
        const complete = formatCompletedWorkoutMarkdown(withSteps(steps), EXPORTED_AT);
        expect(complete).toContain('warm-up: 5 @ 60 kg · under earlier choice: Heavy');
        expect(complete).toContain('1: 5 @ 120 kg · under a choice no longer in the log');
        const partialView = withSteps(steps);
        const partial = formatCompletedWorkoutMarkdown(
            { ...partialView, structured: { ...partialView.structured!, entryInvalidRecords: 1 } },
            EXPORTED_AT,
        );
        expect(partial).toContain('1: 5 @ 120 kg · under a choice that could not be read');
    });

    it('prints Unknown when this device has diary writes that failed to save', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            sourceReads: { ...structuredView.sourceReads, outbox: { status: 'read', queued: 0, failed: 1 } },
        };
        const md = formatCompletedWorkoutMarkdown(view, EXPORTED_AT);
        expect(md).toContain('set log: may be incomplete (1 logged changes failed to save on this device)');
        expect(md).toContain('## Unknown: Plank');
    });

    it('prints Unknown when the view does not say whether the set log was complete', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, entryInvalidRecords: undefined },
        };
        expect(formatCompletedWorkoutMarkdown(view, EXPORTED_AT)).toContain('## Unknown: Plank');
    });

    it('counts a completed checkoff or a timed entry as performed, and a failed checkoff as not', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([
            {
                stepId: 'mob', title: 'Hip mobility', isOptional: false, prescribed: { sets: 1 },
                sets: [{ entryId: 'k1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: { kind: 'checkoff', completed: true } }],
            },
            {
                stepId: 'hold', title: 'Plank', isOptional: false, prescribed: { sets: 1, seconds: 45 },
                sets: [{ entryId: 'd1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: { kind: 'duration', seconds: 40 } }],
            },
            {
                stepId: 'drill', title: 'Skips', isOptional: false, prescribed: { sets: 1 },
                sets: [{ entryId: 'k2', setNumber: 1, isWarmup: false, completedAt: stamp, payload: { kind: 'checkoff', completed: false } }],
            },
        ]), EXPORTED_AT);
        expect(md).toContain('## Hip mobility — planned 1 sets');
        expect(md).toContain('## Plank — planned 1×45 s');
        expect(md).toContain('## Not performed: Skips (planned 1 sets)');
    });

    it('keeps the earlier choice on sets done before a correction and lists session-level choices', () => {
        const earlier = {
            choiceEntryId: 'ch-1', effective: false, choiceId: 'c', optionId: 'heavy', optionLabel: 'Heavy', supersededByChoiceEntryId: 'ch-2', completedAt: stamp,
        };
        const stray = { choiceEntryId: 'ch-7', effective: false, choiceId: 'c', optionId: 'skip', optionLabel: 'Skip', completedAt: stamp };
        const later = { choiceEntryId: 'ch-2', effective: true, choiceId: 'c', optionId: 'light', optionLabel: 'Light', supersedesChoiceEntryId: 'ch-1', completedAt: stamp };
        const view = withSteps([{
            stepId: 'sq', title: 'Squat', isOptional: false, prescribed: { sets: 2, reps: 5 },
            choices: [earlier, later, stray],
            sets: [
                { entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: stamp, payload: rep(1, 5, 120), governingChoiceEntryId: 'ch-1', selectedOptionId: 'heavy' },
                { entryId: 'e2', setNumber: 2, isWarmup: false, completedAt: stamp, payload: rep(2, 5, 90), governingChoiceEntryId: 'ch-2', selectedOptionId: 'light' },
            ],
        }]);
        const withSession: CompletedWorkoutView = {
            ...view,
            structured: {
                ...view.structured!,
                sessionChoices: [{ choiceEntryId: 'ch-9', effective: true, choiceId: 'route', optionId: 'indoor', optionLabel: 'Indoor', reason: 'Rain', completedAt: stamp }],
            },
        };
        const md = formatCompletedWorkoutMarkdown(withSession, EXPORTED_AT);
        expect(md).toContain('choice (later corrected): Heavy');
        expect(md).toContain('choice (not applied): Skip');
        expect(md).toContain('choice: Light');
        expect(md).toContain('1: 5 @ 120 kg · under earlier choice: Heavy');
        expect(md).toMatch(/2: 5 @ 90 kg\n/);
        expect(md).toContain('## Session choices\nchoice: Indoor (reason: Rain)');
    });

    it('names absent sections on the missing line', () => {
        const view: CompletedWorkoutView = {
            ...structuredView,
            structured: { ...structuredView.structured!, performedRest: 'not_recorded' },
        };
        expect(formatCompletedWorkoutMarkdown(view, EXPORTED_AT)).toContain('missing: performed rest (not_recorded)');
    });

    it('prints responses: unavailable', () => {
        expect(formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, 'unavailable')).toContain('responses: unavailable (read failed)');
        expect(formatCompletedWorkoutMarkdown(structuredView, EXPORTED_AT, { status: 'failed' })).toContain('responses: unavailable (read failed)');
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

    it('renders per-set side on warm-ups, paired holds/carries, and non-duration/distance sets while omitting bilateral', () => {
        const md = formatCompletedWorkoutMarkdown(withSteps([
            {
                stepId: 'carry', title: 'Suitcase Carry', isOptional: false, prescribed: { sets: 1, meters: 20 },
                sets: [
                    { entryId: 'c1', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'left', payload: { kind: 'distance', meters: 20, loadKg: 24 } },
                    { entryId: 'c2', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'right', payload: { kind: 'distance', meters: 20, loadKg: 24 } },
                ],
            },
            {
                stepId: 'hold', title: 'Side Plank', isOptional: false, prescribed: { sets: 1, seconds: 45 },
                sets: [
                    { entryId: 'h1', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'left', payload: { kind: 'duration', seconds: 45 } },
                    { entryId: 'h2', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'right', payload: { kind: 'duration', seconds: 45 } },
                ],
            },
            {
                stepId: 'split', title: 'Bulgarian Split Squat', isOptional: false, prescribed: { sets: 2, reps: 8 },
                sets: [
                    { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: stamp, side: 'left', payload: rep(0, 5, 10, { isWarmup: true }) },
                    { entryId: 'w2', setNumber: 2, isWarmup: true, completedAt: stamp, side: 'right', payload: rep(0, 5, 10, { isWarmup: true }) },
                    { entryId: 'w3', setNumber: 3, isWarmup: true, completedAt: stamp, side: 'bilateral' as never, payload: rep(0, 5, 0, { isWarmup: true }) },
                    { entryId: 's1', setNumber: 1, isWarmup: false, completedAt: stamp, side: 'left', payload: rep(1, 8, 20) },
                    { entryId: 's2', setNumber: 2, isWarmup: false, completedAt: stamp, side: 'right', payload: rep(2, 8, 20) },
                    { entryId: 's3', setNumber: 3, isWarmup: false, completedAt: stamp, side: 'bilateral' as never, payload: rep(3, 8, 40) },
                ],
            },
        ]), EXPORTED_AT);
        expect(md).toContain('1: left 20 m @ 24 kg\n1: right 20 m @ 24 kg');
        expect(md).toContain('1: left 45 s\n1: right 45 s');
        expect(md).toContain('warm-up: left 5 @ 10 kg, right 5 @ 10 kg, 5 @ 0 kg');
        expect(md).toContain('1: left 8 @ 20 kg\n2: right 8 @ 20 kg\n3: 8 @ 40 kg');
        expect(md).not.toContain('bilateral');
    });

    it('escapes metacharacters/newlines and redacts emails and identities across authored and provider text', () => {
        const hostile = 'Title\n## H2 | <tag> & `code` [x](u) *b* _i_\r\u2028\u2029 owner@example.com owner-uid-99 garmin-act-secret-77 exec-1';
        const view: CompletedWorkoutView = {
            ...structuredView,
            sourceReads: { ...completeReads, structured: { status: 'definition_unresolved', definition: 'MISSING' } },
            structured: {
                ...structuredView.structured!,
                title: hostile,
                sessionChoices: [{
                    choiceEntryId: 'sc1', effective: true, choiceId: 'c0', optionId: 'opt_[0]',
                    optionLabel: 'Option | *label* owner@example.com', reason: 'Because\n## reason owner-uid-99',
                    completedAt: stamp,
                }],
                execution: {
                    ...structuredView.structured!.execution!,
                    note: 'Session\nnote owner@example.com owner-uid-99 | _edge_',
                },
                steps: [
                    {
                        stepId: 's-main',
                        title: 'Swapped *Exercise*\n## H2 owner-uid-99',
                        plannedTitle: 'Planned | Exercise owner@example.com',
                        isOptional: false,
                        prescribed: {
                            sets: 2, reps: 6,
                            load: { kind: 'band', bandColor: 'red_[band]|owner-uid-99' },
                            tempo: '3-1-1-0\n## tempo',
                            notes: 'Step *note* <br> owner@example.com',
                        },
                        choices: [{
                            choiceEntryId: 'ch1', effective: false, supersededByChoiceEntryId: 'ch2',
                            choiceId: 'c1', optionId: 'opt_id|owner@example.com',
                            reason: 'Pain | *bad*\nnext', completedAt: stamp,
                        }, {
                            choiceEntryId: 'ch2', effective: true, supersedesChoiceEntryId: 'ch1',
                            choiceId: 'c1', optionId: 'opt2', optionLabel: 'Better `opt` owner-uid-99',
                            completedAt: stamp,
                        }],
                        sets: [{
                            entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: stamp,
                            payload: rep(1, 6, 40),
                            governingChoiceEntryId: 'ch1',
                            exerciseRef: { kind: 'catalog', exerciseId: 'owner-uid-99_squat|<tag>' },
                        }],
                    },
                    {
                        stepId: 's-desc',
                        title: 'Carry',
                        isOptional: false,
                        prescribed: { sets: 1, load: { kind: 'descriptive', display: 'Heavy `sandbag` owner@example.com' } },
                        sets: [],
                    },
                ],
            },
        };
        // No responses passed: caller-supplied userId must still be redacted.
        const md = formatCompletedWorkoutMarkdown(view, EXPORTED_AT, undefined, new Set(['owner-uid-99']));
        expect(md).not.toContain('owner@example.com');
        expect(md).not.toContain('owner-uid-99');
        expect(md).not.toContain('garmin-act-secret-77');
        expect(md).not.toContain('exec-1');
        expect(md).not.toContain('\n## H2');
        expect(md).not.toContain('\n## reason');
        expect(md).not.toContain('\n## tempo');
        expect(md).not.toContain('<tag>');
        expect(md).not.toContain('<br>');
        expect(md).toContain('&#92;u000a');
        expect(md).toContain('&#92;u000d');
        expect(md).toContain('&#92;u2028');
        expect(md).toContain('&#92;u2029');
        expect(md).toContain('&#91;redacted&#93;');
        expect(md).toContain('performed as &#91;redacted&#93; squat&#124;&#60;tag&#62;');
        expect(md).toContain('&#95;edge&#95;');
        expect(md).toContain('Heavy &#96;sandbag&#96; &#91;redacted&#93;');
        expect(md).toContain('red&#95;&#91;band&#93;&#124;&#91;redacted&#93; band');
        expect(md).toContain('under earlier choice: opt_id&#124;&#91;redacted&#93;');
        expect(md).toContain('\nref: pto-1\n');

        // Response notes and techniqueNote are also redacted and escaped; the occurrence id appears only as the trailing ref.
        const withResponses = formatCompletedWorkoutMarkdown(
            { ...structuredView, performedOccurrenceId: 'pto-keep-me' },
            EXPORTED_AT,
            [response({ techniqueNote: 'Cue\n| owner-uid-99', note: 'Felt *good* owner@example.com pto-keep-me' })],
            new Set(['owner-uid-99']),
        );
        expect(withResponses).not.toContain('owner-uid-99');
        expect(withResponses).not.toContain('owner@example.com');
        expect(withResponses).toContain('technique: Cue&#92;u000a&#124; &#91;redacted&#93;');
        expect(withResponses).toContain('note: Felt &#42;good&#42; &#91;redacted&#93; &#91;redacted&#93;');
        expect(withResponses.trimEnd().endsWith('ref: pto-keep-me')).toBe(true);
        expect(withResponses.split('pto-keep-me')).toHaveLength(2);

        // Provider-only workout title (garmin.type) is redacted and escaped.
        const providerHostile: CompletedWorkoutView = {
            ...providerOnlyView,
            performedOccurrenceId: 'pto-provider',
            garmin: { ...providerOnlyView.garmin!, type: 'owner-uid-99_##_[run]\n| <x>' },
        };
        const providerMd = formatCompletedWorkoutMarkdown(providerHostile, EXPORTED_AT, undefined, new Set(['owner-uid-99']));
        expect(providerMd).not.toContain('owner-uid-99');
        expect(providerMd).not.toContain('\n##');
        expect(providerMd).toContain('# Session: &#91;redacted&#93; ## &#91;run&#93;&#92;u000a&#124; &#60;x&#62;');
        expect(providerMd).toContain('ref: pto-provider');

        // structuredLogLine escapes definition_unresolved status/definition if custom values arrive.
        const unresolved: CompletedWorkoutView = {
            ...providerOnlyView,
            sourceReads: { ...completeReads, structured: { status: 'definition_unresolved', definition: 'owner-uid-99|bad' as never } },
        };
        const unresolvedMd = formatCompletedWorkoutMarkdown(unresolved, EXPORTED_AT, undefined, new Set(['owner-uid-99']));
        expect(unresolvedMd).toContain('structured log: unavailable (definition_unresolved: &#91;redacted&#93;&#124;bad)');
    });
});
