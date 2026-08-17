import { getLocalDateString } from '../utils/localDate';
import type { StrengthSession, StrengthSessionState } from './models';
import { isValidStrengthInstant } from './strengthSessionValidation';

/** Pure state-machine and date-attribution rules for strength sessions (ADR-0021, S1.4).
 *  Kept separate from strengthSessionService.ts's Firestore I/O so the rules themselves
 *  are unit-testable without mocking the database, matching how the rest of the engine
 *  layer stays pure and synchronous (D-SUBJPURE, ADR-0020). */

/** A session left `in_progress` longer than this is treated as abandoned rather than
 *  resumable. No real strength session runs this long; the bound exists to recover a
 *  session an athlete genuinely walked away from (closed the tab, dead battery) without
 *  leaving it silently blocking a future "resume today's session" query forever. */
export const STALE_IN_PROGRESS_HOURS = 6;

/** ADR-0021: date is the Warsaw-local calendar date of session START, fixed at creation
 *  and never recomputed. A session starting 23:30 and finishing 00:20 belongs to the
 *  start date. Never derive this with `toISOString().split('T')[0]` (UTC), per CLAUDE.md. */
export function computeSessionDate(startedAtIso: string): string {
    if (!isValidStrengthInstant(startedAtIso)) {
        throw new Error('Strength session start time must be a valid ISO instant');
    }
    return getLocalDateString(new Date(startedAtIso));
}

/** Builds the initial in-memory shape for a new session. Pure -- the caller (the service)
 *  is responsible for persisting it and for supplying `sessionId` (the Firestore document
 *  id) and `userId`, neither of which this module has any business generating. */
export function buildNewStrengthSession(userId: string, sessionId: string, startedAtIso: string): StrengthSession {
    if (userId.trim() === '') throw new Error('Strength session userId is required');
    if (sessionId.trim() === '') throw new Error('Strength session sessionId is required');
    return {
        userId,
        sessionId,
        date: computeSessionDate(startedAtIso),
        startedAt: startedAtIso,
        updatedAt: startedAtIso,
        state: 'in_progress',
        exercises: [],
        schemaVersion: 1,
    };
}

/** `in_progress` may move to any state, including re-saving itself (every logged set is
 *  its own write, per D-SETLOG, and each of those writes keeps state unchanged). `completed`
 *  and `abandoned` are terminal: once a session is closed, reopening it is a new session,
 *  not a state transition -- an athlete who wants to log a forgotten exercise should log a
 *  fresh session rather than silently rewriting a closed one that may already have fed
 *  progressive-overload history or (once Step C ships) engine credit. */
export function canTransitionStrengthSessionState(current: StrengthSessionState, next: StrengthSessionState): boolean {
    if (current === 'in_progress') return true;
    return current === next;
}

export interface StrengthSessionTransition {
    ok: boolean;
    reason?: string;
}

export function validateStrengthSessionTransition(current: StrengthSessionState, next: StrengthSessionState): StrengthSessionTransition {
    if (canTransitionStrengthSessionState(current, next)) return { ok: true };
    return { ok: false, reason: `Cannot move a ${current} strength session to ${next}; ${current} is terminal` };
}

/** A session an athlete never closed. Left `in_progress` (not deleted) so it still counts
 *  toward overload history and, once Step C ships, real work the athlete actually did. */
export function isStaleInProgressSession(
    session: Pick<StrengthSession, 'state' | 'startedAt'>,
    nowIso: string,
    thresholdHours: number = STALE_IN_PROGRESS_HOURS,
): boolean {
    if (session.state !== 'in_progress') return false;
    const elapsedMs = new Date(nowIso).getTime() - new Date(session.startedAt).getTime();
    if (!Number.isFinite(elapsedMs)) return false;
    return elapsedMs > thresholdHours * 60 * 60 * 1000;
}
