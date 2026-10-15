import type { SessionBlock, SessionStep } from './models';
import { targetEntriesForGroupStep } from './groupProgression';

export interface StepNavigatorProgress {
    /** Always present, including "0/3 sets" for work not yet started. */
    progressText: string;
    requirement: 'required' | 'optional';
    complete: boolean;
}

function unitFor(step: SessionStep, target: number): string {
    const kind = step.dose?.kind;
    if (kind === 'checkoff') return target === 1 ? 'check-off' : 'rounds';
    if (kind === 'repetition' || kind === 'duration' || kind === 'distance') return target === 1 ? 'set' : 'sets';
    return 'done';
}

/**
 * Display facts for one authored step in the workout navigator. Pure: the target comes from the
 * same resolver the runner and completion summary use, and nothing is inferred from UI state.
 */
export function describeStepNavigatorProgress(
    block: SessionBlock,
    step: SessionStep,
    completedSets: number,
): StepNavigatorProgress {
    const target = targetEntriesForGroupStep(block, step);
    return {
        progressText: `${completedSets}/${target} ${unitFor(step, target)}`,
        requirement: step.optional ? 'optional' : 'required',
        complete: completedSets >= target,
    };
}
