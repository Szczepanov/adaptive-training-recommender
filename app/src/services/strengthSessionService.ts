import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { LoggedExercise, StrengthSession, StrengthSessionState } from '../engine/models';
import type { DataState } from '../engine/dataState';
import {
    buildNewStrengthSession,
    isStaleInProgressSession,
    validateStrengthSessionTransition,
} from '../engine/strengthSessionLifecycle';
import { parseStrengthSession } from '../persistence/parsers/strengthSession';
import { isPermissionDeniedError } from '../utils/errors';
import { isValidStrengthInstant } from '../engine/strengthSessionValidation';

/**
 * Storage for `users/{userId}/strength_sessions/{sessionId}` (ADR-0021, S1.4). State
 * transitions and date attribution are delegated to the pure `strengthSessionLifecycle`
 * module so the rules themselves stay unit-testable without mocking Firestore; this class
 * is I/O only.
 */
export class StrengthSessionService {
    private readonly collectionPath = 'strength_sessions';

    async getSessionState(userId: string, sessionId: string): Promise<DataState<StrengthSession>> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, sessionId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return { status: 'MISSING' };
            return parseStrengthSession(docSnap.data(), `users/${userId}/${this.collectionPath}/${sessionId}`, sessionId, userId);
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read strength session',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }

    async getSession(userId: string, sessionId: string): Promise<StrengthSession | null> {
        const state = await this.getSessionState(userId, sessionId);
        return state.status === 'AVAILABLE' ? state.data : null;
    }

    /** Starts a new `in_progress` session. The document id is generated client-side (via
     *  an unwritten `doc()` ref, which the SDK can mint fully offline -- no server
     *  round-trip) and embedded as `sessionId` in the same single write the rules require
     *  to already agree with the path. */
    async startSession(
        userId: string,
        options: { startedAt?: string; sourceRecommendationDate?: string } = {},
    ): Promise<StrengthSession> {
        const startedAt = options.startedAt ?? new Date().toISOString();
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const docRef = doc(collRef);
        const session: StrengthSession = {
            ...buildNewStrengthSession(userId, docRef.id, startedAt),
            ...(options.sourceRecommendationDate ? { sourceRecommendationDate: options.sourceRecommendationDate } : {}),
        };
        await setDoc(docRef, session);
        return session;
    }

    /** Moves a session to `completed` or `abandoned`. Rejects an illegal transition (a
     *  terminal state trying to reopen) before ever reaching Firestore, matching
     *  `validateStrengthSessionTransition`'s rules -- see `strengthSessionLifecycle.ts`
     *  for why reopening a closed session is disallowed rather than merely discouraged. */
    async transitionState(
        userId: string,
        sessionId: string,
        next: StrengthSessionState,
        nowIso: string = new Date().toISOString(),
    ): Promise<StrengthSession> {
        const existingState = await this.getSessionState(userId, sessionId);
        if (existingState.status === 'UNAVAILABLE') {
            throw new Error(`Could not confirm the current state of strength session ${sessionId}; please try again`);
        }
        if (existingState.status === 'INVALID') {
            throw new Error(`Stored strength session ${sessionId} is invalid; it must be repaired before its state can change`);
        }
        if (existingState.status === 'MISSING') {
            throw new Error(`No strength session ${sessionId} exists to transition`);
        }
        const current = existingState.data;
        const transition = validateStrengthSessionTransition(current.state, next);
        if (!transition.ok) {
            throw new Error(transition.reason);
        }
        if (current.state === next) return current;
        if (!isValidStrengthInstant(nowIso) || Date.parse(nowIso) < Date.parse(current.updatedAt)) {
            throw new Error('Strength session transition time must not precede the last saved update');
        }
        const updated: StrengthSession = {
            ...current,
            state: next,
            updatedAt: nowIso,
            ...(next === 'completed' ? { completedAt: nowIso } : {}),
        };
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, sessionId);
        await setDoc(docRef, {
            state: next,
            updatedAt: nowIso,
            ...(next === 'completed' ? { completedAt: nowIso } : {}),
        }, { merge: true });
        return updated;
    }

    /** Finds `in_progress` sessions the athlete never closed and abandons the ones past
     *  the staleness threshold -- a session is retained, never deleted, because partial
     *  work still happened and still belongs in overload history (and, once Step C ships,
     *  engine credit). Intended to run opportunistically (e.g. on app open), not as a
     *  scheduled job; there is no server-side cleanup infrastructure for this app. */
    async reconcileStaleSessions(userId: string, nowIso: string = new Date().toISOString()): Promise<StrengthSession[]> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('state', '==', 'in_progress'), orderBy('startedAt', 'asc'));
        const querySnapshot = await getDocs(q);
        const abandoned: StrengthSession[] = [];
        for (const docSnap of querySnapshot.docs) {
            const parsed = parseStrengthSession(docSnap.data(), docSnap.ref.path, docSnap.id, userId);
            if (parsed.status !== 'AVAILABLE') continue;
            if (isStaleInProgressSession(parsed.data, nowIso)) {
                abandoned.push(await this.transitionState(userId, docSnap.id, 'abandoned', nowIso));
            }
        }
        return abandoned;
    }

    /** Resumable session, if any -- the most recent `in_progress` session regardless of its
     *  `date` field, since a session that started late at night is still resumable after
     *  local midnight even though `date` (fixed at S1.4's session START) no longer equals
     *  today. Walks past-and-abandons any stale session it encounters on the way, so a
     *  caller never has to run `reconcileStaleSessions` separately first. */
    async findActiveSession(userId: string, nowIso: string = new Date().toISOString()): Promise<StrengthSession | null> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('state', '==', 'in_progress'), orderBy('startedAt', 'desc'));
        const querySnapshot = await getDocs(q);
        for (const docSnap of querySnapshot.docs) {
            const parsed = parseStrengthSession(docSnap.data(), docSnap.ref.path, docSnap.id, userId);
            if (parsed.status !== 'AVAILABLE') continue;
            if (isStaleInProgressSession(parsed.data, nowIso)) {
                await this.transitionState(userId, docSnap.id, 'abandoned', nowIso);
                continue;
            }
            return parsed.data;
        }
        return null;
    }

    /** Persists the session's `exercises` array as its own write, immediately after every
     *  logged set (D-SETLOG: per-set persistence, not batched until "Done"). A merge write
     *  of the whole array, matching `decisionJournalService.write`'s whole-object-merge
     *  style -- simple and correct at this document's bounded size (rules cap `exercises`
     *  at 30), not the cheapest possible payload at larger scale. */
    async saveExercises(userId: string, sessionId: string, exercises: LoggedExercise[], nowIso: string = new Date().toISOString()): Promise<void> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, sessionId);
        await setDoc(docRef, { exercises, updatedAt: nowIso }, { merge: true });
    }
}

export const strengthSessionService = new StrengthSessionService();
