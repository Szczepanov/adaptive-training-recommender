import { describe, expect, it } from 'vitest';
import { ADDED_EXERCISES_BLOCK_ID, appendAddedExerciseStep } from './addedExerciseStep';
import type { SessionBlock, SessionStep } from './models';
import { adjacentStepMove, applyStepMove, applyStepMoves } from './stepReorder';

const step = (id: string): SessionStep => ({ id, kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 5 } });
const block = (
    id: string,
    stepIds: string[],
    role: SessionBlock['role'] = 'main',
    executionMode: SessionBlock['executionMode'] = 'sequential',
): SessionBlock => ({ id, title: id, role, executionMode, steps: stepIds.map(step) });
const ids = (blocks: SessionBlock[]) => blocks.map(b => `${b.id}:${b.steps.map(s => s.id).join(',')}`);

const base: SessionBlock[] = [
    block('warmup', ['w1'], 'warmup'),
    block('main', ['squat', 'bench', 'row']),
    block('accessory', ['curl'], 'accessory'),
    block('ss', ['a', 'b'], 'main', 'superset'),
];

/** `base` plus one added exercise (still in the trailing "Added exercises" block). */
function withAdded(): { blocks: SessionBlock[]; addedId: string } {
    const appended = appendAddedExerciseStep(base, { exerciseRef: { kind: 'catalog', exerciseId: 'nordic_hamstring_curl' } }, 'x');
    return { blocks: appended.blocks, addedId: appended.blocks[appended.blockIndex].steps[0].id };
}

describe('applyStepMove', () => {
    it('moves a planned step within its own block without mutating the input', () => {
        const before = ids(base);
        const moved = applyStepMove(base, { stepId: 'row', targetStepId: 'squat', position: 'after' });
        expect(ids(moved)).toEqual(['warmup:w1', 'main:squat,row,bench', 'accessory:curl', 'ss:a,b']);
        expect(ids(base)).toEqual(before);
    });

    it('places an added exercise right after the back squat and drops the emptied added block', () => {
        const { blocks, addedId } = withAdded();
        const moved = applyStepMove(blocks, { stepId: addedId, targetStepId: 'squat', position: 'after' });
        expect(ids(moved)).toEqual(['warmup:w1', `main:squat,${addedId},bench,row`, 'accessory:curl', 'ss:a,b']);
        expect(moved.some(b => b.id === ADDED_EXERCISES_BLOCK_ID)).toBe(false);
    });

    it('keeps a planned step in its own block, so it never takes on another block\'s warm-up role or choices', () => {
        expect(applyStepMove(base, { stepId: 'squat', targetStepId: 'w1', position: 'after' })).toBe(base);
        expect(applyStepMove(base, { stepId: 'curl', targetStepId: 'row', position: 'after' })).toBe(base);
    });

    it('never moves an added exercise into a warm-up block', () => {
        const { blocks, addedId } = withAdded();
        expect(applyStepMove(blocks, { stepId: addedId, targetStepId: 'w1', position: 'after' })).toBe(blocks);
    });

    it('refuses moves into or out of a superset, onto itself, or for unknown steps', () => {
        const { blocks, addedId } = withAdded();
        expect(applyStepMove(blocks, { stepId: addedId, targetStepId: 'a', position: 'after' })).toBe(blocks);
        expect(applyStepMove(base, { stepId: 'a', targetStepId: 'b', position: 'after' })).toBe(base);
        expect(applyStepMove(base, { stepId: 'squat', targetStepId: 'squat', position: 'after' })).toBe(base);
        expect(applyStepMove(base, { stepId: 'gone', targetStepId: 'squat', position: 'after' })).toBe(base);
    });

    it('replays moves in order and skips ones that no longer apply', () => {
        const moved = applyStepMoves(base, [
            { stepId: 'row', targetStepId: 'squat', position: 'before' },
            { stepId: 'added-lost', targetStepId: 'bench', position: 'after' },
            { stepId: 'w1', targetStepId: 'bench', position: 'after' },
        ]);
        expect(ids(moved)).toEqual(['warmup:w1', 'main:row,squat,bench', 'accessory:curl', 'ss:a,b']);
    });
});

describe('adjacentStepMove', () => {
    it('moves a planned step one place within its block and stops at the block edge', () => {
        expect(adjacentStepMove(base, 'bench', 'earlier')).toEqual({ stepId: 'bench', targetStepId: 'squat', position: 'before' });
        expect(adjacentStepMove(base, 'bench', 'later')).toEqual({ stepId: 'bench', targetStepId: 'row', position: 'after' });
        expect(adjacentStepMove(base, 'squat', 'earlier')).toBeNull();
        expect(adjacentStepMove(base, 'row', 'later')).toBeNull();
    });

    it('moves an added exercise across block edges one place at a time, skipping warm-up and supersets', () => {
        const { blocks, addedId } = withAdded();
        const intoAccessory = adjacentStepMove(blocks, addedId, 'earlier');
        expect(intoAccessory).toEqual({ stepId: addedId, targetStepId: 'curl', position: 'after' });
        const afterFirst = applyStepMove(blocks, intoAccessory!);
        expect(ids(afterFirst)).toEqual(['warmup:w1', 'main:squat,bench,row', `accessory:curl,${addedId}`, 'ss:a,b']);
        const second = applyStepMove(afterFirst, adjacentStepMove(afterFirst, addedId, 'earlier')!);
        expect(ids(second)).toEqual(['warmup:w1', 'main:squat,bench,row', `accessory:${addedId},curl`, 'ss:a,b']);
        const third = applyStepMove(second, adjacentStepMove(second, addedId, 'earlier')!);
        expect(ids(third)).toEqual(['warmup:w1', `main:squat,bench,row,${addedId}`, 'accessory:curl', 'ss:a,b']);

        const atTop = applyStepMoves(third, [{ stepId: addedId, targetStepId: 'squat', position: 'before' }]);
        expect(adjacentStepMove(atTop, addedId, 'earlier')).toBeNull();
    });

    it('returns null for superset steps and unknown steps', () => {
        expect(adjacentStepMove(base, 'a', 'later')).toBeNull();
        expect(adjacentStepMove(base, 'nope', 'later')).toBeNull();
    });
});
