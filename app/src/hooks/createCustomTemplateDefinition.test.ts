import { describe, expect, it } from 'vitest';
import { appendAddedExerciseStep } from '../sessions/addedExerciseStep';
import type { SessionDefinition } from '../sessions/models';
import { validateSessionDefinition } from '../sessions/validation';
import { createCustomTemplateDefinition } from './useSessionRunner';

describe('createCustomTemplateDefinition', () => {
    it('saves a copy whose source already has an extra-exercises block next to the added-exercises block', () => {
        const source: SessionDefinition = {
            schemaVersion: 1, id: 'def', revision: 1, title: 'Lower', intent: 'training',
            blocks: [
                { id: 'main', title: 'Main', role: 'main', executionMode: 'sequential',
                    steps: [{ id: 'squat', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 } }] },
                { id: 'extra-exercises', title: 'Extra', role: 'accessory', executionMode: 'sequential',
                    steps: [{ id: 'extra-old', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'hip_thrust' }, dose: { kind: 'repetition', sets: 2, reps: 8 } }] },
            ],
        } as SessionDefinition;
        const withAdded = appendAddedExerciseStep(source.blocks, {
            exerciseRef: { kind: 'catalog', exerciseId: 'nordic_hamstring_curl' },
            dose: { kind: 'repetition', sets: 2, reps: 5 },
        }, 'x1');

        const copy = createCustomTemplateDefinition({ ...source, blocks: withAdded.blocks }, 'custom-1', 'My lower day');

        // The same check `saveDefinitionRevision` runs before writing.
        const validation = validateSessionDefinition(copy);
        expect(validation.ok ? [] : validation.issues).toEqual([]);
        expect(copy.blocks.map(block => block.id)).toEqual(['main', 'extra-exercises', 'extra-exercises-2']);
        expect(copy.blocks[2].steps.map(step => step.id)).toEqual(['extra-x1']);
    });
});
