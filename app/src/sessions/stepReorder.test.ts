import { describe, expect, it } from 'vitest';
import { ADDED_EXERCISES_BLOCK_ID, appendAddedExerciseStep } from './addedExerciseStep';
import type { SessionBlock, SessionStep } from './models';
import { adjacentStepMove, applyStepLayout, applyStepMove, canApplyStepMove, layoutOf } from './stepReorder';

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

    it('returns the same blocks when a step is dropped back where it already is', () => {
        expect(applyStepMove(base, { stepId: 'bench', targetStepId: 'squat', position: 'after' })).toBe(base);
        expect(applyStepMove(base, { stepId: 'bench', targetStepId: 'row', position: 'before' })).toBe(base);
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
        // Every press passes exactly one neighbour, so the visible order always changes.
        const first = adjacentStepMove(blocks, addedId, 'earlier');
        expect(first).toEqual({ stepId: addedId, targetStepId: 'curl', position: 'before' });
        const afterFirst = applyStepMove(blocks, first!);
        expect(ids(afterFirst)).toEqual(['warmup:w1', 'main:squat,bench,row', `accessory:${addedId},curl`, 'ss:a,b']);
        const second = applyStepMove(afterFirst, adjacentStepMove(afterFirst, addedId, 'earlier')!);
        expect(ids(second)).toEqual(['warmup:w1', `main:squat,bench,${addedId},row`, 'accessory:curl', 'ss:a,b']);
        const back = applyStepMove(second, adjacentStepMove(second, addedId, 'later')!);
        expect(ids(back)).toEqual(['warmup:w1', `main:squat,bench,row,${addedId}`, 'accessory:curl', 'ss:a,b']);

        const atTop = applyStepMove(second, { stepId: addedId, targetStepId: 'squat', position: 'before' });
        expect(adjacentStepMove(atTop, addedId, 'earlier')).toBeNull();
    });

    it('returns null for superset steps and unknown steps', () => {
        expect(adjacentStepMove(base, 'a', 'later')).toBeNull();
        expect(adjacentStepMove(base, 'nope', 'later')).toBeNull();
    });
});

describe('applyStepLayout', () => {
    it('keeps a reorder of surviving steps when an unlogged added step is gone', () => {
        // [A,C,B]; add X after A; move B before X -> saved [A,B,X,C]. Reload without X logged.
        const planned = [block('main', ['A', 'C', 'B'])];
        const layout = [{ blockId: 'main', stepIds: ['A', 'B', 'added-X', 'C'] }];
        expect(ids(applyStepLayout(planned, layout))).toEqual(['main:A,B,C']);
    });

    it('restores added-step order independently of the order they were logged in', () => {
        // Rebuilt from logging order [Y,X,Z]; the athlete had ordered them [X,Z,Y].
        const rebuilt = [block('main', ['squat']), block(ADDED_EXERCISES_BLOCK_ID, ['added-Y', 'added-X', 'added-Z'], 'accessory')];
        const layout = layoutOf([block('main', ['squat']), block(ADDED_EXERCISES_BLOCK_ID, ['added-X', 'added-Z', 'added-Y'], 'accessory')]);
        expect(ids(applyStepLayout(rebuilt, layout))).toEqual(['main:squat', `${ADDED_EXERCISES_BLOCK_ID}:added-X,added-Z,added-Y`]);
    });

    it('places an added step into the main block and drops the emptied added block', () => {
        const rebuilt = [block('main', ['squat', 'bench']), block(ADDED_EXERCISES_BLOCK_ID, ['added-X'], 'accessory')];
        const layout = [{ blockId: 'main', stepIds: ['squat', 'added-X', 'bench'] }];
        expect(ids(applyStepLayout(rebuilt, layout))).toEqual(['main:squat,added-X,bench']);
    });

    it('never applies a stale or tampered layout that breaks the block rules', () => {
        const layout = [
            { blockId: 'warmup', stepIds: ['w1', 'squat'] },
            { blockId: 'main', stepIds: ['row', 'bench'] },
            { blockId: 'ss', stepIds: ['b', 'a'] },
        ];
        // squat stays in main (planned steps never change block); main keeps the layout order
        // for the steps it names, then the rest; the superset is never reordered.
        expect(ids(applyStepLayout(base, layout))).toEqual(['warmup:w1', 'main:row,bench,squat', 'accessory:curl', 'ss:a,b']);
    });

    it('leaves the authored order when there is no saved layout', () => {
        expect(ids(applyStepLayout(base, []))).toEqual(ids(base));
    });
});

