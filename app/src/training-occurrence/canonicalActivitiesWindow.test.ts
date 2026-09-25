import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const reconcileDateRangeForUser = vi.fn();
const getCompletedWorkoutsInRange = vi.fn();

vi.mock('./reconciliationService', () => ({ reconcileDateRangeForUser }));
vi.mock('./activitiesReadModelService', () => ({ getCompletedWorkoutsInRange }));

const { loadCanonicalActivitiesWindow } = await import('./canonicalActivitiesWindow');

describe('loadCanonicalActivitiesWindow', () => {
    beforeEach(() => {
        calls.length = 0;
        reconcileDateRangeForUser.mockReset().mockImplementation(async () => { calls.push('reconcile'); });
        getCompletedWorkoutsInRange.mockReset().mockImplementation(async () => { calls.push('read'); return []; });
    });

    it('reconciles the exact displayed window before reading it', async () => {
        await loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26');
        expect(reconcileDateRangeForUser).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26');
        expect(getCompletedWorkoutsInRange).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26');
        expect(calls).toEqual(['reconcile', 'read']);
    });

    it('still reads the canonical window when the sweep fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        reconcileDateRangeForUser.mockRejectedValue(new Error('boom'));
        const view = [{ performedOccurrenceId: 'o1' }];
        getCompletedWorkoutsInRange.mockResolvedValue(view);
        await expect(loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26')).resolves.toBe(view);
        warn.mockRestore();
    });
});
