import { describe, expect, it } from 'vitest';
import type { SessionBlock, SessionDefinition, SessionEntry } from './models';
import { ADDED_EXERCISES_BLOCK_ID, appendAddedExerciseStep, restoreAddedExerciseSteps } from './addedExerciseStep';

const planned: SessionBlock[] = [{
    id: 'main',
    role: 'main',
    executionMode: 'sequential',
    steps: [{ id: 'squat', kind: 'exercise', title: 'Back Squat' }],
}];
const backExtension = {
    exerciseRef: { kind: 'unresolved_free_text', name: 'Back Extension' },
    title: 'Back Extension',
    tempo: null,
    notes: null,
} as const;

describe('appendAddedExerciseStep', () => {
    it('creates a trailing optional block for the first added exercise without touching the plan', () => {
        const result = appendAddedExerciseStep(planned, backExtension, 'u1');
        expect(result.blockIndex).toBe(1);
        expect(result.stepIndex).toBe(0);
        expect(result.blocks[0]).toBe(planned[0]);
        expect(result.blocks[1].id).toBe(ADDED_EXERCISES_BLOCK_ID);
        expect(result.blocks[1].steps[0]).toEqual({
            id: 'added-u1',
            kind: 'exercise',
            optional: true,
            exerciseRef: { kind: 'unresolved_free_text', name: 'Back Extension' },
            title: 'Back Extension',
        });
        expect(planned).toHaveLength(1);
    });

    it('appends further additions to the same block', () => {
        const first = appendAddedExerciseStep(planned, backExtension, 'u1');
        const second = appendAddedExerciseStep(first.blocks, { ...backExtension, title: 'Face Pull' }, 'u2');
        expect(second.blocks).toHaveLength(2);
        expect(second.blockIndex).toBe(1);
        expect(second.stepIndex).toBe(1);
        expect(second.blocks[1].steps.map(step => step.id)).toEqual(['added-u1', 'added-u2']);
        expect(first.blocks[1].steps).toHaveLength(1);
    });

    it('rebuilds added steps from logged sets after a reload, once per step, and ignores planned steps', () => {
        const definition = { schemaVersion: 1, id: 'd', revision: 1, title: 'Day', intent: 'training', blocks: planned } as SessionDefinition;
        const entry = (id: string, stepId: string, completedAt: string, payload: SessionEntry['payload'], exerciseRef?: SessionEntry['exerciseRef']): SessionEntry => ({
            id, executionId: 'e', stepId, completedAt, createdAt: completedAt, updatedAt: completedAt, payload,
            ...(exerciseRef ? { exerciseRef } : {}),
        });
        const entries = [
            entry('c1', 'added-carry', '2026-11-10T08:10:00Z', { kind: 'distance', meters: 40, loadKg: 48 }, { kind: 'catalog', exerciseId: 'farmer_carry' }),
            entry('b2', 'added-back', '2026-11-10T08:06:00Z', { kind: 'repetition', setIndex: 2, reps: 12 }, { kind: 'unresolved_free_text', name: 'Back Extension' }),
            entry('b1', 'added-back', '2026-11-10T08:05:00Z', { kind: 'repetition', setIndex: 1, reps: 15 }, { kind: 'unresolved_free_text', name: 'Back Extension' }),
            entry('s1', 'squat', '2026-11-10T08:00:00Z', { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 100 }),
        ];

        const restored = restoreAddedExerciseSteps(definition, entries);

        expect(restored.blocks).toHaveLength(2);
        expect(restored.blocks[1].steps.map(step => [step.id, step.title, step.dose?.kind])).toEqual([
            ['added-back', 'Back Extension', undefined],
            ['added-carry', 'Farmer Carry', 'distance'],
        ]);
        expect(restoreAddedExerciseSteps(definition, entries.slice(3))).toBe(definition);
    });
});
