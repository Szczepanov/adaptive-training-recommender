import type { RangeOrNumber, SessionBlock, SessionEntry, SessionStep } from './models';

/** Execution modes whose steps are performed in a repeating rotation. */
export type RotatingExecutionMode = 'circuit' | 'superset' | 'alternating';

export interface GroupProgressState {
    mode: RotatingExecutionMode;
    /** Completed whole rotations across all required steps. */
    completedRounds: number;
    /** The prescribed number of rotations, derived from block rounds or step doses. */
    totalRounds: number;
    isComplete: boolean;
    /** The next incomplete required movement after the active movement, wrapping within the group. */
    nextStepIndex: number | null;
}

function maximum(value: RangeOrNumber): number {
    return typeof value === 'number' ? value : value.max;
}

export function isRotatingExecutionMode(mode: SessionBlock['executionMode']): mode is RotatingExecutionMode {
    return mode === 'circuit' || mode === 'superset' || mode === 'alternating';
}

/**
 * One entry represents one performed set/round of a step.  A block-level round
 * declaration is authoritative for a rotating block; otherwise the step dose
 * supplies the number of turns in the rotation.
 */
export function targetEntriesForGroupStep(block: SessionBlock, step: SessionStep): number {
    if (block.rounds !== undefined) return maximum(block.rounds);

    if (step.dose?.kind === 'repetition') return step.dose.sets;
    if (step.dose?.kind === 'duration' || step.dose?.kind === 'distance') return step.dose.sets ?? 1;
    if (step.dose?.kind === 'checkoff') return step.dose.rounds ?? 1;
    return 1;
}

function requiredSteps(block: SessionBlock): Array<{ step: SessionStep; index: number }> {
    const required = block.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !step.optional);

    // An all-optional accessory group is still executable when the athlete chooses it.
    return required.length > 0 ? required : block.steps.map((step, index) => ({ step, index }));
}

function entryCount(entries: readonly SessionEntry[], stepId: string): number {
    return entries.reduce((count, entry) => count + (entry.stepId === stepId ? 1 : 0), 0);
}

function firstAfter(indices: readonly number[], afterIndex: number): number {
    return indices.find(index => index > afterIndex) ?? indices[0];
}

/**
 * Returns rotation state from persisted entries only.  It deliberately does not
 * mutate, infer skipped work, or decide whether an optional movement is required.
 */
export function getGroupProgress(
    block: SessionBlock,
    entries: readonly SessionEntry[],
    activeStepIndex: number,
): GroupProgressState | null {
    if (!isRotatingExecutionMode(block.executionMode) || block.steps.length === 0) return null;

    const steps = requiredSteps(block);
    const states = steps.map(({ step, index }) => ({
        index,
        completed: entryCount(entries, step.id),
        target: targetEntriesForGroupStep(block, step),
    }));
    const totalRounds = Math.max(...states.map(state => state.target));
    const completedRounds = Math.min(...states.map(state => Math.min(state.completed, state.target)));
    const incomplete = states.filter(state => state.completed < state.target);

    if (incomplete.length === 0) {
        return { mode: block.executionMode, completedRounds, totalRounds, isComplete: true, nextStepIndex: null };
    }

    // Keep the rotation balanced: the least-completed movement is due next.  If
    // several are tied, follow the authored order after the movement just logged.
    const leastCompleted = Math.min(...incomplete.map(state => state.completed));
    const candidates = incomplete
        .filter(state => state.completed === leastCompleted)
        .map(state => state.index);

    return {
        mode: block.executionMode,
        completedRounds,
        totalRounds,
        isComplete: false,
        nextStepIndex: firstAfter(candidates, activeStepIndex),
    };
}
