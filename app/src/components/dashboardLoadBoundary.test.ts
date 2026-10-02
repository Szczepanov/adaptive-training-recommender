import { describe, expect, it, vi } from 'vitest';
import {
    DashboardRequiredSourceError,
    loadRequiredDashboardSource,
    loadSecondaryDashboardData,
} from './dashboardLoadBoundary';

describe('dashboard load boundary', () => {
    it('wraps a required same-day source failure so Home can explain the blocking input', async () => {
        const cause = new Error('permission denied');

        await expect(loadRequiredDashboardSource(
            'performed-training-facts',
            async () => { throw cause; },
        )).rejects.toMatchObject({
            name: 'DashboardRequiredSourceError',
            source: 'performed-training-facts',
            originalError: cause,
        });
    });

    it('returns required same-day data unchanged when the source succeeds', async () => {
        await expect(loadRequiredDashboardSource(
            'performed-training-facts',
            async () => ({ revision: 'facts-r1' }),
        )).resolves.toEqual({ revision: 'facts-r1' });
    });

    it('fails soft for secondary projections instead of taking down today\'s dashboard', async () => {
        const onFailure = vi.fn();
        const cause = new Error('forecast source unavailable');

        await expect(loadSecondaryDashboardData(
            'next-day forecast',
            async () => { throw cause; },
            onFailure,
        )).resolves.toBeNull();
        expect(onFailure).toHaveBeenCalledWith(cause);
    });

    it('returns a secondary projection when it succeeds', async () => {
        await expect(loadSecondaryDashboardData(
            'next-day forecast',
            async () => ({ date: '2026-10-03' }),
        )).resolves.toEqual({ date: '2026-10-03' });
    });

    it('preserves the dedicated required-source error type', () => {
        expect(new DashboardRequiredSourceError('performed-training-facts', new Error('x')))
            .toBeInstanceOf(Error);
    });
});
