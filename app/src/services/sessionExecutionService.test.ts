import { beforeEach, describe, expect, it, vi } from 'vitest';
import { where } from 'firebase/firestore';

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocFromCache: vi.fn(),
        onSnapshot: vi.fn(),
        waitForPendingWrites: vi.fn(),
        getDocs: vi.fn(),
        setDoc: vi.fn(),
        deleteDoc: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        runTransaction: vi.fn(),
        writeBatch: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionExecutionService } from './sessionExecutionService';
import { readDiaryReceipts, removeDiaryReceipt, saveDiaryReceipt } from './sessionDiaryReceipts';
import type { SessionDiaryMutation } from './sessionExecutionService';

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

type TxSnapshot = { exists: boolean; data?: Record<string, unknown> };

/** Builds a mock transaction object keyed by the same `path` the `doc()` mock below derives
 * from its args -- shared by the persistent default (no lock, no conflict) and by
 * `makeTransactionMock` (explicit per-test responses). */
function makeTx(responsesByPath: Record<string, TxSnapshot> = {}) {
    return {
        get: vi.fn(async (ref: { path: string }) => {
            const resp = responsesByPath[ref.path] ?? { exists: false };
            return { exists: () => resp.exists, data: () => resp.data, ref };
        }),
        set: vi.fn(),
    };
}

/**
 * Mocks the next `runTransaction` call to run against a fixed set of documents. Returns the
 * transaction object so a test can assert on `.set` calls (the execution + lock writes) the
 * same way existing tests assert on `firestore.setDoc`.
 */
function makeTransactionMock(responsesByPath: Record<string, TxSnapshot> = {}) {
    const tx = makeTx(responsesByPath);
    firestore.runTransaction.mockImplementationOnce(
        async (_db: unknown, callback: (t: typeof tx) => unknown) => callback(tx),
    );
    return tx;
}

function makeWriteBatchMock() {
    return {
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    };
}

