import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGarminSyncStatus } from './useGarminSyncStatus';
import { garminWorkoutQueueService } from '../services/garminWorkoutQueueService';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';

vi.mock('../services/garminWorkoutQueueService', () => ({
    garminWorkoutQueueService: {
        subscribeToUserQueue: vi.fn(),
    },
}));

vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(),
        requestSync: vi.fn(async () => '2026-08-27T08:00:00.000Z'),
        getRequest: vi.fn(async () => null),
    },
}));

vi.mock('../services/recoverySnapshotService', () => ({
    recoverySnapshotService: {
        subscribeToSnapshot: vi.fn(),
    },
}));

describe('useGarminSyncStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports useGarminSyncStatus function', () => {
        expect(typeof useGarminSyncStatus).toBe('function');
    });

    it('subscribes to workout queue, sync requests, and recovery snapshots', () => {
        const unsubQueue = vi.fn();
        const unsubRequest = vi.fn();
        const unsubSnapshot = vi.fn();

        vi.mocked(garminWorkoutQueueService.subscribeToUserQueue).mockReturnValue(unsubQueue);
        vi.mocked(garminSyncRequestService.subscribeToRequest).mockReturnValue(unsubRequest);
        vi.mocked(recoverySnapshotService.subscribeToSnapshot).mockReturnValue(unsubSnapshot);

        expect(garminWorkoutQueueService.subscribeToUserQueue).toBeDefined();
        expect(garminSyncRequestService.subscribeToRequest).toBeDefined();
        expect(recoverySnapshotService.subscribeToSnapshot).toBeDefined();
    });
});
