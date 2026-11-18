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

function sidedEntries(step: SessionStep, entries: readonly SessionEntry[], kind: 'duration' | 'distance'): SessionEntry[] {
    return entries.filter(entry => entry.stepId === step.id && entry.payload.kind === kind);
}

/**
 * A left/right hold or carry is one set only once both sides have been logged.
 *
 * Pairing follows the entries, not the step's dose: only the per-side hold and carry cards
 * record a left/right side, so such an entry is always half of a pair. That keeps the count
 * right when the dose that was logged differs from the step's -- a mid-session swap changes
 * only the runner's working step, while the ledger and exports read the pinned one -- and pairs
 * each payload kind on its own when a swap leaves holds and carries under one step id.
 * Side-less entries (bilateral work, legacy holds) count one set each.
 */
export function completedPrescribedSets(step: SessionStep, entries: readonly SessionEntry[]): number {
    const work = entries.filter(entry => entry.stepId === step.id && countsTowardPrescribedSets(entry));
    return (['duration', 'distance'] as const).reduce((count, kind) => {
        const sided = work.filter(entry => entry.payload.kind === kind && (entry.side === 'left' || entry.side === 'right'));
        const left = sided.filter(entry => entry.side === 'left').length;
        return count - sided.length + Math.min(left, sided.length - left);
    }, work.length);
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
