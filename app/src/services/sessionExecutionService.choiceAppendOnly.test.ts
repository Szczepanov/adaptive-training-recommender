import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), getDocFromCache: vi.fn(), onSnapshot: vi.fn(), waitForPendingWrites: vi.fn(), collection: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), runTransaction: vi.fn(), writeBatch: vi.fn() }));
const diaryWrite = vi.hoisted(() => ({ commitDiaryWrite: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('./sessionDiaryWrite', () => diaryWrite);
vi.mock('./sessionDiaryReceipts', () => ({ readDiaryReceipts: vi.fn(() => []), removeDiaryReceipt: vi.fn(), saveDiaryReceipt: vi.fn() }));
import { SessionExecutionService } from './sessionExecutionService';

const userId = 'u1'; const executionId = 'exec-1'; const at = '2026-10-05T08:00:00Z';
const choice = { id: 'choice-1', executionId, completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'choice', choiceId: 'c1', optionId: 'o1' } };
const performed = { id: 'set-1', executionId, completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'repetition', setIndex: 1, reps: 5 } };
function snap(data?: Record<string, unknown>) { return { exists: () => data !== undefined, data: () => data, metadata: { hasPendingWrites: false } }; }

describe('SessionExecutionService append-only choices', () => {
    let service: SessionExecutionService;
    beforeEach(() => {
        vi.clearAllMocks(); service = new SessionExecutionService();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), id: segments.at(-1) }));
        firestore.collection.mockReturnValue({}); firestore.writeBatch.mockReturnValue({ set: vi.fn(), commit: vi.fn() });
        firestore.waitForPendingWrites.mockResolvedValue(undefined); firestore.getDoc.mockResolvedValue(snap());
    });

    it('rejects generic correct/delete/restore for choices before diary persistence', async () => {
        firestore.getDocFromCache.mockResolvedValue(snap(choice));
        await expect(service.correctEntry(userId, executionId, 'choice-1', { payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2' } } as never)).rejects.toThrow('append-only');
        await expect(service.deleteEntry(userId, executionId, 'choice-1')).rejects.toThrow('append-only');
        firestore.getDocFromCache.mockResolvedValue(snap({ ...choice, deletedAt: at }));
        await expect(service.restoreEntry(userId, executionId, 'choice-1')).rejects.toThrow('append-only');
        expect(diaryWrite.commitDiaryWrite).not.toHaveBeenCalled();
    });

    it('keeps ordinary performed-entry correction working', async () => {
        firestore.getDocFromCache.mockResolvedValue(snap(performed));
        await service.correctEntry(userId, executionId, 'set-1', { payload: { kind: 'repetition', setIndex: 1, reps: 6 } } as never);
        expect(diaryWrite.commitDiaryWrite).toHaveBeenCalledOnce();
    });

    it('accepts same-choice supersession and rejects cross-kind/cross-choice references', async () => {
        firestore.getDocFromCache.mockImplementation(async (ref: { path: string }) => ref.path.endsWith('/choice-1') ? snap(choice) : snap());
        await service.logEntry(userId, executionId, { ...choice, id: 'choice-2', supersedesChoiceEntryId: 'choice-1', payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2' } } as never);
        expect(diaryWrite.commitDiaryWrite).toHaveBeenCalledOnce();

        diaryWrite.commitDiaryWrite.mockClear();
        firestore.getDocFromCache.mockResolvedValue(snap(performed));
        await expect(service.logEntry(userId, executionId, { ...choice, id: 'choice-3', supersedesChoiceEntryId: 'set-1' } as never)).rejects.toThrow('same authored choice');
        expect(diaryWrite.commitDiaryWrite).not.toHaveBeenCalled();
    });

    it('requires governing performed references to resolve to a live choice event', async () => {
        firestore.getDocFromCache.mockImplementation(async (ref: { path: string }) => ref.path.endsWith('/choice-1') ? snap(choice) : snap());
        await service.logEntry(userId, executionId, { ...performed, governingChoiceEntryId: 'choice-1', selectedOptionId: 'o1' } as never);
        expect(diaryWrite.commitDiaryWrite).toHaveBeenCalledOnce();

        diaryWrite.commitDiaryWrite.mockClear();
        await expect(service.logEntry(userId, executionId, { ...performed, id: 'set-2', governingChoiceEntryId: 'choice-1', selectedOptionId: 'wrong-option' } as never))
            .rejects.toThrow('option governed');
        expect(diaryWrite.commitDiaryWrite).not.toHaveBeenCalled();
    });
});
