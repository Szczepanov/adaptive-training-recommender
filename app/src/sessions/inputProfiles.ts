import type { SessionStep } from './models';

export type InputProfileKind =
    | 'repetition_mass'
    | 'repetition_bodyweight'
    | 'duration_hold'
    | 'distance_split'
    | 'checkoff';

export function resolveStepInputProfile(step: SessionStep): InputProfileKind {
    if (step.dose?.kind === 'duration') {
        return 'duration_hold';
    }
    if (step.dose?.kind === 'distance') {
        return 'distance_split';
    }
    if (step.dose?.kind === 'checkoff' || step.kind === 'transition') {
        return 'checkoff';
    }
    // Default to repetition
    if (step.load?.kind === 'bodyweight' || step.load?.kind === 'unloaded') {
        return 'repetition_bodyweight';
    }
    return 'repetition_mass';
}
