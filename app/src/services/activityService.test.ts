import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityService, activityService } from './activityService';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    getDocs: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

const mockValidActivityData = {
    activityId: 'act-1',
    date: '2026-08-10',
    type: 'running',
    durationMin: 30,
    trainingEffectAerobic: 2.5,
    trainingEffectAnaerobic: null,
    averageHr: 140,
    activityTrainingLoad: 50,
    intensityTag: 'moderate',
    syncedAt: '2026-08-10T10:00:00Z',
};

describe('ActivityService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'users/user-1/activities' });
        firestore.query.mockReturnValue({ path: 'users/user-1/activities/query' });
        firestore.where.mockImplementation((field, op, val) => ({ field, op, val }));
        firestore.orderBy.mockImplementation((field, dir) => ({ field, dir }));
    });

    it('exports a singleton instance activityService', () => {
        expect(activityService).toBeInstanceOf(ActivityService);
    });

    it('returns AVAILABLE state with sorted revision string for valid activities in range', async () => {
        firestore.getDocs.mockResolvedValueOnce({
            docs: [
                {
                    id: 'act-2',
                    data: () => ({ ...mockValidActivityData, activityId: 'act-2', date: '2026-08-11', syncedAt: '2026-08-11T12:00:00Z' }),
                },
                {
                    id: 'act-1',
                    data: () => ({ ...mockValidActivityData, activityId: 'act-1', date: '2026-08-10', syncedAt: '2026-08-10T10:00:00Z' }),
                },
            ],
        });

        const service = new ActivityService();
        const result = await service.getActivitiesInRange('user-1', '2026-08-10', '2026-08-12');

        expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'activities');
        expect(firestore.where).toHaveBeenCalledWith('date', '>=', '2026-08-10');
        expect(firestore.where).toHaveBeenCalledWith('date', '<', '2026-08-12');
        expect(firestore.orderBy).toHaveBeenCalledWith('date', 'asc');

        expect(result).toEqual({
            status: 'AVAILABLE',
            data: [
                expect.objectContaining({ activityId: 'act-2', date: '2026-08-11' }),
                expect.objectContaining({ activityId: 'act-1', date: '2026-08-10' }),
            ],
            revision: 'act-1:2026-08-10T10:00:00Z|act-2:2026-08-11T12:00:00Z',
        });
    });

    it('returns revision null when activities have no revision/syncedAt field', async () => {
        const dataWithoutSyncedAt = { ...mockValidActivityData };
        delete (dataWithoutSyncedAt as { syncedAt?: string }).syncedAt;

        firestore.getDocs.mockResolvedValueOnce({
            docs: [
                {
                    id: 'act-1',
                    data: () => dataWithoutSyncedAt,
                },
            ],
        });

        const service = new ActivityService();
        const result = await service.getActivitiesInRange('user-1', '2026-08-10', '2026-08-12');

        expect(result).toEqual({
            status: 'AVAILABLE',
            data: [expect.objectContaining({ activityId: 'act-1' })],
            revision: null,
        });
    });

    it('returns INVALID state with aggregated issues when corrupt documents exist', async () => {
        firestore.getDocs.mockResolvedValueOnce({
            docs: [
                {
                    id: 'act-invalid',
                    data: () => ({ ...mockValidActivityData, date: 'invalid-date-format' }),
                },
            ],
        });

        const service = new ActivityService();
        const result = await service.getActivitiesInRange('user-1', '2026-08-10', '2026-08-12');

        expect(result).toEqual({
            status: 'INVALID',
            issues: [expect.objectContaining({ field: 'date', code: 'invalid-date' })],
        });
    });

    it('returns UNAVAILABLE with retryable true for non-permission errors', async () => {
        firestore.getDocs.mockRejectedValueOnce(new Error('Network connectivity issue'));

        const service = new ActivityService();
        const result = await service.getActivitiesInRange('user-1', '2026-08-10', '2026-08-12');

        expect(result).toEqual({
            status: 'UNAVAILABLE',
            operation: 'read activities history',
            retryable: true,
        });
    });

    it('returns UNAVAILABLE with retryable false for permission-denied errors', async () => {
        firestore.getDocs.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions' });

        const service = new ActivityService();
        const result = await service.getActivitiesInRange('user-1', '2026-08-10', '2026-08-12');

        expect(result).toEqual({
            status: 'UNAVAILABLE',
            operation: 'read activities history',
            retryable: false,
        });
    });
});
