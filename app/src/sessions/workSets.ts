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

/**
 * Timed holds and distance carries prescribed per side are logged one side at a time, and a
 * left/right pair is one set. (A per-side rep step is logged as one entry per set.)
 */
function sidedPayloadKind(step: SessionStep): 'duration' | 'distance' | null {
    if (step.laterality !== 'per_side') return null;
    return step.dose?.kind === 'duration' || step.dose?.kind === 'distance' ? step.dose.kind : null;
}

/** Exercise identity of a logged entry; entries from before identities were recorded share one. */
function exerciseKey(ref: SessionEntry['exerciseRef']): string {
    if (!ref) return 'unrecorded';
    return ref.kind === 'catalog' ? `catalog:${ref.exerciseId}` : `free:${ref.name}`;
}

/**
 * One step-independent policy everywhere: an entry's identity is the exercise it recorded, and
 * "no recorded exercise" is an identity of its own. The runner's working step (after a swap) and
 * the pinned step the ledger reads can differ, so a fallback to "the step's exercise" would make
 * them disagree. `logEntry` records the active step's exercise, so an entry lacks one only when
 * its step had none; such entries pair with each other, never with a recorded exercise's sides.
 */
function entryExerciseKey(_step: SessionStep, entry: SessionEntry): string {
    return exerciseKey(entry.exerciseRef);
}

/** Sided entries of the step's current exercise: a swap mid-pair starts a fresh pair. */
function sidedEntries(step: SessionStep, entries: readonly SessionEntry[], kind: 'duration' | 'distance'): SessionEntry[] {
    const current = exerciseKey(step.exerciseRef);
    return entries.filter(entry => entry.stepId === step.id && entry.payload.kind === kind
        && entryExerciseKey(step, entry) === current);
}

/**
 * A left/right hold or carry is one set only once both sides have been logged.
 *
 * Pairing follows the entries, not the step's dose: only the per-side hold and carry cards
 * record a left/right side, so such an entry is always half of a pair. That keeps the count
 * right when the dose that was logged differs from the step's -- a mid-session swap changes
 * only the runner's working step, while the ledger and exports read the pinned one -- and pairs
 * each payload kind -- and each exercise -- on its own when a swap leaves several under one
 * step id: the left side of carry A and the right side of carry B are two half sets, not one.
 * Side-less entries (bilateral work, legacy holds) count one set each.
 */
export function completedPrescribedSets(step: SessionStep, entries: readonly SessionEntry[]): number {
    const work = entries.filter(entry => entry.stepId === step.id && countsTowardPrescribedSets(entry));
    const pairs = new Map<string, { left: number; right: number }>();
    for (const entry of work) {
        if ((entry.payload.kind !== 'duration' && entry.payload.kind !== 'distance') || (entry.side !== 'left' && entry.side !== 'right')) continue;
        const key = `${entry.payload.kind}|${entryExerciseKey(step, entry)}`;
        const counts = pairs.get(key) ?? { left: 0, right: 0 };
        pairs.set(key, { ...counts, [entry.side]: counts[entry.side] + 1 });
    }
    // Each left/right pair counts once; an unpaired side is not yet a completed set.
    return [...pairs.values()].reduce((count, { left, right }) => count - left - right + Math.min(left, right), work.length);
}

/** The side to log next for a per-side hold or carry: whichever side has fewer entries, left first. */
export function nextHoldSide(step: SessionStep, entries: readonly SessionEntry[]): 'left' | 'right' {
    const kind = step.dose?.kind === 'distance' ? 'distance' : 'duration';
    const sided = sidedEntries(step, entries, kind);
    return sided.filter(entry => entry.side === 'left').length <= sided.filter(entry => entry.side === 'right').length
        ? 'left' : 'right';
}

export function hasUnpairedHoldSide(step: SessionStep, entries: readonly SessionEntry[]): boolean {
    const kind = sidedPayloadKind(step);
    if (!kind) return false;
    const sided = sidedEntries(step, entries, kind);
    return sided.filter(entry => entry.side === 'left').length !== sided.filter(entry => entry.side === 'right').length;
}

export function completesPrescribedSet(step: SessionStep, entries: readonly SessionEntry[], entry: SessionEntry): boolean {
    return completedPrescribedSets(step, [...entries, entry]) > completedPrescribedSets(step, entries);
}
