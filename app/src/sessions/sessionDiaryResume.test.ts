import { describe, expect, it } from 'vitest';
import type { SessionEntry } from './models';
import type { DiaryReceipt } from '../services/sessionDiaryReceipts';
import { overlayQueuedDiaryState } from './sessionDiaryResume';

const at = '2026-10-05T10:00:00.000Z';

function entry(reps: number, overrides: Partial<SessionEntry> = {}): SessionEntry {
    return {
        id: 'entry-1',
        executionId: 'exec-1',
        stepId: 'step-1',
        completedAt: at,
        createdAt: at,
        updatedAt: at,
        payload: { kind: 'repetition', setIndex: 1, reps },
        ...overrides,
    };
}

function receipt(
    id: string,
    before: SessionEntry | null,
    after: SessionEntry,
    state: DiaryReceipt['state'] = 'queued',
): DiaryReceipt {
    return {
        state,
        mutation: {
            id,
            executionId: 'exec-1',
            targetId: after.id,
            targetKind: 'entry',
            kind: before ? 'correct' : 'log',
            at: after.updatedAt,
            before,
            after,
        },
    };
}

describe('overlayQueuedDiaryState', () => {
    it('treats a causally-valid queued add as provisional performed state', () => {
        const added = entry(5);
        const result = overlayQueuedDiaryState([], null, [receipt('m1', null, added)]);
        expect(result.status).toBe('ready');
        expect(result.entries).toEqual([added]);
        expect(result.queuedReceiptCount).toBe(1);
    });

    it('replays a valid same-target queued mutation chain in order', () => {
        const first = entry(5, { updatedAt: '2026-10-05T10:00:01.000Z' });
        const corrected = entry(7, { updatedAt: '2026-10-05T10:00:02.000Z' });
        const result = overlayQueuedDiaryState([], null, [
            receipt('m2', first, corrected),
            receipt('m1', null, first),
        ]);
        expect(result.status).toBe('ready');
        expect(result.entries[0]?.payload).toMatchObject({ kind: 'repetition', reps: 7 });
    });

    it('degrades rather than inventing order when queued before/after bytes do not form a causal chain', () => {
        const first = entry(5, { updatedAt: '2026-10-05T10:00:01.000Z' });
        const unrelatedBefore = entry(99, { updatedAt: '2026-10-05T10:00:01.500Z' });
        const corrected = entry(7, { updatedAt: '2026-10-05T10:00:02.000Z' });
        const result = overlayQueuedDiaryState([], null, [
            receipt('m1', null, first),
            receipt('m2', unrelatedBefore, corrected),
        ]);
        expect(result).toMatchObject({ status: 'degraded', reason: 'queued-diary-causal-conflict' });
    });

    it('never counts failed receipts as performed work', () => {
        const result = overlayQueuedDiaryState([], null, [receipt('m1', null, entry(5), 'failed')]);
        expect(result.status).toBe('ready');
        expect(result.entries).toEqual([]);
        expect(result.failedReceiptCount).toBe(1);
        expect(result.queuedReceiptCount).toBe(0);
    });

    it('ignores queued rest receipts so reload never reconstructs an in-flight rest', () => {
        const restReceipt: DiaryReceipt = {
            state: 'queued',
            mutation: {
                id: 'rest-m1',
                executionId: 'exec-1',
                targetId: 'rest-1',
                targetKind: 'rest',
                kind: 'rest',
                at,
                before: null,
                after: {
                    id: 'rest-1',
                    executionId: 'exec-1',
                    afterEntryId: 'entry-1',
                    startedAt: at,
                    endedAt: at,
                    actualSeconds: 0,
                    endReason: 'session_ended',
                    createdAt: at,
                    updatedAt: at,
                },
            },
        };
        const result = overlayQueuedDiaryState([], null, [restReceipt]);
        expect(result.status).toBe('ready');
        expect(result.entries).toEqual([]);
        expect(result.queuedReceiptCount).toBe(0);
    });
});
