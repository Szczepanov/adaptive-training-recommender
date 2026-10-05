import { describe, expect, it, vi } from 'vitest';
import type { DocumentReference, WriteBatch } from 'firebase/firestore';

const firestore = vi.hoisted(() => ({ onSnapshot: vi.fn() }));
vi.mock('firebase/firestore', () => firestore);
import { commitDiaryWrite } from './sessionDiaryWrite';

type MarkerSnapshot = {
    exists: () => boolean;
    metadata: { hasPendingWrites: boolean };
};

describe('commitDiaryWrite', () => {
    it('accepts only after this write has a pending local marker, without waiting for the server', async () => {
        let emit!: (snapshot: MarkerSnapshot) => void;
        const stop = vi.fn();
        firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => { emit = next; return stop; });
        let acknowledge!: () => void;
        const commit = new Promise<void>(resolve => { acknowledge = resolve; });
        const onAcknowledged = vi.fn();
        let accepted = false;
        const result = commitDiaryWrite({ commit: () => commit } as WriteBatch, {} as DocumentReference,
            { acknowledgeLocally: true, onAcknowledged }).then(() => { accepted = true; });
        emit({ exists: () => false, metadata: { hasPendingWrites: false } });
        await Promise.resolve();
        expect(accepted).toBe(false);
        // A deterministic marker may already exist in cache from an earlier acknowledged
        // attempt. Existence alone must not prove that this batch has entered the local queue.
        emit({ exists: () => true, metadata: { hasPendingWrites: false } });
        await Promise.resolve();
        expect(accepted).toBe(false);
        emit({ exists: () => true, metadata: { hasPendingWrites: true } });
        await result;
        expect(stop).toHaveBeenCalledOnce();
        expect(onAcknowledged).not.toHaveBeenCalled();
        acknowledge();
        await commit;
        await Promise.resolve();
        expect(onAcknowledged).toHaveBeenCalledOnce();
    });

    it('reports backend rejection even after local acceptance', async () => {
        let emit!: (snapshot: MarkerSnapshot) => void;
        firestore.onSnapshot.mockImplementationOnce((_ref, _options, next) => { emit = next; return vi.fn(); });
        let reject!: (error: unknown) => void;
        const commit = new Promise<void>((_resolve, fail) => { reject = fail; });
        const onFailed = vi.fn();
        const local = commitDiaryWrite({ commit: () => commit } as WriteBatch, {} as DocumentReference,
            { acknowledgeLocally: true, onFailed });
        emit({ exists: () => true, metadata: { hasPendingWrites: true } });
        await local;
        const error = new Error('permission-denied');
        reject(error);
        await Promise.resolve();
        expect(onFailed).toHaveBeenCalledWith(error);
    });

    it('waits for server acknowledgement by default and propagates rejection', async () => {
        const error = new Error('permission-denied');
        await expect(commitDiaryWrite({ commit: () => Promise.reject(error) } as WriteBatch,
            {} as DocumentReference)).rejects.toBe(error);
    });
});