describe('SessionExecutionService', () => {
    let service: SessionExecutionService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SessionExecutionService();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
            id: segments[segments.length - 1],
            path: segments.join('/'),
        }));
        firestore.collection.mockReturnValue({ tag: 'collection' });
        firestore.query.mockReturnValue({ tag: 'query' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDocs.mockResolvedValue({ docs: [] });
        firestore.getDocFromCache.mockRejectedValue(new Error('not cached'));
        firestore.waitForPendingWrites.mockResolvedValue(undefined);
        // Default: an empty transaction (no lock, no conflicting execution) so tests that
        // don't care about the transactional recheck can exercise `startExecution`'s create
        // path without wiring up `makeTransactionMock` themselves. A test that needs custom
        // `get` responses or wants to assert on `.set` calls overrides this per-call with
        // `makeTransactionMock(...)`.
        firestore.runTransaction.mockImplementation(
            async (_db: unknown, callback: (t: ReturnType<typeof makeTx>) => unknown) => callback(makeTx()),
        );
        firestore.writeBatch.mockImplementation(() => makeWriteBatchMock());
    });

    describe('restored diary receipts', () => {
        const mutation: SessionDiaryMutation = {
            id: 'receipt-correction', executionId: 'exec-receipt', targetId: 'entry-1', targetKind: 'entry',
            kind: 'correct', at: '2026-08-17T18:20:00Z',
            before: validEntry() as never,
            after: validEntry({ payload: { kind: 'repetition', setIndex: 1, reps: 10 } }) as never,
        };

        it('retains rejected intent as failed after reload even when no original callback survives', async () => {
            saveDiaryReceipt(USER_ID, { mutation, state: 'queued' });
            firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => {
                next({ docs: [], metadata: { hasPendingWrites: false, fromCache: false } });
                return vi.fn();
            });
            const next = vi.fn();
            const failed = vi.fn();
            new SessionExecutionService().watchDiarySync(USER_ID, mutation.executionId, next, failed);
            await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
            expect(next).not.toHaveBeenCalled();
            expect(failed).toHaveBeenCalledOnce();
            expect(readDiaryReceipts(USER_ID, mutation.executionId)).toEqual([{ mutation, state: 'failed' }]);
            removeDiaryReceipt(USER_ID, mutation.executionId, mutation.id);
        });

        it('requires matching server audit bytes before discarding a receipt', async () => {
            saveDiaryReceipt(USER_ID, { mutation, state: 'queued' });
            let emit!: (snapshot: unknown) => void;
            firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => { emit = next; return vi.fn(); });
            const next = vi.fn();
            const failed = vi.fn();
            service.watchDiarySync(USER_ID, mutation.executionId, next, failed);
            emit({ docs: [], metadata: { hasPendingWrites: false, fromCache: true } });
            await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(true));
            expect(next).toHaveBeenLastCalledWith(true);
            expect(readDiaryReceipts(USER_ID, mutation.executionId)).toHaveLength(1);
            emit({ docs: [{ id: mutation.id, data: () => mutation }], metadata: { hasPendingWrites: false, fromCache: false } });
            await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(false));
            expect(next).toHaveBeenLastCalledWith(false);
            expect(readDiaryReceipts(USER_ID, mutation.executionId)).toEqual([]);
            expect(failed).not.toHaveBeenCalled();
        });

        it('does not mistake an older server snapshot for rejection of a newly accepted cross-tab write', async () => {
            let emit!: (snapshot: unknown) => void;
            firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => { emit = next; return vi.fn(); });
            const next = vi.fn();
            const failed = vi.fn();
            service.watchDiarySync(USER_ID, mutation.executionId, next, failed);
            // The snapshot predates this shared-storage receipt, but the current
            // persistent cache knows that another tab still has its marker queued.
            saveDiaryReceipt(USER_ID, { mutation, state: 'queued' });
            firestore.getDocFromCache.mockResolvedValueOnce({ metadata: { hasPendingWrites: true } });
            emit({ docs: [], metadata: { hasPendingWrites: false, fromCache: false } });
            await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(true));
            expect(failed).not.toHaveBeenCalled();
            expect(readDiaryReceipts(USER_ID, mutation.executionId)[0]?.state).toBe('queued');
            emit({ docs: [{ id: mutation.id, data: () => mutation }], metadata: { hasPendingWrites: false, fromCache: false } });
            await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(false));
            expect(readDiaryReceipts(USER_ID, mutation.executionId)).toEqual([]);
        });
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

    describe('logRestEvent / getRestEvents (PR 3, training-occurrence plan)', () => {
        function validRestEvent(overrides: Record<string, unknown> = {}) {
            return {
                id: 'rest-1',
                executionId: EXECUTION_ID,
                afterEntryId: 'entry-1',
                prescribedSeconds: 90,
                startedAt: '2026-08-17T18:10:00Z',
                endedAt: '2026-08-17T18:11:30Z',
                actualSeconds: 90,
                endReason: 'timer_elapsed',
                createdAt: '2026-08-17T18:11:30Z',
                updatedAt: '2026-08-17T18:11:30Z',
                ...overrides,
            };
        }

        it('atomically queues the rest, immutable audit marker and execution touch using the caller-supplied id', async () => {
            const batch = makeWriteBatchMock();
            firestore.writeBatch.mockReturnValueOnce(batch);
            await service.logRestEvent(USER_ID, EXECUTION_ID, validRestEvent() as never);
            expect(batch.set).toHaveBeenCalledTimes(3);
            expect(batch.commit).toHaveBeenCalledTimes(1);
            const [, payload] = batch.set.mock.calls[0] as [unknown, Record<string, unknown>];
            expect(payload).toMatchObject({ id: 'rest-1', afterEntryId: 'entry-1', endReason: 'timer_elapsed', actualSeconds: 90 });
            expect(batch.set.mock.calls[1]?.[1]).toMatchObject({ id: 'rest-rest-1', before: null, after: payload });
        });

        it('returns only rest events belonging to this execution, sorted by startedAt, dropping malformed ones', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    { id: 'rest-2', ref: { path: '.../restEvents/rest-2' }, data: () => validRestEvent({ id: 'rest-2', afterEntryId: 'entry-2', startedAt: '2026-08-17T18:20:00Z', endedAt: '2026-08-17T18:21:00Z' }) },
                    { id: 'rest-1', ref: { path: '.../restEvents/rest-1' }, data: () => validRestEvent() },
                    { id: 'rest-cross', ref: { path: '.../restEvents/rest-cross' }, data: () => validRestEvent({ id: 'rest-cross', executionId: 'other-exec' }) },
                    { id: 'rest-bad', ref: { path: '.../restEvents/rest-bad' }, data: () => validRestEvent({ id: 'rest-bad', actualSeconds: -1 }) },
                ],
            });

            const restEvents = await service.getRestEvents(USER_ID, EXECUTION_ID);

            expect(restEvents.map(e => e.id)).toEqual(['rest-1', 'rest-2']);
        });
    });

    describe('findExistingExecution', () => {
        it('returns matching completed execution for a given date', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: EXECUTION_ID,
                        ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` },
                        data: () => validExecution({ state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            const result = await service.findExistingExecution(USER_ID, { date: '2026-08-17' });
            expect(result).not.toBeNull();
            expect(result?.executionId).toBe(EXECUTION_ID);
            expect(result?.state).toBe('completed');
        });

        it('filters by occurrenceId when occurrenceId is specified', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-primary',
                        ref: { path: `users/${USER_ID}/session_executions/exec-primary` },
                        data: () => validExecution({ executionId: 'exec-primary', occurrenceId: 'occ-1', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                    {
                        id: 'exec-other',
                        ref: { path: `users/${USER_ID}/session_executions/exec-other` },
                        data: () => validExecution({ executionId: 'exec-other', occurrenceId: 'occ-2', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            const result = await service.findExistingExecution(USER_ID, { date: '2026-08-17', occurrenceId: 'occ-2' });
            expect(result?.executionId).toBe('exec-other');
        });

        it('ignores executions bound to other occurrences when querying without occurrenceId', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-bundle-member',
                        ref: { path: `users/${USER_ID}/session_executions/exec-bundle-member` },
                        data: () => validExecution({ executionId: 'exec-bundle-member', occurrenceId: 'occ-bundle-1', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            const result = await service.findExistingExecution(USER_ID, { date: '2026-08-17' });
            expect(result).toBeNull();
        });

        it('prioritizes in_progress over completed, so an active redo is never shadowed by a stale completed record', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-in-progress',
                        ref: { path: `users/${USER_ID}/session_executions/exec-in-progress` },
                        data: () => validExecution({ executionId: 'exec-in-progress', state: 'in_progress', startedAt: '2026-08-17T19:00:00Z' }),
                    },
                    {
                        id: 'exec-completed',
                        ref: { path: `users/${USER_ID}/session_executions/exec-completed` },
                        data: () => validExecution({ executionId: 'exec-completed', state: 'completed', startedAt: '2026-08-17T18:00:00Z', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            const result = await service.findExistingExecution(USER_ID, { date: '2026-08-17' });
            expect(result?.executionId).toBe('exec-in-progress');
        });

        it('does not treat an unrelated catalog session with a different prescriptionHash as a duplicate', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-am-run',
                        ref: { path: `users/${USER_ID}/session_executions/exec-am-run` },
                        data: () => validExecution({ executionId: 'exec-am-run', state: 'completed', prescriptionHash: 'hash-am-run', completedAt: '2026-08-17T08:45:00Z' }),
                    },
                ],
            });

            const result = await service.findExistingExecution(USER_ID, { date: '2026-08-17', prescriptionHash: 'hash-pm-strength' });
            expect(result).toBeNull();
        });
    });

    describe('startExecution guards', () => {
        it('rejects a partial FIT identity before any persistence work starts', async () => {
            await expect(service.startExecution(USER_ID, 'exec-partial-fp', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
                fitWorkoutFingerprint: 'fit-workout-v2:0123456789abcdef0123456789abcdef',
            })).rejects.toThrow('fitWorkoutFingerprint and fitWorkoutFingerprintKind must be provided together');

            expect(firestore.getDocs).not.toHaveBeenCalled();
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        it('creates a new execution when none exists', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [] });
            const tx = makeTransactionMock();

            const exec = await service.startExecution(USER_ID, 'exec-new', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
            });

            expect(exec.executionId).toBe('exec-new');
            // The execution doc and its session_execution_locks pointer, written atomically.
            expect(tx.set).toHaveBeenCalledTimes(2);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('resumes existing in_progress execution without creating a second execution document', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-existing-in-progress',
                        ref: { path: `users/${USER_ID}/session_executions/exec-existing-in-progress` },
                        data: () => validExecution({ executionId: 'exec-existing-in-progress', state: 'in_progress' }),
                    },
                ],
            });

            const exec = await service.startExecution(USER_ID, 'exec-attempt-2', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
            });

            expect(exec.executionId).toBe('exec-existing-in-progress');
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('blocks with an error if an execution is already completed and allowDuplicateCompleted is not true', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-already-done',
                        ref: { path: `users/${USER_ID}/session_executions/exec-already-done` },
                        data: () => validExecution({ executionId: 'exec-already-done', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            await expect(service.startExecution(USER_ID, 'exec-attempt-2', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
            })).rejects.toThrow('A completed execution already exists for this session today.');
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('allows creating a second execution when allowDuplicateCompleted is explicitly true', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-already-done',
                        ref: { path: `users/${USER_ID}/session_executions/exec-already-done` },
                        data: () => validExecution({ executionId: 'exec-already-done', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }),
                    },
                ],
            });

            const tx = makeTransactionMock();

            const exec = await service.startExecution(USER_ID, 'exec-redo', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
                allowDuplicateCompleted: true,
            });

            expect(exec.executionId).toBe('exec-redo');
            expect(tx.set).toHaveBeenCalledTimes(2);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        // #663 regression: the outside pre-check query and the transactional create are two
        // separate round-trips, so the pre-check can find nothing (the exact race window)
        // while another caller's transaction has already claimed the slot. These tests
        // exercise the transactional recheck directly -- the part the pre-check-only tests
        // above cannot reach -- by seeding a lock the pre-check's `getDocs` mock never sees.
        describe('transactional slot recheck (closes the TOCTOU race)', () => {
            const LOCK_PATH = `users/${USER_ID}/session_execution_locks/rx_2026-08-17_nohash`;

            it('returns the winner\'s execution instead of creating a duplicate when the recheck finds an in_progress claim the pre-check missed', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] }); // pre-check: race window, sees nothing
                const winnerPath = `users/${USER_ID}/session_executions/exec-winner`;
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-winner', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    [winnerPath]: { exists: true, data: validExecution({ executionId: 'exec-winner', state: 'in_progress' }) },
                });

                const exec = await service.startExecution(USER_ID, 'exec-loser', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-winner');
                expect(tx.set).not.toHaveBeenCalled();
            });

            it('throws instead of creating a duplicate when the recheck finds a completed claim and allowDuplicateCompleted is not set', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const winnerPath = `users/${USER_ID}/session_executions/exec-winner`;
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-winner', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    [winnerPath]: { exists: true, data: validExecution({ executionId: 'exec-winner', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }) },
                });

                await expect(service.startExecution(USER_ID, 'exec-loser', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                })).rejects.toThrow('A completed execution already exists for this session today.');
                expect(tx.set).not.toHaveBeenCalled();
            });

            it('creates a new execution and moves the lock pointer forward on redo when the recheck finds a completed claim', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const previousPath = `users/${USER_ID}/session_executions/exec-previous`;
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-previous', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    [previousPath]: { exists: true, data: validExecution({ executionId: 'exec-previous', state: 'completed', completedAt: '2026-08-17T18:45:00Z' }) },
                });

                const exec = await service.startExecution(USER_ID, 'exec-redo-2', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                    allowDuplicateCompleted: true,
                });

                expect(exec.executionId).toBe('exec-redo-2');
                expect(tx.set).toHaveBeenCalledTimes(2);
                const lockWrite = tx.set.mock.calls.find(call => (call[0] as { path: string }).path === LOCK_PATH);
                expect(lockWrite?.[1]).toMatchObject({ executionId: 'exec-redo-2' });
            });

            it('creates a new execution when the lock points at an execution doc that no longer exists (dangling pointer)', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-deleted', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    // No entry for exec-deleted's own path -- the transaction's get() falls
                    // back to { exists: false }, exactly like a doc that was removed.
                });

                const exec = await service.startExecution(USER_ID, 'exec-new', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-new');
                expect(tx.set).toHaveBeenCalledTimes(2);
            });

            it('creates a new execution when the lock points at an execution doc that fails to parse', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const badPath = `users/${USER_ID}/session_executions/exec-corrupt`;
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-corrupt', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    [badPath]: { exists: true, data: { not: 'a valid execution document' } },
                });

                const exec = await service.startExecution(USER_ID, 'exec-new', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-new');
                expect(tx.set).toHaveBeenCalledTimes(2);
            });

            it('creates a new execution when the lock points at an abandoned execution', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const abandonedPath = `users/${USER_ID}/session_executions/exec-abandoned`;
                const tx = makeTransactionMock({
                    [LOCK_PATH]: { exists: true, data: { userId: USER_ID, executionId: 'exec-abandoned', date: '2026-08-17', allowCompletedReplacement: false, updatedAt: '2026-08-17T18:00:01Z', schemaVersion: 1 } },
                    [abandonedPath]: { exists: true, data: validExecution({ executionId: 'exec-abandoned', state: 'abandoned' }) },
                });

                const exec = await service.startExecution(USER_ID, 'exec-new', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-new');
                expect(tx.set).toHaveBeenCalledTimes(2);
            });
        });

        describe('offline persistent-cache fallback', () => {
            it('queues the execution and lock in one atomic batch when transactions are unavailable offline', async () => {
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                firestore.runTransaction.mockRejectedValueOnce(
                    Object.assign(new Error('client is offline'), { code: 'unavailable' }),
                );
                const batch = makeWriteBatchMock();
                firestore.writeBatch.mockReturnValueOnce(batch);

                const exec = await service.startExecution(USER_ID, 'exec-offline', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    occurrenceId: 'occ-offline-1',
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-offline');
                expect(batch.set).toHaveBeenCalledTimes(2);
                expect(batch.commit).toHaveBeenCalledTimes(1);
                const lockWrite = batch.set.mock.calls.find(call =>
                    (call[0] as { path: string }).path.includes('/session_execution_locks/'));
                expect(lockWrite?.[1]).toMatchObject({
                    executionId: 'exec-offline',
                    date: '2026-08-17',
                    occurrenceId: 'occ-offline-1',
                    allowCompletedReplacement: false,
                });
            });

            it('returns the server winner if an offline queued claim later loses lock arbitration', async () => {
                firestore.getDocs
                    .mockResolvedValueOnce({ docs: [] })
                    .mockResolvedValueOnce({
                        docs: [{
                            id: 'exec-server-winner',
                            ref: { path: `users/${USER_ID}/session_executions/exec-server-winner` },
                            data: () => validExecution({
                                executionId: 'exec-server-winner',
                                occurrenceId: 'occ-offline-race',
                                state: 'in_progress',
                            }),
                        }],
                    });
                firestore.runTransaction.mockRejectedValueOnce(
                    Object.assign(new Error('client is offline'), { code: 'unavailable' }),
                );
                const batch = makeWriteBatchMock();
                batch.commit.mockRejectedValueOnce(
                    Object.assign(new Error('lock already claimed'), { code: 'permission-denied' }),
                );
                firestore.writeBatch.mockReturnValueOnce(batch);

                const exec = await service.startExecution(USER_ID, 'exec-offline-loser', {
                    sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                    occurrenceId: 'occ-offline-race',
                    date: '2026-08-17',
                });

                expect(exec.executionId).toBe('exec-server-winner');
                expect(batch.commit).toHaveBeenCalledTimes(1);
            });
        });

        describe('external execution identity across abandon (PR-B, #893 WP4.1)', () => {
            it('retains occurrenceId + sessionSource + prescriptionHash when an external execution is abandoned', async () => {
                // Identity, not outcome: the round-trip proof survives a partial/abandoned
                // run. Full partial/abandoned semantics belong to PR-C/PR-E.
                firestore.getDocs.mockResolvedValueOnce({ docs: [] });
                const tx = makeTransactionMock();
                const sessionSource = {
                    kind: 'external_plan', planId: 'plan-xyz', revision: 2,
                    sessionId: 'session-101', contentHash: 'c'.repeat(64),
                };

                const exec = await service.startExecution(USER_ID, 'exec-external', {
                    sessionSource: sessionSource as never,
                    date: '2026-09-06',
                    occurrenceId: 'occ-ext-created',
                    prescriptionHash: 'p'.repeat(64),
                });

                expect(exec).toMatchObject({
                    sessionSource, occurrenceId: 'occ-ext-created', prescriptionHash: 'p'.repeat(64),
                });
                const [, created] = tx.set.mock.calls[0] as [unknown, Record<string, unknown>];
                expect(created).toMatchObject({
                    sessionSource, occurrenceId: 'occ-ext-created', prescriptionHash: 'p'.repeat(64),
                });

                await service.transitionExecution(USER_ID, 'exec-external', 'abandoned');
                const [, patch, options] = firestore.setDoc.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>];
                expect(patch).toMatchObject({ state: 'abandoned' });
                expect(patch).not.toHaveProperty('occurrenceId');
                expect(patch).not.toHaveProperty('sessionSource');
                expect(patch).not.toHaveProperty('prescriptionHash');
                expect(options).toEqual({ merge: true });
            });
        });

        describe('findExecutionByOccurrenceId', () => {
            it('queries session_executions by occurrenceId and returns the most recent matching execution', async () => {
                firestore.query.mockImplementation((coll, ...clauses) => ({ coll, clauses }));
                firestore.where.mockImplementation((field, op, val) => ({ field, op, val }));
                firestore.getDocs.mockResolvedValueOnce({
                    docs: [
                        {
                            ref: { path: `users/${USER_ID}/session_executions/exec-old` },
                            data: () => validExecution({
                                executionId: 'exec-old',
                                occurrenceId: 'occ-123',
                                startedAt: '2026-08-17T10:00:00Z',
                            }),
                        },
                        {
                            ref: { path: `users/${USER_ID}/session_executions/exec-new` },
                            data: () => validExecution({
                                executionId: 'exec-new',
                                occurrenceId: 'occ-123',
                                startedAt: '2026-08-17T12:00:00Z',
                            }),
                        },
                    ],
                });

                const res = await service.findExecutionByOccurrenceId(USER_ID, 'occ-123');

                expect(firestore.where).toHaveBeenCalledWith('occurrenceId', '==', 'occ-123');
                expect(res).not.toBeNull();
                expect(res?.executionId).toBe('exec-new');
            });
        });
    });

    describe('findInProgressExecution', () => {
        it('queries Firestore with state == in_progress filter and returns the most recent startedAt execution', async () => {
            firestore.getDocs.mockResolvedValueOnce({
                docs: [
                    {
                        id: 'exec-older',
                        ref: { path: `users/${USER_ID}/session_executions/exec-older` },
                        data: () => validExecution({
                            executionId: 'exec-older',
                            state: 'in_progress',
                            startedAt: '2026-08-17T09:00:00.000Z',
                        }),
                    },
                    {
                        id: 'exec-newer',
                        ref: { path: `users/${USER_ID}/session_executions/exec-newer` },
                        data: () => validExecution({
                            executionId: 'exec-newer',
                            state: 'in_progress',
                            startedAt: '2026-08-17T10:00:00.000Z',
                        }),
                    },
                ],
            });

            const result = await service.findInProgressExecution(USER_ID);

            expect(firestore.query).toHaveBeenCalledWith(
                expect.anything(),
                where('state', '==', 'in_progress'),
            );
            expect(result?.executionId).toBe('exec-newer');
        });

        it('returns null when no in-progress execution exists', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [] });

            const result = await service.findInProgressExecution(USER_ID);

            expect(result).toBeNull();
        });
    });
});
