import { ADDED_EXERCISES_BLOCK_ID, isAddedStep } from './addedExerciseStep';
import type { SessionBlock } from './models';

/**
 * Athlete-chosen order of steps during a session (e.g. an exercise added mid-session that
 * belongs right after the back squat). A move changes only the runner's working order -- the
 * saved prescription is never rewritten, and the order actually performed is already recorded
 * by each entry's `completedAt`.
 *
 * Only steps of `sequential` blocks move: a superset or circuit rotates through its steps as a
 * group, so pulling one out (or dropping a step into one) would change how that group runs.
 *
 * A planned step moves only within its own block. Some behaviour belongs to the block rather
 * than the step -- the warm-up role (sets default to warm-up, no fallback rest) and authored
 * choices, which are scoped to the block's `optionSets` -- so moving a planned step into
 * another block would silently change how it is logged. An exercise the athlete added carries
 * no such block-scoped prescription and may move between blocks, but never into a warm-up.
 */
export interface StepMove {
    stepId: string;
    targetStepId: string;
    position: 'before' | 'after';
}

export interface StepLocation {
    blockIndex: number;
    stepIndex: number;
}

export function isReorderableBlock(block: SessionBlock | undefined): boolean {
    return block?.executionMode === 'sequential';
}

/** Whether `stepId` may sit in `targetBlock`, given the block it is in now. */
function canEnterBlock(blocks: readonly SessionBlock[], from: StepLocation, targetBlockIndex: number): boolean {
    const target = blocks[targetBlockIndex];
    if (!isReorderableBlock(target)) return false;
    if (targetBlockIndex === from.blockIndex) return true;
    return isAddedStep(blocks[from.blockIndex].steps[from.stepIndex]) && target.role !== 'warmup';
}

export function locateStep(blocks: readonly SessionBlock[], stepId: string): StepLocation | null {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const stepIndex = blocks[blockIndex].steps.findIndex(step => step.id === stepId);
        if (stepIndex !== -1) return { blockIndex, stepIndex };
    }
    return null;
}

/** Applies one move; returns the same array when the move is invalid or a no-op. */
export function applyStepMove(blocks: SessionBlock[], move: StepMove): SessionBlock[] {
    if (move.stepId === move.targetStepId) return blocks;
    const from = locateStep(blocks, move.stepId);
    const to = locateStep(blocks, move.targetStepId);
    if (!from || !to) return blocks;
    if (!isReorderableBlock(blocks[from.blockIndex]) || !canEnterBlock(blocks, from, to.blockIndex)) return blocks;

    const moving = blocks[from.blockIndex].steps[from.stepIndex];
    const withoutMoving = blocks.map((block, index) => (index === from.blockIndex
        ? { ...block, steps: block.steps.filter(step => step.id !== move.stepId) }
        : block));
    const targetBlockIndex = to.blockIndex;
    const targetBlock = withoutMoving[targetBlockIndex];
    const targetIndex = targetBlock.steps.findIndex(step => step.id === move.targetStepId);
    const insertAt = move.position === 'before' ? targetIndex : targetIndex + 1;
    const moved = withoutMoving.map((block, index) => (index === targetBlockIndex
        ? { ...block, steps: [...block.steps.slice(0, insertAt), moving, ...block.steps.slice(insertAt)] }
        : block));
    // The trailing "Added exercises" block exists only to hold added steps; once they have all
    // been placed elsewhere it would render as an empty group.
    return moved.filter(block => block.id !== ADDED_EXERCISES_BLOCK_ID || block.steps.length > 0);
}

/** Replays recorded moves in order, skipping any that no longer apply (e.g. an unlogged added step lost on reload). */
export function applyStepMoves(blocks: SessionBlock[], moves: readonly StepMove[]): SessionBlock[] {
    return moves.reduce((current, move) => applyStepMove(current, move), blocks);
}

/**
 * The move that shifts a step one place earlier or later in the overall order, crossing into
 * the neighbouring block at a block edge when the step may enter it (see `canEnterBlock`);
 * blocks it may not enter are stepped over.
 * Returns null at either end of the reorderable order or for a step that cannot move.
 */
export function adjacentStepMove(
    blocks: readonly SessionBlock[],
    stepId: string,
    direction: 'earlier' | 'later',
): StepMove | null {
    const from = locateStep(blocks, stepId);
    if (!from || !isReorderableBlock(blocks[from.blockIndex])) return null;
    const order = blocks.flatMap((block, blockIndex) => (canEnterBlock(blocks, from, blockIndex)
        ? block.steps.map(step => ({ id: step.id, blockId: block.id }))
        : []));
    const index = order.findIndex(item => item.id === stepId);
    if (index === -1) return null;
    const neighbour = order[direction === 'earlier' ? index - 1 : index + 1];
    if (neighbour === undefined) return null;
    // Within a block, swap past the neighbour. At a block edge, join the neighbouring block at
    // its near end -- that is exactly one place earlier/later in the overall order.
    const sameBlock = neighbour.blockId === order[index].blockId;
    const position = direction === 'earlier'
        ? (sameBlock ? 'before' : 'after')
        : (sameBlock ? 'after' : 'before');
    return { stepId, targetStepId: neighbour.id, position };
}
