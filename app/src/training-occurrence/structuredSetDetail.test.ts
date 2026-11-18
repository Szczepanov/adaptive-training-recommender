import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry, SessionRestEvent } from '../sessions/models';
import { buildSessionLevelChoices, buildStructuredStepDetails } from './structuredSetDetail';

const definition: SessionDefinition = {
    schemaVersion: 1,
    id: 'w-1',
    revision: 1,
    title: 'Heavy Squat Day',
    intent: 'training',
    blocks: [{
        id: 'b1',
        role: 'main',
        steps: [
            {
                id: 'squat',
                kind: 'exercise',
                title: 'Back Squat',
                dose: { kind: 'repetition', sets: 3, reps: 5 },
                load: { kind: 'mass', kg: 100 },
                effort: { rir: 2 },
                rest: 180,
            },
            { id: 'walk', kind: 'transition' },
            { id: 'plank', kind: 'exercise', title: 'Plank', dose: { kind: 'duration', sets: 2, seconds: 45 }, optional: true },
        ],
    }],
} as SessionDefinition;

function repEntry(
    id: string,
    completedAt: string,
    reps: number,
    weightKg: number,
    isWarmup = false,
    exerciseRef?: SessionEntry['exerciseRef'],
): SessionEntry {
    return {
        id,
        executionId: 'exec-1',
        stepId: 'squat',
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
        payload: { kind: 'repetition', setIndex: 0, reps, weightKg, ...(isWarmup ? { isWarmup: true } : {}) },
        ...(exerciseRef ? { exerciseRef } : {}),
    };
}

function restEvent(afterEntryId: string, actualSeconds: number, prescribedSeconds?: number): SessionRestEvent {
    return {
        id: `rest-${afterEntryId}`,
        executionId: 'exec-1',
        afterEntryId,
        startedAt: '2026-08-26T07:00:00.000Z',
        endedAt: '2026-08-26T07:03:00.000Z',
        actualSeconds,
        endReason: 'next_set_started',
        ...(prescribedSeconds !== undefined ? { prescribedSeconds } : {}),
        createdAt: '2026-08-26T07:03:00.000Z',
        updatedAt: '2026-08-26T07:03:00.000Z',
    };
}

