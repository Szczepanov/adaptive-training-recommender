import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), getDocFromCache: vi.fn(), onSnapshot: vi.fn(), waitForPendingWrites: vi.fn(), collection: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), runTransaction: vi.fn(), writeBatch: vi.fn(), setDoc: vi.fn() }));
const diaryWrite = vi.hoisted(() => ({ commitDiaryWrite: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('./sessionDiaryWrite', () => diaryWrite);
vi.mock('./sessionDiaryReceipts', () => ({ readDiaryReceipts: vi.fn(() => []), removeDiaryReceipt: vi.fn(), saveDiaryReceipt: vi.fn() }));
import { SessionExecutionService } from './sessionExecutionService';

const userId = 'u1'; const executionId = 'exec-1'; const at = '2026-10-05T08:00:00.000Z';
const gauge = { scale: 'rir', value: 2 };
const performed = { id: 'set-1', executionId, stepId: 'squat', completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'repetition', setIndex: 2, reps: 5, weightKg: 100, gauge } };
const snap = (data?: Record<string, unknown>) => ({ exists: () => data !== undefined, data: () => data, metadata: { hasPendingWrites: false } });

type Mutation = { kind: string; before: typeof performed; after: Record<string, unknown> & { payload: Record<string, unknown> } };
const batchSets: unknown[][] = [];
const mutationWritten = (): Mutation => batchSets.map(args => args[1] as Mutation).find(value => value && 'kind' in value && 'before' in value)!;
const pathOf = (args: unknown[]) => (args[0] as { path: string }).path;

describe('SessionExecutionService set correction and undo (#724)', () => {
    let service: SessionExecutionService;
    beforeEach(() => {
        vi.clearAllMocks(); batchSets.length = 0; service = new SessionExecutionService();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), id: segments.at(-1) }));
        firestore.collection.mockReturnValue({});
        firestore.writeBatch.mockReturnValue({ set: (...args: unknown[]) => { batchSets.push(args); }, commit: vi.fn() });
        firestore.getDocFromCache.mockResolvedValue(snap(performed));
    });

    it('records a correction on the same entry, keeping timestamps, set index and gauge, with a before-image for audit', async () => {
        await service.correctEntry(userId, executionId, 'set-1', { payload: { kind: 'repetition', setIndex: 2, reps: 8, gauge } as never });
        const mutation = mutationWritten();
        expect(mutation.kind).toBe('correct');
        expect(mutation.before.payload).toMatchObject({ reps: 5, weightKg: 100 });
        expect(mutation.after).toMatchObject({ id: 'set-1', completedAt: at, createdAt: at });
        expect(mutation.after.payload).toEqual({ kind: 'repetition', setIndex: 2, reps: 8, gauge });
        expect(mutation.after.deletedAt).toBeUndefined();
    });

    it('rejects a correction that tries to move the set to a different time or identity', async () => {
        await expect(service.correctEntry(userId, executionId, 'set-1', { createdAt: '2026-10-05T09:00:00.000Z' })).rejects.toThrow('identity');
        await expect(service.correctEntry(userId, executionId, 'set-1', { id: 'other' })).rejects.toThrow('identity');
        expect(diaryWrite.commitDiaryWrite).not.toHaveBeenCalled();
    });

    it('undoes a just-logged set as a delete tombstone of the same entry, not a compensating set', async () => {
        await service.deleteEntry(userId, executionId, 'set-1');
        expect(diaryWrite.commitDiaryWrite).toHaveBeenCalledOnce();
        const mutation = mutationWritten();
        expect(mutation.kind).toBe('delete');
        expect(mutation.after).toMatchObject({ id: 'set-1', completedAt: at, payload: performed.payload });
        expect(typeof mutation.after.deletedAt).toBe('string');
        expect(batchSets.filter(args => pathOf(args).includes('/entries/'))).toHaveLength(1);
        expect(batchSets.filter(args => pathOf(args).endsWith('/entries/set-1'))).toHaveLength(1);
    });

    it('treats a repeated undo as a no-op once the tombstone exists', async () => {
        firestore.getDocFromCache.mockResolvedValue(snap({ ...performed, deletedAt: at }));
        await service.deleteEntry(userId, executionId, 'set-1');
        expect(diaryWrite.commitDiaryWrite).not.toHaveBeenCalled();
    });
});
