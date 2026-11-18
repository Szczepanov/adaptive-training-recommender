import { restoreAddedExerciseSteps } from './addedExerciseStep';
import type { SessionDefinition, SessionEntry } from './models';
import { loadStepMoves } from './stepOrderStorage';
import { applyStepMoves, type StepMove } from './stepReorder';

/**
 * The runner's working definition after a reload: added steps rebuilt from their logged sets,
 * then the athlete's remembered step moves replayed on top. The resume cursor must be resolved
 * against this result, not the saved prescription, so it points at the same step the athlete saw.
 */
export function restoreWorkingDefinition(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
    executionId: string,
): { definition: SessionDefinition; moves: StepMove[] } {
    const withAdded = restoreAddedExerciseSteps(definition, entries);
    const moves = loadStepMoves(executionId);
    return { definition: { ...withAdded, blocks: applyStepMoves(withAdded.blocks, moves) }, moves };
}
