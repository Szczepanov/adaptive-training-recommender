/**
 * Pure decisions behind the runner's two short-lived undo offers (#724): "Undo" for the set just
 * logged, and "Set removed - Undo" (restore) for the most recent removal. The hook only holds the
 * state and performs the writes; every rule about which offer is current, when a restore must be
 * refused, and how a new set is numbered lives here so it can be unit tested without a DOM.
 *
 * Invariant: at most one offer is current. Logging a set dismisses any pending restore; removing
 * an entry (including an undo of the logged set) retires the logged-set offer. Whichever action
 * happened last therefore owns the banner.
 */
import type { SessionEntry, SessionStep } from './models';

/** Two `ExerciseRef`s identify the same performed exercise. Used to scope a step's per-exercise
 * `setIndex` so a mid-session swap starts the replacement exercise's own set count at 1. */
export function sameExerciseRef(a: SessionStep['exerciseRef'], b: SessionStep['exerciseRef']): boolean {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === 'catalog' && b.kind === 'catalog'
        ? a.exerciseId === b.exerciseId
        : a.kind === 'unresolved_free_text' && b.kind === 'unresolved_free_text' && a.name === b.name;
}

/** Highest live repetition set number for the step's current exercise, plus one. Counting live
 * sets instead would reuse a surviving number after a middle set was removed (s1, s2; remove s1;
 * a count-based "2" collides with s2). Non-contiguous indices are valid: every consumer only
 * requires a unique integer >= 1 (`sessions/validation`, Firestore rules, strength validation). */
export function nextRepetitionSetIndex(
    liveEntries: readonly SessionEntry[],
    stepId: string,
    exerciseRef: SessionStep['exerciseRef'],
): number {
    let highest = 0;
    for (const entry of liveEntries) {
        if (entry.deletedAt || entry.stepId !== stepId || entry.payload.kind !== 'repetition') continue;
        if (!sameExerciseRef(entry.exerciseRef, exerciseRef)) continue;
        highest = Math.max(highest, entry.payload.setIndex);
    }
    return highest + 1;
}

export interface SetUndoState {
    /** The set logged most recently, while its short undo window is open. */
    recentLogged: { id: string; atMs: number } | null;
    /** Removals whose restore is no longer offered (a newer set was logged, or it was refused). */
    dismissedRemovedIds: ReadonlySet<string>;
    /** Reason a restore was refused, shown on screen instead of failing silently. */
    notice: string | null;
}

export const INITIAL_SET_UNDO_STATE: SetUndoState = { recentLogged: null, dismissedRemovedIds: new Set(), notice: null };

export function afterSetLogged(state: SetUndoState, currentRemoved: SessionEntry | null, entryId: string, nowMs: number): SetUndoState {
    const dismissed = currentRemoved && !state.dismissedRemovedIds.has(currentRemoved.id)
        ? new Set(state.dismissedRemovedIds).add(currentRemoved.id)
        : state.dismissedRemovedIds;
    return { recentLogged: { id: entryId, atMs: nowMs }, dismissedRemovedIds: dismissed, notice: null };
}

/** Any removal retires the logged-set offer so the newer "Set removed" restore is never hidden. */
export function afterEntryRemoved(state: SetUndoState): SetUndoState {
    return { ...state, recentLogged: null, notice: null };
}

export function afterRestoreDone(state: SetUndoState): SetUndoState {
    return { ...state, notice: null };
}

export function afterLoggedOfferExpired(state: SetUndoState): SetUndoState {
    return state.recentLogged === null ? state : { ...state, recentLogged: null };
}

export function afterRestoreRefused(state: SetUndoState, removedId: string, reason: string): SetUndoState {
    return { ...state, dismissedRemovedIds: new Set(state.dismissedRemovedIds).add(removedId), notice: reason };
}

export const RESTORE_REFUSED_DUPLICATE_REASON =
    'That set could not be restored because another logged set already has the same set number.';

/** The restore offer is current only for a non-choice removal that no newer set has superseded. */
export function isRestoreOffered(lastRemoved: SessionEntry | null, dismissedRemovedIds: ReadonlySet<string>): boolean {
    return lastRemoved !== null && lastRemoved.payload.kind !== 'choice' && !dismissedRemovedIds.has(lastRemoved.id);
}

/** True when restoring `restored` would leave two live repetition sets with the same set index
 * for the same step and exercise (a false extra exposure). */
export function restoreWouldDuplicateSetIndex(liveEntries: readonly SessionEntry[], restored: SessionEntry): boolean {
    if (restored.payload.kind !== 'repetition') return false;
    const { setIndex } = restored.payload;
    return liveEntries.some(entry => entry.id !== restored.id
        && !entry.deletedAt
        && entry.stepId === restored.stepId
        && entry.payload.kind === 'repetition'
        && entry.payload.setIndex === setIndex
        && sameExerciseRef(entry.exerciseRef, restored.exerciseRef));
}

export type RestorePlan =
    | { kind: 'ignore' }
    | { kind: 'refuse'; reason: string }
    | { kind: 'restore'; entry: SessionEntry };

/** Decides a tap on "Set removed - Undo". The refusal check runs before anything is cleared so a
 * refused restore can say why instead of making the offer vanish. */
export function planRestore(input: {
    removed: SessionEntry | null;
    dismissedRemovedIds: ReadonlySet<string>;
    liveEntries: readonly SessionEntry[];
    terminalInFlight: boolean;
}): RestorePlan {
    const { removed, dismissedRemovedIds, liveEntries, terminalInFlight } = input;
    if (terminalInFlight || !removed || !isRestoreOffered(removed, dismissedRemovedIds)) return { kind: 'ignore' };
    if (restoreWouldDuplicateSetIndex(liveEntries, removed)) return { kind: 'refuse', reason: RESTORE_REFUSED_DUPLICATE_REASON };
    return { kind: 'restore', entry: removed };
}

/** The number the athlete sees for an entry: its 1-based position among the entries logged for
 * the same step, which is exactly how the "Performed for this step" list and its edit/remove
 * aria-labels number rows. `setIndex` can legitimately skip numbers (highest + 1), so it is not
 * used for display. */
export function performedEntryPosition(entries: readonly SessionEntry[], entry: SessionEntry): number {
    const position = entries.filter(candidate => candidate.stepId === entry.stepId).findIndex(candidate => candidate.id === entry.id);
    return position === -1 ? 0 : position + 1;
}

/** Label shared by the logged-set banner and its Undo button ("Set 3"); null when the entry is gone. */
export function loggedSetLabel(entries: readonly SessionEntry[], entry: SessionEntry): string {
    const position = performedEntryPosition(entries, entry);
    return entry.payload.kind === 'repetition' && position > 0 ? `Set ${position}` : 'Entry';
}
