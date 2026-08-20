import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { resolveEffectiveSession } from './choiceResolution';

function definitionWithChoice(overrides: Partial<SessionDefinition['blocks'][number]> = {}): SessionDefinition {
    return {
        schemaVersion: 1,
        id: 'def-1',
        revision: 1,
        title: 'Test session',
        intent: 'training',
        blocks: [
            {
                id: 'block-1',
                role: 'main',
                executionMode: 'sequential',
                optionSets: [
                    {
                        id: 'choice-1',
                        appliesAtStepId: 'step-1',
                        trigger: { kind: 'athlete_observed', description: 'How did it feel?' },
                        options: [
                            { id: 'opt-continue', label: 'Continue', actions: [] },
                            {
                                id: 'opt-reduce-load',
                                label: 'Reduce load 10%',
                                actions: [{ kind: 'reduce_load_percent', targetStepId: 'step-1', percent: 10 }],
                            },
                            {
                                id: 'opt-reduce-sets',
                                label: 'Reduce sets',
                                actions: [{ kind: 'reduce_sets', targetStepId: 'step-1', sets: 2 }],
                            },
                            {
                                id: 'opt-reduce-reps',
                                label: 'Reduce reps',
                                actions: [{ kind: 'reduce_reps', targetStepId: 'step-1', reps: 3 }],
                            },
                            {
                                id: 'opt-alternative',
                                label: 'Switch exercise',
                                actions: [{ kind: 'select_alternative', targetStepId: 'step-1', alternativeId: 'alt-1' }],
                            },
                            {
                                id: 'opt-omit',
                                label: 'Skip it',
                                actions: [{ kind: 'omit_step', targetStepId: 'step-1' }],
                            },
                            {
                                id: 'opt-end-block',
                                label: 'End block',
                                actions: [{ kind: 'end_block', targetBlockId: 'block-1' }],
                            },
                            {
                                id: 'opt-end-session',
                                label: 'End session',
                                actions: [{ kind: 'end_session' }],
                            },
                        ],
                    },
                ],
                steps: [
                    {
                        id: 'step-1',
                        kind: 'exercise',
                        exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                        dose: { kind: 'repetition', sets: 3, reps: 5 },
                        load: { kind: 'mass', kg: 100 },
                        alternatives: [
                            {
                                id: 'alt-1',
                                title: 'Goblet Squat',
                                exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' },
                            },
                        ],
                    },
                    { id: 'step-2', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' } },
                ],
                ...overrides,
            },
        ],
    };
}

function choiceEntry(optionId: string, completedAt: string, id = `choice-entry-${completedAt}`): SessionEntry {
    return {
        id,
        executionId: 'exec',
        stepId: 'step-1',
        selectedOptionId: optionId,
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
        payload: { kind: 'choice', choiceId: 'choice-1', optionId },
    };
}

describe('resolveEffectiveSession', () => {
    it('returns the input definition unchanged when there are no choice entries', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, []);
        expect(view.definition).toBe(definition);
        expect(view.endedBlockIds.size).toBe(0);
        expect(view.sessionEnded).toBe(false);
    });

    it('scales a mass load by reduce_load_percent', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-reduce-load', '2026-08-18T10:00:00.000Z')]);
        const step = view.definition.blocks[0].steps[0];
        expect(step.load).toEqual({ kind: 'mass', kg: 90 });
    });

    it('overrides the dose set/rep target on reduce_sets and reduce_reps', () => {
        const definition = definitionWithChoice();
        const setsView = resolveEffectiveSession(definition, [choiceEntry('opt-reduce-sets', '2026-08-18T10:00:00.000Z')]);
        expect(setsView.definition.blocks[0].steps[0].dose).toEqual({ kind: 'repetition', sets: 2, reps: 5 });

        const repsView = resolveEffectiveSession(definition, [choiceEntry('opt-reduce-reps', '2026-08-18T10:00:00.000Z')]);
        expect(repsView.definition.blocks[0].steps[0].dose).toEqual({ kind: 'repetition', sets: 3, reps: 3 });
    });

    it('substitutes exerciseRef/dose/load and sets a resolutionNote on select_alternative', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-alternative', '2026-08-18T10:00:00.000Z')]);
        const step = view.definition.blocks[0].steps[0];
        expect(step.exerciseRef).toEqual({ kind: 'catalog', exerciseId: 'goblet_squat' });
        expect(step.title).toBe('Goblet Squat');
        expect(step.resolutionNote).toContain('Goblet Squat');
    });

    it('marks the target step optional on omit_step, leaving other steps untouched', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-omit', '2026-08-18T10:00:00.000Z')]);
        expect(view.definition.blocks[0].steps[0].optional).toBe(true);
        expect(view.definition.blocks[0].steps[1].optional).toBeUndefined();
    });

    it('marks every not-yet-answered step in the block optional and records endedBlockIds on end_block', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-end-block', '2026-08-18T10:00:00.000Z')]);
        expect(view.definition.blocks[0].steps.every(step => step.optional)).toBe(true);
        expect(view.endedBlockIds.has('block-1')).toBe(true);
        expect(view.sessionEnded).toBe(false);
    });

    it('marks every step across every block optional and sets sessionEnded on end_session', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-end-session', '2026-08-18T10:00:00.000Z')]);
        expect(view.definition.blocks[0].steps.every(step => step.optional)).toBe(true);
        expect(view.sessionEnded).toBe(true);
    });

    it('applies later choices after earlier ones regardless of array order, last write wins on a shared field', () => {
        const definition = definitionWithChoice();
        const earlier = choiceEntry('opt-reduce-load', '2026-08-18T10:00:00.000Z', 'entry-a');
        const later = choiceEntry('opt-continue', '2026-08-18T10:05:00.000Z', 'entry-b');
        // Passed out of chronological order -- resolution must sort by completedAt, not array order.
        const view = resolveEffectiveSession(definition, [later, earlier]);
        // 'opt-continue' has no actions, so the earlier load reduction is the last actual effect.
        expect(view.definition.blocks[0].steps[0].load).toEqual({ kind: 'mass', kg: 90 });

        const bothReduce = resolveEffectiveSession(definition, [
            earlier,
            choiceEntry('opt-reduce-sets', '2026-08-18T10:05:00.000Z', 'entry-c'),
        ]);
        // Two different choices targeting the same step both apply -- independent fields.
        expect(bothReduce.definition.blocks[0].steps[0].load).toEqual({ kind: 'mass', kg: 90 });
        expect(bothReduce.definition.blocks[0].steps[0].dose).toEqual({ kind: 'repetition', sets: 2, reps: 5 });
    });

    it('preserves block/step array shape and order so index-based navigation stays valid', () => {
        const definition = definitionWithChoice();
        const view = resolveEffectiveSession(definition, [choiceEntry('opt-omit', '2026-08-18T10:00:00.000Z')]);
        expect(view.definition.blocks.length).toBe(definition.blocks.length);
        expect(view.definition.blocks[0].steps.length).toBe(definition.blocks[0].steps.length);
        expect(view.definition.blocks[0].steps.map(step => step.id)).toEqual(definition.blocks[0].steps.map(step => step.id));
    });

    it('does not mutate the original definition object', () => {
        const definition = definitionWithChoice();
        const originalLoad = definition.blocks[0].steps[0].load;
        resolveEffectiveSession(definition, [choiceEntry('opt-reduce-load', '2026-08-18T10:00:00.000Z')]);
        expect(definition.blocks[0].steps[0].load).toBe(originalLoad);
        expect(definition.blocks[0].steps[0].load).toEqual({ kind: 'mass', kg: 100 });
    });
});
