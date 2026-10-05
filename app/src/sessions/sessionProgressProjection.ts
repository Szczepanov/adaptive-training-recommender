import type { SessionDefinition, SessionEntry, SessionStep } from './models';
import { resolveEffectiveSession } from './choiceResolution';
import { getGroupProgress, isRotatingExecutionMode } from './groupProgression';
import { completedPrescribedSets } from './workSets';

export interface SessionProgressCursor {
    blockIndex: number;
    stepIndex: number;
    sessionEnded: boolean;
}

function targetEntriesForStep(step: SessionStep): number {
    if (step.dose?.kind === 'repetition') return step.dose.sets;
    if (step.dose?.kind === 'duration' || step.dose?.kind === 'distance') return step.dose.sets ?? 1;
    if (step.dose?.kind === 'checkoff') return step.dose.rounds ?? 1;
    return step.kind === 'exercise' ? 1 : 0;
}

/**
 * Rebuilds the logical runner cursor only from immutable prescription bytes plus
 * performed diary evidence. It is deliberately pure so live and resumed flows can
 * share the same interpretation without inventing progress from UI state.
 */
export function projectSessionProgress(
    rawDefinition: SessionDefinition,
    entries: readonly SessionEntry[],
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
        };
    }

    for (let blockIndex = 0; blockIndex < definition.blocks.length; blockIndex++) {
        const block = definition.blocks[blockIndex];
        if (block.steps.length === 0) continue;
        if (isRotatingExecutionMode(block.executionMode)) {
            const progress = getGroupProgress(block, entries, -1);
            if (progress && !progress.isComplete) {
                return { blockIndex, stepIndex: progress.nextStepIndex ?? 0, sessionEnded: false };
            }
            continue;
        }

        const required = block.steps
            .map((step, stepIndex) => ({ step, stepIndex }))
            .filter(({ step }) => !step.optional);
        const candidates = required.length > 0
            ? required
            : block.steps.map((step, stepIndex) => ({ step, stepIndex }));
        for (const { step, stepIndex } of candidates) {
            const target = targetEntriesForStep(step);
            if (target > 0 && completedPrescribedSets(step, entries) < target) {
                return { blockIndex, stepIndex, sessionEnded: false };
            }
        }
    }

    const lastBlockIndex = Math.max(0, definition.blocks.length - 1);
    const lastBlock = definition.blocks[lastBlockIndex];
    return {
        blockIndex: lastBlockIndex,
        stepIndex: Math.max(0, (lastBlock?.steps.length ?? 1) - 1),
        sessionEnded: false,
    };
}
