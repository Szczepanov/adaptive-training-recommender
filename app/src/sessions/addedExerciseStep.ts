import type { SessionBlock, SessionDefinition, SessionEntry, SessionStep } from './models';
import { exerciseRefName } from './stepDisplay';
import type { StepExerciseReplacement } from './swapAdaptation';

/** Block that holds exercises the athlete adds during a structured session. */
export const ADDED_EXERCISES_BLOCK_ID = 'added-during-session';
/** Prefix of every added step id; the summary reports such work as unplanned. */
const ADDED_STEP_ID_PREFIX = 'added-';

/**
 * Appends an exercise the athlete performed beyond the plan (e.g. back extensions) to a
 * trailing "Added exercises" block, creating that block on first use. The step is optional
 * so it can never turn the planned session into a "missed step", and its logged sets keep
 * the normal step-scoped entry path.
 */
export function appendAddedExerciseStep(
    blocks: readonly SessionBlock[],
    exercise: StepExerciseReplacement,
    uniqueId: string,
): { blocks: SessionBlock[]; blockIndex: number; stepIndex: number } {
    const step: SessionStep = {
        id: `${ADDED_STEP_ID_PREFIX}${uniqueId}`,
        kind: 'exercise',
        optional: true,
        exerciseRef: exercise.exerciseRef,
        ...(exercise.title ? { title: exercise.title } : {}),
        ...(exercise.dose ? { dose: exercise.dose } : {}),
        ...(exercise.load ? { load: exercise.load } : {}),
        ...(exercise.laterality ? { laterality: exercise.laterality } : {}),
        ...(exercise.tempo ? { tempo: exercise.tempo } : {}),
        ...(exercise.notes ? { notes: exercise.notes } : {}),
        ...(exercise.compositionPatterns ? { compositionPatterns: exercise.compositionPatterns } : {}),
    };
    return appendStep(blocks, step);
}

function appendStep(
    blocks: readonly SessionBlock[],
    step: SessionStep,
): { blocks: SessionBlock[]; blockIndex: number; stepIndex: number } {
    const existingIndex = blocks.findIndex(block => block.id === ADDED_EXERCISES_BLOCK_ID);
    if (existingIndex === -1) {
        const block: SessionBlock = {
            id: ADDED_EXERCISES_BLOCK_ID,
            title: 'Added exercises',
            role: 'accessory',
            executionMode: 'sequential',
            steps: [step],
        };
        return { blocks: [...blocks, block], blockIndex: blocks.length, stepIndex: 0 };
    }
    const existing = blocks[existingIndex];
    const updated: SessionBlock = { ...existing, steps: [...existing.steps, step] };
    return {
        blocks: blocks.map((block, index) => (index === existingIndex ? updated : block)),
        blockIndex: existingIndex,
        stepIndex: existing.steps.length,
    };
}

/**
 * Added exercises live only in the runner's working definition, so a reload (which resolves
 * the saved prescription) would hide them while their logged sets remain. Rebuild one added
 * step per unknown `added-` step id from those sets, in the order they were first logged.
 */
export function restoreAddedExerciseSteps(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
): SessionDefinition {
    const known = new Set(definition.blocks.flatMap(block => block.steps.map(step => step.id)));
    const firstEntryByStep = new Map<string, SessionEntry>();
    const ordered = [...entries].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
    for (const entry of ordered) {
        const stepId = entry.stepId;
        if (!stepId?.startsWith(ADDED_STEP_ID_PREFIX) || known.has(stepId) || firstEntryByStep.has(stepId)) continue;
        if (entry.payload.kind === 'choice') continue;
        firstEntryByStep.set(stepId, entry);
    }
    if (firstEntryByStep.size === 0) return definition;
    let blocks: SessionBlock[] = [...definition.blocks];
    for (const [stepId, entry] of firstEntryByStep) {
        blocks = appendStep(blocks, restoredStep(stepId, entry)).blocks;
    }
    return { ...definition, blocks };
}

function restoredStep(stepId: string, entry: SessionEntry): SessionStep {
    const payload = entry.payload;
    const dose: SessionStep['dose'] = payload.kind === 'distance'
        ? { kind: 'distance', sets: 1, meters: payload.meters }
        : payload.kind === 'duration'
            ? { kind: 'duration', sets: 1, seconds: payload.seconds }
            : undefined;
    return {
        id: stepId,
        kind: 'exercise',
        optional: true,
        ...(entry.exerciseRef ? { exerciseRef: entry.exerciseRef, title: exerciseRefName(entry.exerciseRef) } : {}),
        ...(dose ? { dose } : {}),
        ...(entry.side === 'left' || entry.side === 'right' ? { laterality: 'per_side' as const } : {}),
    };
}
