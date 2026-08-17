import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        orderBy: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { StrengthSessionService } from './strengthSessionService';

const USER_ID = 'u1';
const SESSION_ID = 'session-1';

function validSession(overrides: Record<string, unknown> = {}) {
    return {
        userId: USER_ID, sessionId: SESSION_ID, date: '2026-08-17',
        startedAt: '2026-08-17T18:00:00Z', updatedAt: '2026-08-17T18:00:00Z',
        state: 'in_progress', exercises: [], schemaVersion: 1,
        ...overrides,
    };
}

function missingDoc() {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
}

function existingDoc(data: Record<string, unknown>) {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => data });
}

function failingRead() {
    firestore.getDoc.mockRejectedValueOnce(new Error('offline'));
}

describe('StrengthSessionService', () => {
    let service: StrengthSessionService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new StrengthSessionService();
        firestore.doc.mockReturnValue({ id: SESSION_ID, path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` });
        firestore.collection.mockReturnValue({ tag: 'collection' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDocs.mockResolvedValue({ docs: [] });
    });

    describe('getSessionState / getSession', () => {
        it('returns MISSING for a session that does not exist', async () => {
            missingDoc();
            expect(await service.getSessionState(USER_ID, SESSION_ID)).toEqual({ status: 'MISSING' });
            expect(await service.getSession(USER_ID, SESSION_ID)).toBeNull();
        });

        it('parses and returns an existing session', async () => {
            existingDoc(validSession());
            const state = await service.getSessionState(USER_ID, SESSION_ID);
            expect(state).toMatchObject({ status: 'AVAILABLE', data: { sessionId: SESSION_ID, state: 'in_progress' } });
        });

        it('surfaces a read failure as retryable UNAVAILABLE, never as empty', async () => {
            failingRead();
            const state = await service.getSessionState(USER_ID, SESSION_ID);
            expect(state).toMatchObject({ status: 'UNAVAILABLE', retryable: true });
        });
    });

    describe('startSession', () => {
        it('creates an in_progress session with the freshly minted doc id embedded as sessionId', async () => {
            const session = await service.startSession(USER_ID, { startedAt: '2026-08-17T18:00:00Z' });
            expect(session).toMatchObject({ userId: USER_ID, sessionId: SESSION_ID, state: 'in_progress', date: '2026-08-17', exercises: [] });
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const [, written] = firestore.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
            expect(written.sessionId).toBe(SESSION_ID);
        });

        it('carries an optional sourceRecommendationDate when the session started from a prescription', async () => {
            const session = await service.startSession(USER_ID, { startedAt: '2026-08-17T18:00:00Z', sourceRecommendationDate: '2026-08-17' });
            expect(session.sourceRecommendationDate).toBe('2026-08-17');
        });
    });

    describe('transitionState', () => {
        it('moves an in_progress session to completed and stamps completedAt', async () => {
            existingDoc(validSession());
            const updated = await service.transitionState(USER_ID, SESSION_ID, 'completed', '2026-08-17T19:00:00Z');
            expect(updated).toMatchObject({ state: 'completed', completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z' });
            expect(firestore.setDoc).toHaveBeenCalledWith(expect.anything(), {
                state: 'completed', completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z',
            }, { merge: true });
        });

        it('preserves an existing completion timestamp on an idempotent close', async () => {
            existingDoc(validSession({ state: 'completed', completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z' }));
            const updated = await service.transitionState(USER_ID, SESSION_ID, 'completed', '2026-08-17T20:00:00Z');
            expect(updated.completedAt).toBe('2026-08-17T19:00:00Z');
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects a transition timestamp before the last saved update', async () => {
            existingDoc(validSession({ updatedAt: '2026-08-17T19:00:00Z' }));
            await expect(service.transitionState(USER_ID, SESSION_ID, 'completed', '2026-08-17T18:59:59Z')).rejects.toThrow(/must not precede/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects reopening a completed session before ever writing to Firestore', async () => {
            existingDoc(validSession({ state: 'completed', completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z' }));
            await expect(service.transitionState(USER_ID, SESSION_ID, 'in_progress', '2026-08-17T20:00:00Z')).rejects.toThrow(/terminal/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects transitioning a session that does not exist', async () => {
            missingDoc();
            await expect(service.transitionState(USER_ID, SESSION_ID, 'completed')).rejects.toThrow(/no strength session/i);
        });

        it('surfaces an invalid stored session rather than silently transitioning it', async () => {
            existingDoc({ ...validSession(), state: 'not-a-real-state' });
            await expect(service.transitionState(USER_ID, SESSION_ID, 'completed')).rejects.toThrow(/invalid/i);
        });
    });

    describe('reconcileStaleSessions', () => {
        it('abandons a stale in_progress session and leaves a fresh one untouched', async () => {
            const staleId = 'stale-session';
            const freshId = 'fresh-session';
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: staleId, ref: { path: `users/${USER_ID}/strength_sessions/${staleId}` }, data: () => validSession({ sessionId: staleId, startedAt: '2026-08-17T06:00:00Z' }) },
                    { id: freshId, ref: { path: `users/${USER_ID}/strength_sessions/${freshId}` }, data: () => validSession({ sessionId: freshId, startedAt: '2026-08-17T17:50:00Z' }) },
                ],
            });
            // transitionState re-reads before writing; queue the stale session's own doc for that read.
            existingDoc(validSession({ sessionId: staleId, startedAt: '2026-08-17T06:00:00Z' }));

            const abandoned = await service.reconcileStaleSessions(USER_ID, '2026-08-17T18:00:00Z');

            expect(abandoned).toHaveLength(1);
            expect(abandoned[0]).toMatchObject({ sessionId: staleId, state: 'abandoned' });
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        });

        it('never deletes -- an abandoned session keeps every set it already logged', async () => {
            const staleId = 'stale-with-work';
            const loggedExercises = [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, reps: 5, weightKg: 100, isWarmup: false, completedAt: '2026-08-17T06:10:00Z' }] }];
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: staleId, ref: { path: `users/${USER_ID}/strength_sessions/${staleId}` }, data: () => validSession({ sessionId: staleId, startedAt: '2026-08-17T06:00:00Z', exercises: loggedExercises }) }],
            });
            existingDoc(validSession({ sessionId: staleId, startedAt: '2026-08-17T06:00:00Z', exercises: loggedExercises }));

            const abandoned = await service.reconcileStaleSessions(USER_ID, '2026-08-17T18:00:00Z');

            expect(abandoned[0]?.exercises).toEqual(loggedExercises);
        });

        it('leaves every session untouched when none are stale', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: 'fresh', ref: { path: `users/${USER_ID}/strength_sessions/fresh` }, data: () => validSession({ sessionId: 'fresh', startedAt: '2026-08-17T17:50:00Z' }) }],
            });
            const abandoned = await service.reconcileStaleSessions(USER_ID, '2026-08-17T18:00:00Z');
            expect(abandoned).toEqual([]);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });
    });
});