describe('canApplyStepMove', () => {
    it('allows only drops the block rules accept', () => {
        const { blocks, addedId } = withAdded();
        expect(canApplyStepMove(base, { stepId: 'row', targetStepId: 'squat', position: 'after' })).toBe(true);
        expect(canApplyStepMove(base, { stepId: 'squat', targetStepId: 'curl', position: 'before' })).toBe(false);
        expect(canApplyStepMove(blocks, { stepId: addedId, targetStepId: 'curl', position: 'before' })).toBe(true);
        expect(canApplyStepMove(blocks, { stepId: addedId, targetStepId: 'w1', position: 'after' })).toBe(false);
        expect(canApplyStepMove(blocks, { stepId: addedId, targetStepId: 'a', position: 'after' })).toBe(false);
    });

    it('checks the side under the pointer: after the reference is fine, before it is not', () => {
        const appended = appendAddedExerciseStep([block('main', ['A', 'B'])], {
            exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' }, load: { kind: 'relative_step', stepId: 'A', percent: 90 },
        }, 'x');
        const addedId = appended.blocks[appended.blockIndex].steps[0].id;
        expect(canApplyStepMove(appended.blocks, { stepId: addedId, targetStepId: 'A', position: 'after' })).toBe(true);
        expect(canApplyStepMove(appended.blocks, { stepId: addedId, targetStepId: 'A', position: 'before' })).toBe(false);
    });
});

describe('restore and move edge cases', () => {
    it('ignores a duplicate id in a saved layout without reordering', () => {
        const planned = [block('main', ['A', 'B'])];
        expect(ids(applyStepLayout(planned, [{ blockId: 'main', stepIds: ['A', 'B', 'A'] }]))).toEqual(['main:A,B']);
    });

    it('keeps block and step ids apart when restoring', () => {
        const blocks = [block('main', ['a:b', 'c']), block('main:a', ['b'])];
        const layout = [{ blockId: 'main', stepIds: ['a:b', 'c'] }, { blockId: 'main:a', stepIds: ['x', 'y', 'b'] }];
        expect(ids(applyStepLayout(blocks, layout))).toEqual(['main:a:b,c', 'main:a:b']);
    });

    it('refuses a move that puts a relative-load step before its reference', () => {
        const relative: SessionBlock = {
            id: 'main', title: 'main', role: 'main', executionMode: 'sequential',
            steps: [step('A'), { ...step('B'), load: { kind: 'relative_step', stepId: 'A', percent: 90 } }],
        };
        const blocks = [relative];
        expect(applyStepMove(blocks, { stepId: 'B', targetStepId: 'A', position: 'before' })).toBe(blocks);
        expect(applyStepMove(blocks, { stepId: 'A', targetStepId: 'B', position: 'after' })).toBe(blocks);
        // ...and Earlier/Later are not offered for it in the first place.
        expect(adjacentStepMove(blocks, 'B', 'earlier')).toBeNull();
        expect(adjacentStepMove(blocks, 'A', 'later')).toBeNull();
    });
});

describe('relative-load references written as numbers', () => {
    it('compare like the validator (String), so they do not block every move', () => {
        const blocks: SessionBlock[] = [{
            id: 'main', title: 'main', role: 'main', executionMode: 'sequential',
            steps: [step('1'), { ...step('B'), load: { kind: 'relative_step', stepId: 1 as unknown as string, percent: 90 } }, step('C'), step('D')],
        }];
        expect(applyStepMove(blocks, { stepId: 'D', targetStepId: 'C', position: 'before' })).not.toBe(blocks);
        expect(applyStepMove(blocks, { stepId: 'B', targetStepId: '1', position: 'before' })).toBe(blocks);
    });
});
