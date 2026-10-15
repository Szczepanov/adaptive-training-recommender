import type { SessionDefinition, SessionEntry } from './models';
import { resolveEffectiveSession } from './choiceResolution';
import { getGroupProgress, isRotatingExecutionMode, targetEntriesForGroupStep } from './groupProgression';
import { completedPrescribedSets, countsTowardPrescribedSets } from './workSets';

export interface SessionProgressCursor {
    blockIndex: number;
    stepIndex: number;
    sessionEnded: boolean;
    requiredWorkComplete: boolean;
}

/**
 * Rebuilds the logical runner cursor only from immutable prescription bytes plus
 * performed diary evidence. It is deliberately pure so live and resumed flows can
 * share the same interpretation without inventing progress from UI state.
 */
export function projectSessionProgress(
    rawDefinition: SessionDefinition,
    entries: readonly SessionEntry[],
    knownCursor?: Pick<SessionProgressCursor, 'blockIndex' | 'stepIndex'>,
): SessionProgressCursor {
    const effective = resolveEffectiveSession(rawDefinition, entries);
    const definition = effective.definition;
    if (effective.sessionEnded) {
        const lastBlockIndex = Math.max(0, definition.blocks.length - 1);
        const lastBlock = definition.blocks[lastBlockIndex];
        return {
            blockIndex: lastBlockIndex,
            stepIndex: Math.max(0, (lastBlock?.steps.length ?? 1) - 1),
            sessionEnded: true,
            requiredWorkComplete: true,
        };
    }

    // Live manual navigation is known evidence of the athlete's chosen work. Resume
    // omits this cursor: an unlogged optional selection cannot be recovered truthfully.
    const knownBlock = knownCursor ? definition.blocks[knownCursor.blockIndex] : undefined;
    const knownStep = knownCursor ? knownBlock?.steps[knownCursor.stepIndex] : undefined;
    if (knownCursor && knownBlock && !effective.endedBlockIds.has(knownBlock.id)) {
        const progress = getGroupProgress(knownBlock, entries, knownCursor.stepIndex);
        if (progress && !progress.isComplete && progress.nextStepIndex !== null) {
            return { blockIndex: knownCursor.blockIndex, stepIndex: progress.nextStepIndex, sessionEnded: false, requiredWorkComplete: false };
        }
    }
    if (knownCursor && knownBlock && knownStep && !effective.endedBlockIds.has(knownBlock.id)
        && !isRotatingExecutionMode(knownBlock.executionMode)
        && completedPrescribedSets(knownStep, entries) < targetEntriesForGroupStep(knownBlock, knownStep)) {
        return { ...knownCursor, sessionEnded: false, requiredWorkComplete: false };
    }

    for (let blockIndex = 0; blockIndex < definition.blocks.length; blockIndex++) {
        const block = definition.blocks[blockIndex];
        if (block.steps.length === 0 || effective.endedBlockIds.has(block.id)
            || !block.steps.some(step => !step.optional)) continue;
        if (isRotatingExecutionMode(block.executionMode)) {
            const lastEntry = entries.filter(entry => block.steps.some(step => step.id === entry.stepId)
                && countsTowardPrescribedSets(entry)).at(-1);
            const lastStepIndex = block.steps.findIndex(step => step.id === lastEntry?.stepId);
            const progress = getGroupProgress(block, entries, lastStepIndex);
            if (progress && !progress.isComplete) {
                return { blockIndex, stepIndex: progress.nextStepIndex ?? 0, sessionEnded: false, requiredWorkComplete: false };
            }
            continue;
        }

        const required = block.steps
            .map((step, stepIndex) => ({ step, stepIndex }))
            .filter(({ step }) => !step.optional);
        for (const { step, stepIndex } of required) {
            const target = targetEntriesForGroupStep(block, step);
            if (target > 0 && completedPrescribedSets(step, entries) < target) {
                return { blockIndex, stepIndex, sessionEnded: false, requiredWorkComplete: false };
            }
        }
    }

    const lastBlockIndex = Math.max(0, definition.blocks.length - 1);
    const lastBlock = definition.blocks[lastBlockIndex];
    return {
        blockIndex: lastBlockIndex,
        stepIndex: Math.max(0, (lastBlock?.steps.length ?? 1) - 1),
        sessionEnded: false,
        requiredWorkComplete: true,
    };
}

/**
 * The step to open after a reload (#723). The last-touched step is preferred when it is
 * still unfinished sequential work, so the athlete lands where they stopped rather than on an
 * earlier required step they deliberately skipped past. "Touched" is persisted performed work
 * only (warm-ups and choice records are not); an unlogged selection is never invented. Rotating
 * groups, ended blocks and an ended session keep `projectSessionProgress` authority, which
 * also supplies the first-incomplete fallback when nothing unfinished was touched.
 */
export function resolveResumeCursor(
    rawDefinition: SessionDefinition,
    allEntries: readonly SessionEntry[],
): SessionProgressCursor {
    // Tombstoned entries are not performed work: one filter feeds the cursor, the last-touched
    // scan and every completion count so they cannot disagree.
    const entries = allEntries.filter(entry => !entry.deletedAt);
    const base = projectSessionProgress(rawDefinition, entries);
    if (base.sessionEnded) return base;

    const effective = resolveEffectiveSession(rawDefinition, entries);
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (!countsTowardPrescribedSets(entry)) continue;
        const blockIndex = effective.definition.blocks.findIndex(block => block.steps.some(step => step.id === entry.stepId));
        const block = effective.definition.blocks[blockIndex];
        if (!block || effective.endedBlockIds.has(block.id) || isRotatingExecutionMode(block.executionMode)) return base;
        const stepIndex = block.steps.findIndex(step => step.id === entry.stepId);
        const step = block.steps[stepIndex];
        // An omit_step choice marks the step optional rather than removing it; a step the
        // athlete dropped must not be reopened (end_block/end_session are handled above).
        const rawStep = rawDefinition.blocks.flatMap(rawBlock => rawBlock.steps).find(candidate => candidate.id === step.id);
        if (step.optional && !rawStep?.optional) return base;
        if (completedPrescribedSets(step, entries) >= targetEntriesForGroupStep(block, step)) return base;
        return { blockIndex, stepIndex, sessionEnded: false, requiredWorkComplete: base.requiredWorkComplete };
    }
    return base;
}
