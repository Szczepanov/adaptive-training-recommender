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

        it('persists a rest event via setDoc using the caller-supplied id', async () => {
            await service.logRestEvent(USER_ID, EXECUTION_ID, validRestEvent() as never);
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const [, payload] = firestore.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
            expect(payload).toMatchObject({ id: 'rest-1', afterEntryId: 'entry-1', endReason: 'timer_elapsed', actualSeconds: 90 });
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
        it('creates a new execution when none exists', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [] });

            const exec = await service.startExecution(USER_ID, 'exec-new', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
            });

            expect(exec.executionId).toBe('exec-new');
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
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

            const exec = await service.startExecution(USER_ID, 'exec-redo', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                date: '2026-08-17',
                allowDuplicateCompleted: true,
            });

            expect(exec.executionId).toBe('exec-redo');
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        });
    });
});
