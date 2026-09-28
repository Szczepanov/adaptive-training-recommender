import type { SessionEntry, SessionStep } from './models';

/**
 * ADR-0021 D-SETLOG: a warm-up set is recorded, flagged and retained -- it is genuine
 * performed work -- but it is not one of the prescribed work sets. Only a repetition entry
 * carries the flag today.
 */
export function isWarmupEntry(entry: Pick<SessionEntry, 'payload'>): boolean {
    return entry.payload.kind === 'repetition' && entry.payload.isWarmup === true;
}

/**
 * Whether an entry counts toward a step's prescribed sets/rounds. A recorded athlete choice
 * (D-MCHOICE) shares a step's entries subcollection but is not performed work, and a warm-up
 * set is performed work that is not a prescribed set. Every set/round completion counter --
 * the planned-vs-performed comparison and the runner's in-session progress -- shares this
 * predicate so they cannot disagree about when a step is done.
 */
export function countsTowardPrescribedSets(entry: Pick<SessionEntry, 'payload'>): boolean {
    return entry.payload.kind !== 'choice' && !isWarmupEntry(entry);
}

/** A left/right hold is one set only once both sides have been logged. */
export function completedPrescribedSets(step: SessionStep, entries: readonly SessionEntry[]): number {
    const work = entries.filter(entry => entry.stepId === step.id && countsTowardPrescribedSets(entry));
    if (step.dose?.kind !== 'duration' || step.laterality !== 'per_side') return work.length;
    const holds = work.filter(entry => entry.payload.kind === 'duration');
    const left = holds.filter(entry => entry.side === 'left').length;
    const right = holds.filter(entry => entry.side === 'right').length;
    return work.length - left - right + Math.min(left, right);
}

export function nextHoldSide(step: SessionStep, entries: readonly SessionEntry[]): 'left' | 'right' {
    const holds = entries.filter(entry => entry.stepId === step.id && entry.payload.kind === 'duration');
    return holds.filter(entry => entry.side === 'left').length <= holds.filter(entry => entry.side === 'right').length
        ? 'left' : 'right';
}

export function hasUnpairedHoldSide(step: SessionStep, entries: readonly SessionEntry[]): boolean {
    if (step.dose?.kind !== 'duration' || step.laterality !== 'per_side') return false;
    const holds = entries.filter(entry => entry.stepId === step.id && entry.payload.kind === 'duration');
    return holds.filter(entry => entry.side === 'left').length !== holds.filter(entry => entry.side === 'right').length;
}

export function completesPrescribedSet(step: SessionStep, entries: readonly SessionEntry[], entry: SessionEntry): boolean {
    return completedPrescribedSets(step, [...entries, entry]) > completedPrescribedSets(step, entries);
}
