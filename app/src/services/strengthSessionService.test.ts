import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        onSnapshot: vi.fn(),
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

    describe('observeSession', () => {
        it('reports SDK pending-write metadata instead of treating a local-cache write as synced', () => {
            const unsubscribe = vi.fn();
            firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => {
                next({
                    id: SESSION_ID,
                    ref: { path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` },
                    exists: () => true,
                    data: () => validSession(),
                    metadata: { hasPendingWrites: true },
                });
                return unsubscribe;
            });
            const listener = vi.fn();
            expect(service.observeSession(USER_ID, SESSION_ID, listener)).toBe(unsubscribe);
            expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'AVAILABLE' }), true);
            expect(firestore.onSnapshot.mock.calls[0]?.[1]).toEqual({ includeMetadataChanges: true });
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

    describe('findActiveSession', () => {
        it('returns null when nothing is in progress', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [] });
            expect(await service.findActiveSession(USER_ID, '2026-08-17T18:00:00Z')).toBeNull();
        });

        it('returns a fresh in_progress session, even if its date field is yesterday (started before midnight)', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: SESSION_ID, ref: { path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` }, data: () => validSession({ date: '2026-08-16', startedAt: '2026-08-16T21:50:00Z' }) }],
            });
            const active = await service.findActiveSession(USER_ID, '2026-08-16T22:10:00Z');
            expect(active).toMatchObject({ sessionId: SESSION_ID, state: 'in_progress' });
        });

        it('abandons a stale session it walks past rather than returning it as resumable', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: SESSION_ID, ref: { path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` }, data: () => validSession({ startedAt: '2026-08-17T06:00:00Z' }) }],
            });
            existingDoc(validSession({ startedAt: '2026-08-17T06:00:00Z' }));
            const active = await service.findActiveSession(USER_ID, '2026-08-17T18:00:00Z');
            expect(active).toBeNull();
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        });
    });

    describe('saveExercises', () => {
        it('merges exercises and updatedAt without rewriting the rest of the document', async () => {
            const exercises = [{ exerciseId: 'bench_press', sets: [{ setIndex: 1, reps: 5, weightKg: 60, isWarmup: false, completedAt: '2026-08-17T18:10:00Z' }] }];
            await service.saveExercises(USER_ID, SESSION_ID, exercises, '2026-08-17T18:10:00Z');
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const [, payload, options] = firestore.setDoc.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
            expect(payload).toEqual({ exercises, updatedAt: '2026-08-17T18:10:00Z' });
            expect(options).toEqual({ merge: true });
        });

        it('rejects invalid nested set data before the permissive array rules boundary', async () => {
            const exercises = [{ exerciseId: 'bench_press', sets: [{ setIndex: 1, reps: 1001, weightKg: 60, isWarmup: false, completedAt: '2026-08-17T18:10:00Z' }] }];
            await expect(service.saveExercises(USER_ID, SESSION_ID, exercises)).rejects.toThrow('schema bounds');
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });
    });

    describe('getSessionsInRange', () => {
        it('uses an exclusive upper bound matching TrainingHistorySnapshot semantics', async () => {
            await service.getSessionsInRange(USER_ID, '2026-08-01', '2026-08-31');
            expect(firestore.where).toHaveBeenNthCalledWith(1, 'date', '>=', '2026-08-01');
            expect(firestore.where).toHaveBeenNthCalledWith(2, 'date', '<', '2026-08-31');
        });

        it('returns parsed sessions within the range', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: SESSION_ID, ref: { path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` }, data: () => validSession() }],
            });
            const result = await service.getSessionsInRange(USER_ID, '2026-08-01', '2026-08-31');
            expect(result.sessions).toHaveLength(1);
            expect(result.invalidRecords).toBe(0);
        });

        it('omits an invalid document from the rows but counts it, rather than failing the whole range', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: SESSION_ID, ref: { path: `users/${USER_ID}/strength_sessions/${SESSION_ID}` }, data: () => validSession() },
                    { id: 'corrupt', ref: { path: `users/${USER_ID}/strength_sessions/corrupt` }, data: () => ({ ...validSession({ sessionId: 'corrupt' }), state: 'not-a-real-state' }) },
                ],
            });
            const result = await service.getSessionsInRange(USER_ID, '2026-08-01', '2026-08-31');
            expect(result.sessions).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });

        it('returns an empty range cleanly', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [] });
            const result = await service.getSessionsInRange(USER_ID, '2026-08-01', '2026-08-31');
            expect(result).toEqual({ sessions: [], invalidRecords: 0 });
        });
    });
});
