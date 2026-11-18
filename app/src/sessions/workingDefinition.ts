import { restoreAddedExerciseSteps } from './addedExerciseStep';
import type { SessionDefinition, SessionEntry } from './models';
import { loadStepLayout } from './stepOrderStorage';
import { applyStepLayout } from './stepReorder';

/**
 * The runner's working definition after a reload: added steps rebuilt from their logged sets,
 * then the athlete's saved step order applied on top. The resume cursor must be resolved
 * against this result, not the saved prescription, so it points at the same step the athlete saw.
 */
export function restoreWorkingDefinition(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
    executionId: string,
): SessionDefinition {
    const withAdded = restoreAddedExerciseSteps(definition, entries);
    return { ...withAdded, blocks: applyStepLayout(withAdded.blocks, loadStepLayout(executionId)) };
}
