import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        setDoc: vi.fn(),
        deleteDoc: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionExecutionService } from './sessionExecutionService';

const USER_ID = 'u1';
const EXECUTION_ID = 'exec-1';

function validExecution(overrides: Record<string, unknown> = {}) {
    return {
        userId: USER_ID,
        executionId: EXECUTION_ID,
        sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
        date: '2026-08-17',
        startedAt: '2026-08-17T18:00:00Z',
        updatedAt: '2026-08-17T18:00:00Z',
        state: 'in_progress',
        schemaVersion: 1,
        ...overrides,
    };
}

function validEntry(overrides: Record<string, unknown> = {}) {
    return {
        id: 'entry-1',
        executionId: EXECUTION_ID,
        exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
        completedAt: '2026-08-17T18:10:00Z',
        createdAt: '2026-08-17T18:10:00Z',
        updatedAt: '2026-08-17T18:10:00Z',
        payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 60, isWarmup: false },
        ...overrides,
    };
}

describe('SessionExecutionService', () => {
    let service: SessionExecutionService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SessionExecutionService();
        firestore.doc.mockReturnValue({ id: EXECUTION_ID, path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` });
        firestore.collection.mockReturnValue({ tag: 'collection' });
        firestore.query.mockReturnValue({ tag: 'query' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDocs.mockResolvedValue({ docs: [] });
    });

    describe('getExecutionsInRange', () => {
        it('counts a malformed entry sub-document toward invalidRecords rather than dropping it silently', async () => {
            // First getDocs call: the session_executions range query.
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: EXECUTION_ID, ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` }, data: () => validExecution() }],
            });
            // Second getDocs call: that execution's entries sub-collection -- one valid, one malformed.
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: 'entry-1', ref: { path: `.../entries/entry-1` }, data: () => validEntry() },
                    { id: 'entry-2', ref: { path: `.../entries/entry-2` }, data: () => ({ ...validEntry({ id: 'entry-2' }), payload: { kind: 'repetition', setIndex: 1, reps: -1 } }) },
                ],
            });

            const result = await service.getExecutionsInRange(USER_ID, '2026-08-01', '2026-08-31');

            expect(result.executions).toHaveLength(1);
            expect(result.executions[0].entries).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });

        it('counts an entry cross-linked to another execution toward invalidRecords rather than dropping it silently', async () => {
            firestore.getDocs
                .mockResolvedValueOnce({
                    docs: [{ id: EXECUTION_ID, ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` }, data: () => validExecution() }],
                })
                .mockResolvedValueOnce({
                    docs: [
                        { id: 'entry-1', ref: { path: `.../entries/entry-1` }, data: () => validEntry() },
                        { id: 'cross-linked', ref: { path: `.../entries/cross-linked` }, data: () => validEntry({ id: 'cross-linked', executionId: 'other-execution' }) },
                    ],
                });

            const result = await service.getExecutionsInRange(USER_ID, '2026-08-01', '2026-08-31');

            expect(result.executions).toHaveLength(1);
            expect(result.executions[0].entries).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });

        it('counts an execution document whose id disagrees with its own executionId field, alongside any invalid entries elsewhere in the range', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: EXECUTION_ID, ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` }, data: () => validExecution() },
                    { id: 'doc-id-mismatch', ref: { path: `users/${USER_ID}/session_executions/doc-id-mismatch` }, data: () => validExecution() },
                ],
            });
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: 'entry-1', ref: { path: `.../entries/entry-1` }, data: () => validEntry() }],
            });

            const result = await service.getExecutionsInRange(USER_ID, '2026-08-01', '2026-08-31');

            expect(result.executions).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });

        it('still counts an invalid execution document itself, alongside any invalid entries elsewhere in the range', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: EXECUTION_ID, ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` }, data: () => validExecution() },
                    { id: 'corrupt', ref: { path: `users/${USER_ID}/session_executions/corrupt` }, data: () => ({ ...validExecution({ executionId: 'corrupt' }), state: 'not-a-real-state' }) },
                ],
            });
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: 'entry-1', ref: { path: `.../entries/entry-1` }, data: () => validEntry() }],
            });

            const result = await service.getExecutionsInRange(USER_ID, '2026-08-01', '2026-08-31');

            expect(result.executions).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });

        it('returns a clean, all-valid range with no invalid records', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: EXECUTION_ID, ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` }, data: () => validExecution() }],
            });
            firestore.getDocs.mockResolvedValueOnce({
                docs: [{ id: 'entry-1', ref: { path: `.../entries/entry-1` }, data: () => validEntry() }],
            });

            const result = await service.getExecutionsInRange(USER_ID, '2026-08-01', '2026-08-31');
            expect(result).toEqual({
                executions: [{ execution: validExecution(), entries: [validEntry()] }],
                invalidRecords: 0,
            });
        });
    });

    describe('transitionExecution', () => {
        it('writes directly when called without a batch', async () => {
            await service.transitionExecution(USER_ID, EXECUTION_ID, 'completed', { sessionRpe: 7 });
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const [, patch, options] = firestore.setDoc.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
            expect(patch).toMatchObject({ state: 'completed', sessionRpe: 7 });
            expect(options).toEqual({ merge: true });
        });

        it('queues into a caller-owned batch instead of writing directly, so completion can be committed atomically with a sibling write', async () => {
            const batch = { set: vi.fn(), commit: vi.fn() };
            await service.transitionExecution(USER_ID, EXECUTION_ID, 'completed', { sessionRpe: 7 }, batch as never);
            expect(firestore.setDoc).not.toHaveBeenCalled();
            expect(batch.set).toHaveBeenCalledTimes(1);
            const [, patch, options] = batch.set.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
            expect(patch).toMatchObject({ state: 'completed', sessionRpe: 7 });
            expect(options).toEqual({ merge: true });
        });
    });
});
