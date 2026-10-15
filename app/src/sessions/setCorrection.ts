/**
 * Pure helpers for correcting or undoing a just-logged repetition set (#724).
 *
 * A correction is a deliberate `correct` diary mutation on the *same* entry (see
 * `sessionExecutionService.correctEntry`): the entry keeps its identity, `completedAt`,
 * `createdAt`, set index, warm-up flag and intensity gauge, and only the athlete-edited
 * performed values change. An undo of a just-logged set is the existing `delete` tombstone,
 * never a compensating set. Out-of-range values are rejected, never clamped or "fixed".
 */
import type { RepetitionEntryPayload, SessionEntry } from './models';
import { runExclusive } from '../utils/runExclusive';

/** How long after logging a set the one-tap "Undo" affordance stays offered. */
export const LOGGED_SET_UNDO_WINDOW_MS = 10_000;

export type SetCorrectionInput = { reps: string; weightKg: string };

export type SetCorrectionResult =
    | { ok: true; payload: RepetitionEntryPayload }
    | { ok: false; reason: string };

export function buildSetCorrection(entry: SessionEntry, input: SetCorrectionInput): SetCorrectionResult {
    if (entry.payload.kind !== 'repetition') {
        return { ok: false, reason: 'Only repetition sets can be corrected here.' };
    }
    const repsText = input.reps.trim();
    // Plain decimal digits only: `Number('1e1')` would otherwise silently turn into 10 reps.
    const reps = /^\d+$/.test(repsText) ? Number(repsText) : Number.NaN;
    if (!Number.isSafeInteger(reps) || reps < 1) {
        return { ok: false, reason: 'Enter a whole number of repetitions (1 or more).' };
    }
    const weightText = input.weightKg.trim();
    let weightKg: number | undefined;
    if (weightText !== '') {
        weightKg = /^(\d+\.?\d*|\.\d+)$/.test(weightText) ? Number(weightText) : Number.NaN;
        if (!Number.isFinite(weightKg)) {
            return { ok: false, reason: 'Enter a load of 0 kg or more, or leave it empty.' };
        }
    }
    const { weightKg: _previousWeight, ...rest } = entry.payload;
    void _previousWeight;
    return {
        ok: true,
        payload: { ...rest, reps, ...(weightKg !== undefined ? { weightKg } : {}) },
    };
}

/** True while the athlete may still one-tap undo a set logged at `loggedAtMs`. */
export function isLoggedSetUndoOpen(loggedAtMs: number, nowMs: number): boolean {
    return nowMs >= loggedAtMs && nowMs - loggedAtMs < LOGGED_SET_UNDO_WINDOW_MS;
}

export const CORRECTION_NOT_SAVED_REASON = 'The correction could not be saved. The set keeps its previous values.';

export interface SetCorrectionEffects {
    /** Optimistic local update, applied before the durable write. */
    applyLocal: (payload: RepetitionEntryPayload) => void;
    /** Durable write through the auditable correction path; rejects when not accepted. */
    persist: (payload: RepetitionEntryPayload) => Promise<void>;
    /** Restores the stored values after a rejected write. */
    rollbackLocal: () => void;
}

/** Validates, applies, persists and (on a rejected write) rolls back one correction. A failed
 * write is reported as `ok: false` so the editor stays open with the reason. */
export async function commitSetCorrection(
    target: SessionEntry,
    input: SetCorrectionInput,
    effects: SetCorrectionEffects,
): Promise<SetCorrectionResult> {
    const built = buildSetCorrection(target, input);
    if (!built.ok) return built;
    effects.applyLocal(built.payload);
    try {
        await effects.persist(built.payload);
    } catch {
        effects.rollbackLocal();
        return { ok: false, reason: CORRECTION_NOT_SAVED_REASON };
    }
    return built;
}

export type LoggedSetUndoPlan = 'undo' | 'expired' | 'ignore';

/** Decides what a tap on the logged-set Undo does. A terminal write in flight (rules require
 * `in_progress` for entries) or a tap already being processed is ignored; an expired window
 * just dismisses the offer. */
export function planLoggedSetUndo(
    recent: { atMs: number } | null,
    nowMs: number,
    state: { undoInFlight: boolean; terminalInFlight: boolean },
): LoggedSetUndoPlan {
    if (!recent || state.undoInFlight || state.terminalInFlight) return 'ignore';
    return isLoggedSetUndoOpen(recent.atMs, nowMs) ? 'undo' : 'expired';
}

/** Runs `undoOnce` under the single-flight lock so a double tap tombstones at most once. */
export function runLoggedSetUndo<T>(lock: { current: boolean }, undoOnce: () => Promise<T>): Promise<T | undefined> {
    return runExclusive(lock, undoOnce);
}