describe('buildStructuredStepDetails', () => {
    it('keeps the prescription, numbers warm-up and work sets separately, and attaches performed rest', () => {
        const entries = [
            repEntry('e-work-2', '2026-08-26T07:10:00.000Z', 5, 100, false, { kind: 'catalog', exerciseId: 'front_squat' }),
            repEntry('e-warm-1', '2026-08-26T07:00:00.000Z', 5, 60, true),
            repEntry('e-work-1', '2026-08-26T07:05:00.000Z', 4, 100),
        ];
        const [squat] = buildStructuredStepDetails(definition, entries, [restEvent('e-work-1', 205, 180)]);

        // Two sets as authored, then a swap: the summary names both, in the order performed.
        expect(squat.title).toBe('Back Squat / Front Squat');
        expect(squat.plannedTitle).toBe('Back Squat');
        expect(squat.performedExerciseRef).toBeUndefined();
        expect(squat.prescribed).toEqual({
            sets: 3,
            reps: 5,
            load: { kind: 'mass', kg: 100 },
            effort: { rir: 2 },
            restSeconds: 180,
        });
        expect(squat.sets.map(set => [set.entryId, set.isWarmup, set.setNumber])).toEqual([
            ['e-warm-1', true, 1],
            ['e-work-1', false, 1],
            ['e-work-2', false, 2],
        ]);
        expect(squat.sets[1].rest).toEqual({ prescribedSeconds: 180, actualSeconds: 205, endReason: 'next_set_started' });
        expect(squat.sets[0].rest).toBeUndefined();
        expect(squat.sets[2].exerciseRef).toEqual({ kind: 'catalog', exerciseId: 'front_squat' });
    });

    it('omits unlogged non-exercise steps but keeps unlogged exercise steps as missed prescriptions', () => {
        const details = buildStructuredStepDetails(definition, [], []);

        expect(details.map(step => step.stepId)).toEqual(['squat', 'plank']);
        expect(details[1]).toMatchObject({ isOptional: true, prescribed: { sets: 2, seconds: 45 }, sets: [] });
    });

    it('marks a non-exercise step kept only for a recorded choice as choiceOnly with no prescription', () => {
        const gateDefinition = {
            ...definition,
            blocks: [{ ...definition.blocks[0], steps: [{ id: 'gate', kind: 'transition', title: 'Gate' }] }],
        } as SessionDefinition;
        const choice: SessionEntry = {
            id: 'choice-1', executionId: 'exec-1', stepId: 'gate',
            completedAt: '2026-08-26T07:00:00.000Z', createdAt: '2026-08-26T07:00:00.000Z', updatedAt: '2026-08-26T07:00:00.000Z',
            payload: { kind: 'choice', choiceId: 'c', optionId: 'o' },
        };
        const [gate] = buildStructuredStepDetails(gateDefinition, [choice], []);
        expect(gate.choiceOnly).toBe(true);
        expect(gate.prescribed.sets).toBe(0);
        expect(gate.choices).toHaveLength(1);
        const [exercise] = buildStructuredStepDetails(definition, [], []);
        expect(exercise.choiceOnly).toBeUndefined();
    });

    it('never counts a recorded athlete choice as a performed set', () => {
        const choice: SessionEntry = {
            id: 'choice-1',
            executionId: 'exec-1',
            stepId: 'squat',
            completedAt: '2026-08-26T07:00:00.000Z',
            createdAt: '2026-08-26T07:00:00.000Z',
            updatedAt: '2026-08-26T07:00:00.000Z',
            payload: { kind: 'choice', choiceId: 'c', optionId: 'o' },
        };
        const [squat] = buildStructuredStepDetails(definition, [choice], []);
        expect(squat.sets).toEqual([]);
    });

    it('names a fully swapped step after the performed exercise and keeps the planned name', () => {
        const benchDefinition = {
            ...definition,
            blocks: [{
                id: 'b1', role: 'main', executionMode: 'sequential',
                steps: [{
                    id: 'press', kind: 'exercise', title: 'Bench Press',
                    exerciseRef: { kind: 'catalog', exerciseId: 'barbell_bench_press' },
                    dose: { kind: 'repetition', sets: 3, reps: 8 },
                }],
            }],
        } as SessionDefinition;
        const swapped = { kind: 'catalog', exerciseId: 'single_arm_dumbbell_floor_press' } as const;
        const entries = [
            { ...repEntry('p1', '2026-08-26T07:00:00.000Z', 8, 22, false, swapped), stepId: 'press' },
            { ...repEntry('p2', '2026-08-26T07:03:00.000Z', 8, 22, false, swapped), stepId: 'press' },
        ];

        const [press] = buildStructuredStepDetails(benchDefinition, entries, []);

        expect(press.title).toBe('Single-arm Dumbbell Floor Press');
        expect(press.plannedTitle).toBe('Bench Press');
        expect(press.performedExerciseRef).toEqual(swapped);
        expect(press.exerciseRef).toEqual({ kind: 'catalog', exerciseId: 'barbell_bench_press' });
    });

    it('keeps the authored name when every set matches the authored exercise', () => {
        const ref = { kind: 'catalog', exerciseId: 'back_squat' } as const;
        const authored = {
            ...definition,
            blocks: [{ ...definition.blocks[0], steps: [{ ...definition.blocks[0].steps[0], exerciseRef: ref }] }],
        } as SessionDefinition;
        const [squat] = buildStructuredStepDetails(authored, [repEntry('s1', '2026-08-26T07:00:00.000Z', 5, 100, false, ref)], []);
        expect(squat.title).toBe('Back Squat');
        expect(squat.plannedTitle).toBeUndefined();
    });

    it('reports sets logged against an exercise added during the session instead of dropping them', () => {
        const added = { kind: 'unresolved_free_text', name: 'Back Extension' } as const;
        const entries = [
            { ...repEntry('x2', '2026-08-26T07:22:00.000Z', 12, 0, false, added), stepId: 'added-abc' },
            { ...repEntry('x1', '2026-08-26T07:20:00.000Z', 15, 0, false, added), stepId: 'added-abc' },
        ];

        const details = buildStructuredStepDetails(definition, entries, []);
        const extra = details.find(step => step.stepId === 'added-abc');

        expect(extra).toBeDefined();
        expect(extra?.unplanned).toBe(true);
        expect(extra?.title).toBe('Back Extension');
        expect(extra?.prescribed).toEqual({ sets: 0 });
        expect(extra?.sets.map(set => [set.entryId, set.setNumber])).toEqual([['x1', 1], ['x2', 2]]);
        expect(details.at(-1)?.stepId).toBe('added-abc');
    });

    it('copies tempo and notes into the prescribed target', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0], steps: [
                { id: 'squat', kind: 'exercise', title: 'Back Squat', dose: { kind: 'repetition', sets: 3, reps: 5 }, tempo: '31X0', notes: 'brace' },
            ] }],
        } as SessionDefinition;
        const [squat] = buildStructuredStepDetails(def, [], []);
        expect(squat.prescribed.tempo).toBe('31X0');
        expect(squat.prescribed.notes).toBe('brace');
    });

    it('attaches a choice entry to its step with label and reason', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0], optionSets: [{
                id: 'c1',
                appliesAtStepId: 'squat',
                trigger: { kind: 'athlete_observed', description: 'knee pain' },
                options: [{ id: 'o2', label: 'Goblet squat', actions: [] }],
            }] }],
        } as SessionDefinition;
        const completedAt = '2026-08-26T07:01:00.000Z';
        const choice = {
            id: 'ch-1',
            executionId: 'exec-1',
            completedAt,
            createdAt: completedAt,
            updatedAt: completedAt,
            payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2', reason: 'knee' },
        } as SessionEntry;
        const squat = buildStructuredStepDetails(def, [choice], []).find(step => step.stepId === 'squat');
        expect(squat?.choices).toEqual([{
            choiceEntryId: 'ch-1', choiceId: 'c1', optionId: 'o2', optionLabel: 'Goblet squat', reason: 'knee', completedAt, effective: true,
        }]);
        expect(squat?.sets).toEqual([]);
    });

    it('keeps every event of a supersession chain and marks only the last one effective', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0], optionSets: [{
                id: 'c1',
                appliesAtStepId: 'squat',
                trigger: { kind: 'athlete_observed', description: 'knee pain' },
                options: [
                    { id: 'o1', label: 'Skip', actions: [] },
                    { id: 'o2', label: 'Goblet squat', actions: [] },
                ],
            }] }],
        } as SessionDefinition;
        const mk = (id: string, at: string, optionId: string, extra: object = {}) => ({
            id, executionId: 'exec-1', completedAt: at, createdAt: at, updatedAt: at,
            payload: { kind: 'choice', choiceId: 'c1', optionId }, ...extra,
        }) as SessionEntry;
        const entries = [
            mk('ch-1', '2026-08-26T07:01:00.000Z', 'o1'),
            mk('ch-2', '2026-08-26T07:02:00.000Z', 'o2', { supersedesChoiceEntryId: 'ch-1' }),
        ];
        const squat = buildStructuredStepDetails(def, entries, []).find(step => step.stepId === 'squat');
        expect(squat?.choices).toEqual([
            {
                choiceEntryId: 'ch-1', choiceId: 'c1', optionId: 'o1', optionLabel: 'Skip', completedAt: '2026-08-26T07:01:00.000Z',
                supersededByChoiceEntryId: 'ch-2', effective: false,
            },
            {
                choiceEntryId: 'ch-2', choiceId: 'c1', optionId: 'o2', optionLabel: 'Goblet squat', completedAt: '2026-08-26T07:02:00.000Z',
                supersedesChoiceEntryId: 'ch-1', effective: true,
            },
        ]);

        // A second event with no supersession edge is history only: it cannot take over the choice.
        const unlinked = buildStructuredStepDetails(def, [entries[0], mk('ch-3', '2026-08-26T07:03:00.000Z', 'o2')], [])
            .find(step => step.stepId === 'squat');
        expect(unlinked?.choices?.map(choice => [choice.choiceEntryId, choice.effective, choice.supersededByChoiceEntryId]))
            .toEqual([['ch-1', true, undefined], ['ch-3', false, undefined]]);
    });

    it('keeps the governing choice on sets performed before a correction', () => {
        const at = '2026-08-26T07:05:00.000Z';
        const set = {
            id: 'set-1', executionId: 'exec-1', stepId: 'squat', completedAt: at, createdAt: at, updatedAt: at,
            governingChoiceEntryId: 'ch-1', selectedOptionId: 'o1',
            payload: { kind: 'repetition', setIndex: 1, reps: 5 },
        } as SessionEntry;
        const [row] = buildStructuredStepDetails(definition, [set], []).find(step => step.stepId === 'squat')!.sets;
        expect(row).toMatchObject({ governingChoiceEntryId: 'ch-1', selectedOptionId: 'o1' });
    });

    it('keeps choices recorded against an added step and against an unknown step', () => {
        const at = '2026-08-26T07:10:00.000Z';
        const mkEntry = (id: string, stepId: string, payload: SessionEntry['payload'], extra: object = {}) => ({
            id, executionId: 'exec-1', stepId, completedAt: at, createdAt: at, updatedAt: at, payload, ...extra,
        }) as SessionEntry;
        const entries = [
            mkEntry('ch-a', 'added-1', { kind: 'choice', choiceId: 'x', optionId: 'o' }),
            mkEntry('set-a', 'added-1', { kind: 'repetition', setIndex: 1, reps: 10 }, { governingChoiceEntryId: 'ch-a' }),
            mkEntry('ch-b', 'ghost', { kind: 'choice', choiceId: 'y', optionId: 'p' }),
        ];
        const details = buildStructuredStepDetails(definition, entries, []);
        const added = details.find(step => step.stepId === 'added-1');
        expect(added?.unplanned).toBe(true);
        expect(added?.choices?.map(choice => choice.choiceEntryId)).toEqual(['ch-a']);
        expect(added?.sets[0].governingChoiceEntryId).toBe('ch-a');
        const ghost = details.find(step => step.stepId === 'ghost');
        expect(ghost).toMatchObject({ choiceOnly: true, prescribed: { sets: 0 }, sets: [] });
        expect(ghost?.choices?.map(choice => choice.choiceEntryId)).toEqual(['ch-b']);
    });

    it('reports a choice that applies to no step at session level', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0], optionSets: [{
                id: 'route', trigger: { kind: 'athlete_observed', description: 'weather' },
                options: [{ id: 'indoor', label: 'Indoor', actions: [] }],
            }] }],
        } as unknown as SessionDefinition;
        const at = '2026-08-26T06:59:00.000Z';
        const choice = {
            id: 'ch-r', executionId: 'exec-1', completedAt: at, createdAt: at, updatedAt: at,
            payload: { kind: 'choice', choiceId: 'route', optionId: 'indoor', reason: 'rain' },
        } as SessionEntry;
        expect(buildSessionLevelChoices(def, [choice])).toEqual([{
            choiceEntryId: 'ch-r', choiceId: 'route', optionId: 'indoor', optionLabel: 'Indoor', reason: 'rain', completedAt: at, effective: true,
        }]);
        expect(buildStructuredStepDetails(def, [choice], []).some(step => step.choices)).toBe(false);
    });

    it('keeps a choice anchored at a non-exercise step', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0],
                steps: [...definition.blocks[0].steps, { id: 'gate', kind: 'transition', title: 'Gate' }],
                optionSets: [{
                    id: 'c9',
                    appliesAtStepId: 'gate',
                    trigger: { kind: 'athlete_observed', description: 'tired' },
                    options: [{ id: 'oa', label: 'End early', actions: [] }],
                }] }],
        } as unknown as SessionDefinition;
        const at = '2026-08-26T07:03:00.000Z';
        const choice = {
            id: 'ch-9', executionId: 'exec-1', completedAt: at, createdAt: at, updatedAt: at,
            payload: { kind: 'choice', choiceId: 'c9', optionId: 'oa' },
        } as SessionEntry;
        const gate = buildStructuredStepDetails(def, [choice], []).find(step => step.stepId === 'gate');
        expect(gate?.choices?.[0]?.optionLabel).toBe('End early');
    });

    it('excludes tombstoned entries from sets and choices', () => {
        const def = {
            ...definition,
            blocks: [{ ...definition.blocks[0], optionSets: [{
                id: 'c1',
                appliesAtStepId: 'squat',
                trigger: { kind: 'athlete_observed', description: 'x' },
                options: [{ id: 'o2', label: 'Goblet squat', actions: [] }],
            }] }],
        } as SessionDefinition;
        const deletedAt = '2026-11-14T10:00:00Z';
        const choice = {
            id: 'ch-1', executionId: 'exec-1', completedAt: '2026-08-26T07:01:00.000Z',
            createdAt: '2026-08-26T07:01:00.000Z', updatedAt: deletedAt, deletedAt,
            payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2' },
        } as SessionEntry;
        const [squat] = buildStructuredStepDetails(def, [
            { ...repEntry('gone', '2026-08-26T07:05:00.000Z', 5, 100), deletedAt },
            choice,
        ], []);
        expect(squat.sets).toEqual([]);
        expect(squat.choices).toBeUndefined();
    });
});

describe('buildStructuredStepDetails per-side set numbers', () => {
    it('gives both sides of a left/right hold pair the same set number', () => {
        const hold = (id: string, at: string, side: 'left' | 'right'): SessionEntry => ({
            id, executionId: 'exec-1', stepId: 'plank', completedAt: at, createdAt: at, updatedAt: at, side,
            payload: { kind: 'duration', seconds: 45 },
        });
        const entries = [
            hold('l1', '2026-08-26T07:20:00.000Z', 'left'),
            hold('r1', '2026-08-26T07:21:00.000Z', 'right'),
            hold('l2', '2026-08-26T07:24:00.000Z', 'left'),
        ];
        const plank = buildStructuredStepDetails(definition, entries, []).find(step => step.stepId === 'plank')!;
        expect(plank.sets.map(set => [set.side, set.setNumber])).toEqual([['left', 1], ['right', 1], ['left', 2]]);
    });
});
