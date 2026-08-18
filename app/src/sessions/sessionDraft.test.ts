import { describe, expect, it } from 'vitest';
import type { SessionBlock } from './models';
import { duplicateDraftBlock, duplicateDraftStep, moveDraftItem } from './sessionDraft';

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
});
