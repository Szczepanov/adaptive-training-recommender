import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    queryEqual: vi.fn((left: { key: string }, right: { key: string }) => left.key === right.key),
}));

vi.mock('firebase/firestore', () => firestore);

import {
    READ_RETENTION_IDLE_MS,
    READ_RETENTION_MAX_LISTENERS,
    getDocRetained,
    getDocsRetained,
    releaseRetainedReads,
    retainedReadCount,
} from './firestoreReadRetention';

const ref = (path: string) => ({ path }) as never;

describe('getDocRetained', () => {
    const unsubscribers = new Map<string, ReturnType<typeof vi.fn>>();
    const errorHandlers = new Map<string, () => void>();

    beforeEach(() => {
        vi.useFakeTimers();
        unsubscribers.clear();
        errorHandlers.clear();
        firestore.getDoc.mockReset().mockImplementation(async (target: { path: string }) => ({ path: target.path }));
        firestore.getDocs.mockReset().mockImplementation(async (target: { key: string }) => ({ key: target.key }));
        firestore.onSnapshot.mockReset().mockImplementation((target: { path?: string; key?: string }, _next: unknown, onError: () => void) => {
            const unsubscribe = vi.fn();
            const id = target.path ?? `query:${target.key}`;
            unsubscribers.set(id, unsubscribe);
            errorHandlers.set(id, onError);
            return unsubscribe;
        });
    });

    afterEach(() => {
        releaseRetainedReads();
        vi.useRealTimers();
    });

    it('returns exactly what getDoc returns, so read semantics are unchanged', async () => {
        await expect(getDocRetained(ref('users/u1/preferences/profile'))).resolves.toEqual({ path: 'users/u1/preferences/profile' });
        expect(firestore.getDoc).toHaveBeenCalledTimes(1);
    });

    it('starts the retaining listener before the read so the read reuses its watch target', async () => {
        await getDocRetained(ref('users/u1/a/1'));
        expect(firestore.onSnapshot.mock.invocationCallOrder[0]).toBeLessThan(firestore.getDoc.mock.invocationCallOrder[0]);
    });

    it('keeps one listener per document across repeated reads', async () => {
        await getDocRetained(ref('users/u1/a/1'));
        await getDocRetained(ref('users/u1/a/1'));
        await getDocRetained(ref('users/u1/a/2'));
        expect(firestore.onSnapshot).toHaveBeenCalledTimes(2);
        expect(firestore.getDoc).toHaveBeenCalledTimes(3);
        expect(retainedReadCount()).toBe(2);
    });

    it('releases a listener after the idle window, measured from its last read', async () => {
        await getDocRetained(ref('users/u1/a/1'));
        vi.advanceTimersByTime(READ_RETENTION_IDLE_MS - 1);
        await getDocRetained(ref('users/u1/a/1'));
        vi.advanceTimersByTime(READ_RETENTION_IDLE_MS - 1);
        expect(unsubscribers.get('users/u1/a/1')).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(unsubscribers.get('users/u1/a/1')).toHaveBeenCalledTimes(1);
        expect(retainedReadCount()).toBe(0);
    });

    it('drops a listener that errors (for example permission denied) and retains afresh on the next read', async () => {
        await getDocRetained(ref('users/u1/a/1'));
        errorHandlers.get('users/u1/a/1')?.();
        expect(retainedReadCount()).toBe(0);
        await getDocRetained(ref('users/u1/a/1'));
        expect(firestore.onSnapshot).toHaveBeenCalledTimes(2);
    });

    it('still propagates a getDoc failure to the caller', async () => {
        firestore.getDoc.mockRejectedValueOnce(new Error('unavailable'));
        await expect(getDocRetained(ref('users/u1/a/1'))).rejects.toThrow('unavailable');
    });

    it('reads without retention when the listener cannot be created', async () => {
        firestore.onSnapshot.mockImplementationOnce(() => { throw new Error('bad ref'); });
        await expect(getDocRetained(ref('users/u1/a/1'))).resolves.toEqual({ path: 'users/u1/a/1' });
        expect(retainedReadCount()).toBe(0);
    });

    it('evicts the least recently read listener beyond the cap', async () => {
        for (let index = 0; index < READ_RETENTION_MAX_LISTENERS; index += 1) {
            await getDocRetained(ref(`users/u1/a/${index}`));
        }
        await getDocRetained(ref('users/u1/a/0'));
        await getDocRetained(ref('users/u1/a/new'));
        expect(retainedReadCount()).toBe(READ_RETENTION_MAX_LISTENERS);
        expect(unsubscribers.get('users/u1/a/1')).toHaveBeenCalledTimes(1);
        expect(unsubscribers.get('users/u1/a/0')).not.toHaveBeenCalled();
    });

    it('releases every listener on demand, as on sign-out', async () => {
        await getDocRetained(ref('users/u1/a/1'));
        await getDocRetained(ref('users/u1/a/2'));
        releaseRetainedReads();
        expect(unsubscribers.get('users/u1/a/1')).toHaveBeenCalledTimes(1);
        expect(unsubscribers.get('users/u1/a/2')).toHaveBeenCalledTimes(1);
        expect(retainedReadCount()).toBe(0);
        vi.advanceTimersByTime(READ_RETENTION_IDLE_MS);
        expect(unsubscribers.get('users/u1/a/1')).toHaveBeenCalledTimes(1);
    });

    describe('queries', () => {
        const query = (key: string) => ({ key }) as never;

        it('returns exactly what getDocs returns and keeps one listener per equal query', async () => {
            await expect(getDocsRetained(query('goals'))).resolves.toEqual({ key: 'goals' });
            await getDocsRetained(query('goals'));
            await getDocsRetained(query('activities'));
            expect(firestore.onSnapshot).toHaveBeenCalledTimes(2);
            expect(firestore.getDocs).toHaveBeenCalledTimes(3);
            expect(retainedReadCount()).toBe(2);
        });

        it('releases a query listener after the idle window and on error', async () => {
            await getDocsRetained(query('goals'));
            await getDocsRetained(query('activities'));
            errorHandlers.get('query:activities')?.();
            expect(retainedReadCount()).toBe(1);
            vi.advanceTimersByTime(READ_RETENTION_IDLE_MS);
            expect(unsubscribers.get('query:goals')).toHaveBeenCalledTimes(1);
            expect(retainedReadCount()).toBe(0);
        });

        it('reads without retention when queries cannot be compared', async () => {
            firestore.queryEqual.mockImplementation(() => { throw new Error('not a query'); });
            await getDocsRetained(query('goals'));
            await expect(getDocsRetained(query('goals'))).resolves.toEqual({ key: 'goals' });
            expect(firestore.getDocs).toHaveBeenCalledTimes(2);
            firestore.queryEqual.mockImplementation((left: { key: string }, right: { key: string }) => left.key === right.key);
        });
    });
});
