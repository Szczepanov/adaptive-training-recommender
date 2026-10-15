import { describe, expect, it, vi } from 'vitest';
import { runExclusive } from './runExclusive';

describe('runExclusive', () => {
    it('drops a second attempt made while the first is still pending', async () => {
        const lock = { current: false };
        let release!: () => void;
        const action = vi.fn(() => new Promise<string>(resolve => { release = () => resolve('done'); }));
        const first = runExclusive(lock, action);
        const second = runExclusive(lock, action);
        expect(await second).toBeUndefined();
        release();
        expect(await first).toBe('done');
        expect(action).toHaveBeenCalledOnce();
    });

    it('releases the lock after completion and after a rejection so a retry is possible', async () => {
        const lock = { current: false };
        await expect(runExclusive(lock, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        expect(lock.current).toBe(false);
        expect(await runExclusive(lock, async () => 'ok')).toBe('ok');
    });
});
