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
            startDate: '2026-08-01', endDate: '2026-08-31', unavailableSources: [],
            report: { generatedFrom: 'activity-history', summary: { totalActivities: 0 } },
        });
    });

    it('does not turn an unavailable activity source into an empty replay', async () => {
        services.getActivitiesInRange.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });

        const result = await new ActivityHrFidelityReplayService().build('u1', '2026-08-01', '2026-08-01');

        expect(result.report).toBeNull();
        expect(result.unavailableSources).toEqual(['activities']);
    });

    it('reports malformed persisted activity history explicitly', async () => {
        services.getActivitiesInRange.mockResolvedValue({ status: 'INVALID', issues: [] });

        const result = await new ActivityHrFidelityReplayService().build('u1', '2026-08-01', '2026-08-01');

        expect(result.report).toBeNull();
        expect(result.unavailableSources).toEqual(['activities (invalid record)']);
    });
});
