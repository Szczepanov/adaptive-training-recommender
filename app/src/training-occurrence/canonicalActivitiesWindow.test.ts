import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const reconcileDateRangeForUser = vi.fn();
const getCompletedWorkoutsInRange = vi.fn();

vi.mock('./reconciliationService', () => ({ reconcileDateRangeForUser }));
vi.mock('./activitiesReadModelService', () => ({ getCompletedWorkoutsInRange }));

const { loadCanonicalActivitiesWindow } = await import('./canonicalActivitiesWindow');

const cleanSweep = { executionsProcessed: 1, activitiesProcessed: 1, activitiesReadable: true, sourceErrors: 0 };

describe('loadCanonicalActivitiesWindow', () => {
    beforeEach(() => {
        calls.length = 0;
        reconcileDateRangeForUser.mockReset().mockImplementation(async () => { calls.push('reconcile'); return cleanSweep; });
        getCompletedWorkoutsInRange.mockReset().mockImplementation(async () => { calls.push('read'); return []; });
    });

    it('reconciles the exact displayed window before reading it', async () => {
        const window = await loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26');
        expect(reconcileDateRangeForUser).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26');
        expect(getCompletedWorkoutsInRange).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26', undefined, { reconciliationSweep: 'completed' });
        expect(calls).toEqual(['reconcile', 'read']);
        expect(window).toEqual({ status: 'available', workouts: [], reconciliationSweep: 'completed' });
    });

    it('still reads the canonical window when the sweep fails, and reports the failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        reconcileDateRangeForUser.mockRejectedValue(new Error('boom'));
        const view = [{ performedOccurrenceId: 'o1' }];
        getCompletedWorkoutsInRange.mockResolvedValue(view);
        const window = await loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26');
        expect(window).toEqual({ status: 'available', workouts: view, reconciliationSweep: 'failed' });
        // The failure is reported to the read model, not just logged, so "no candidate" is
        // never asserted for sources that were not freshly evaluated (#895 WP5).
        expect(window.reconciliationSweep).toBe('failed');
        expect(getCompletedWorkoutsInRange).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26', undefined, { reconciliationSweep: 'failed' });
        warn.mockRestore();
    });

    it('keeps the sweep outcome when the canonical read itself fails, instead of losing it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        getCompletedWorkoutsInRange.mockRejectedValue(new Error('projection exploded'));
        await expect(loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26'))
            .resolves.toEqual({ status: 'projection_failed', reconciliationSweep: 'completed' });

        reconcileDateRangeForUser.mockResolvedValue({ ...cleanSweep, sourceErrors: 2 });
        await expect(loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26'))
            .resolves.toEqual({ status: 'projection_failed', reconciliationSweep: 'incomplete' });
        warn.mockRestore();
    });

    it.each([
        ['an unreadable Activities collection', { ...cleanSweep, activitiesReadable: false }],
        ['a per-source reconciliation error', { ...cleanSweep, sourceErrors: 1 }],
    ])('reports an incomplete sweep for %s even though the sweep did not throw', async (_label, summary) => {
        reconcileDateRangeForUser.mockResolvedValue(summary);
        const window = await loadCanonicalActivitiesWindow('u1', '2026-09-19', '2026-09-26');
        expect(window).toMatchObject({ status: 'available', reconciliationSweep: 'incomplete' });
        expect(getCompletedWorkoutsInRange).toHaveBeenCalledWith('u1', '2026-09-19', '2026-09-26', undefined, { reconciliationSweep: 'incomplete' });
    });
});
