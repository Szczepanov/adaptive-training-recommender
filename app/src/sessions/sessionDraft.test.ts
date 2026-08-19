import { describe, expect, it } from 'vitest';
import type { SessionBlock } from './models';
import {
    createDraftAction,
    createDraftAlternative,
    createDraftChoice,
    createDraftOption,
    duplicateDraftBlock,
    duplicateDraftStep,
    moveDraftItem,
} from './sessionDraft';

describe('manual session draft operations', () => {
    it('reorders blocks and steps without changing their identities', () => {
        const first = { id: 'first' };
        const second = { id: 'second' };
        expect(moveDraftItem([first, second], 0, 1)).toEqual([second, first]);
        expect(moveDraftItem([first, second], 0, 1)[1]).toBe(first);
        expect(moveDraftItem([first, second], -1, 1)).toEqual([first, second]);
    });

    it('duplicates a block with fresh ids and remapped in-block choices', () => {
        const block: SessionBlock = {
            id: 'main', role: 'main', executionMode: 'sequential', title: 'Main',
            steps: [{ id: 'squat', kind: 'exercise' }, { id: 'row', kind: 'exercise' }],
            optionSets: [{
                id: 'choice', appliesAtStepId: 'squat', trigger: { kind: 'athlete_observed', description: 'How does it feel?' },
                options: [{ id: 'reduce', label: 'Reduce', actions: [{ kind: 'reduce_sets', targetStepId: 'squat', sets: 2 }] }],
            }],
        };
        let sequence = 0;
        const copy = duplicateDraftBlock(block, prefix => `${prefix}-${++sequence}`);

        expect(copy.id).toBe('block-1');
        expect(copy.steps.map(step => step.id)).toEqual(['step-2', 'step-3']);
        expect(copy.optionSets?.[0].appliesAtStepId).toBe('step-2');
        expect(copy.optionSets?.[0].options[0].actions[0]).toEqual({ kind: 'reduce_sets', targetStepId: 'step-2', sets: 2 });
        expect(block.steps.map(step => step.id)).toEqual(['squat', 'row']);
    });

    it('duplicates a movement with a new id while retaining its prescription', () => {
        const copy = duplicateDraftStep({ id: 'press', kind: 'exercise', title: 'Press', dose: { kind: 'repetition', sets: 3, reps: 8 } }, () => 'step-copy');
        expect(copy).toMatchObject({ id: 'step-copy', title: 'Press (copy)', dose: { kind: 'repetition', sets: 3, reps: 8 } });
    });

    it('creates a new authored choice with one no-op continue option (M3.8)', () => {
        let sequence = 0;
        const choice = createDraftChoice('squat', prefix => `${prefix}-${++sequence}`);
        expect(choice).toEqual({
            id: 'choice-1',
            appliesAtStepId: 'squat',
            trigger: { kind: 'athlete_observed', description: '' },
            options: [{ id: 'option-2', label: 'Continue as prescribed', actions: [] }],
        });
    });

    it('creates a new blank option', () => {
        const option = createDraftOption(() => 'option-x');
        expect(option).toEqual({ id: 'option-x', label: 'New option', actions: [] });
    });

    it('creates a catalog alternative when an exercise id is given, free text otherwise', () => {
        expect(createDraftAlternative('goblet_squat', 'Goblet Squat', () => 'alt-1')).toEqual({
            id: 'alt-1', title: 'Goblet Squat', exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' },
        });
        expect(createDraftAlternative(undefined, 'Custom sub', () => 'alt-2')).toEqual({
            id: 'alt-2', title: 'Custom sub', exerciseRef: { kind: 'unresolved_free_text', name: 'Custom sub' },
        });
    });

    it('creates a structurally valid default action for every action kind, scoped to the authoring step/block', () => {
        const context = { stepId: 'squat', blockId: 'block-main', firstAlternativeId: 'alt-goblet' };
        expect(createDraftAction('select_alternative', context)).toEqual({ kind: 'select_alternative', targetStepId: 'squat', alternativeId: 'alt-goblet' });
        expect(createDraftAction('reduce_load_percent', context)).toEqual({ kind: 'reduce_load_percent', targetStepId: 'squat', percent: 10 });
        expect(createDraftAction('reduce_sets', context)).toEqual({ kind: 'reduce_sets', targetStepId: 'squat', sets: 1 });
        expect(createDraftAction('reduce_reps', context)).toEqual({ kind: 'reduce_reps', targetStepId: 'squat', reps: 1 });
        expect(createDraftAction('omit_step', context)).toEqual({ kind: 'omit_step', targetStepId: 'squat' });
        expect(createDraftAction('end_block', context)).toEqual({ kind: 'end_block', targetBlockId: 'block-main' });
        expect(createDraftAction('end_session', context)).toEqual({ kind: 'end_session' });
    });

    it('defaults select_alternative to an empty alternativeId when the step has no alternatives yet', () => {
        expect(createDraftAction('select_alternative', { stepId: 'squat', blockId: 'block-main' }))
            .toEqual({ kind: 'select_alternative', targetStepId: 'squat', alternativeId: '' });
    });
});
