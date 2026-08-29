import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ getActivitiesInRange: vi.fn() }));

vi.mock('./activityService', () => ({ activityService: { getActivitiesInRange: services.getActivitiesInRange } }));

import { ActivityHrFidelityReplayService } from './activityHrFidelityReplayService';

describe('ActivityHrFidelityReplayService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reads an inclusive Warsaw-date range through the following day and builds a shadow report', async () => {
        services.getActivitiesInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });

        const result = await new ActivityHrFidelityReplayService().build('u1', '2026-08-01', '2026-08-31');

        expect(services.getActivitiesInRange).toHaveBeenCalledWith('u1', '2026-08-01', '2026-09-01');
        expect(result).toMatchObject({
            startDate: '2026-08-01', endDate: '2026-08-31', inputIssues: [], unavailableSources: [],
            report: { generatedFrom: 'activity-history', summary: { totalActivities: 0 } },
        });
    });

    it.each([
        ['2026-02-30', '2026-03-01'],
        ['2026-08-02', '2026-08-01'],
        ['2026/08/01', '2026-08-01'],
    ])('rejects an invalid replay range before reading activities (%s..%s)', async (startDate, endDate) => {
        const result = await new ActivityHrFidelityReplayService().build('u1', startDate, endDate);

        expect(services.getActivitiesInRange).not.toHaveBeenCalled();
        expect(result.report).toBeNull();
        expect(result.unavailableSources).toEqual([]);
        expect(result.inputIssues).toEqual([
            'Replay range must use valid YYYY-MM-DD dates with startDate <= endDateInclusive.',
        ]);
    });

    it('does not turn an unavailable activity source into an empty replay', async () => {
        services.getActivitiesInRange.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });

        const result = await new ActivityHrFidelityReplayService().build('u1', '2026-08-01', '2026-08-01');

        expect(result.report).toBeNull();
        expect(result.inputIssues).toEqual([]);
        expect(result.unavailableSources).toEqual(['activities']);
    });

    it('reports malformed persisted activity history explicitly', async () => {
        services.getActivitiesInRange.mockResolvedValue({ status: 'INVALID', issues: [] });

        const result = await new ActivityHrFidelityReplayService().build('u1', '2026-08-01', '2026-08-01');

        expect(result.report).toBeNull();
        expect(result.inputIssues).toEqual([]);
        expect(result.unavailableSources).toEqual(['activities (invalid record)']);
    });
});
