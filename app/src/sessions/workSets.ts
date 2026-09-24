import type { SessionEntry } from './models';

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
