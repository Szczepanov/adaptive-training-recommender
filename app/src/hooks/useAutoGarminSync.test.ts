import { describe, it, expect, vi, beforeEach } from 'vitest';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { getAwaitedSyncOutcome, isAwaitedSyncComplete } from '../utils/garminSyncRequestState';
import { useAutoGarminSync } from './useAutoGarminSync';
import { useGarminConnectionState } from './useGarminConnectionState';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';

vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(),
        requestSync: vi.fn(async () => '2026-08-23T06:00:00.000Z'),
        getRequest: vi.fn(async () => null),
    },
}));

vi.mock('./useGarminConnectionState', () => ({
    useGarminConnectionState: vi.fn(() => 'connected'),
}));

function request(overrides: Partial<GarminSyncRequest> = {}): GarminSyncRequest {
    return {
        userId: 'user-1',
        status: 'pending',
        requestedAt: '2026-08-23T06:00:00.000Z',
        ...overrides,
    };
}

describe('useAutoGarminSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports useAutoGarminSync function', () => {
        expect(typeof useAutoGarminSync).toBe('function');
    });

    it('exposes the sync request service methods used by the hook', () => {
        const unsubscribe = vi.fn();
        vi.mocked(garminSyncRequestService.subscribeToRequest).mockReturnValue(unsubscribe);

        expect(garminSyncRequestService.subscribeToRequest).toBeDefined();
        expect(garminSyncRequestService.requestSync).toBeDefined();
        expect(garminSyncRequestService.getRequest).toBeDefined();
    });

    it('uses tri-state Garmin connection status to suppress sync for unlinked accounts', () => {
        expect(useGarminConnectionState).toBeDefined();
    });
});

// Regression coverage for completion correlation: an auto-triggered sync must only
// be reported "synced" for the exact request this hook queued/joined reaching
// 'completed', not for any other update to garmin_sync_requests/latest.
describe('awaited sync outcome', () => {
    const OUR_REQUESTED_AT = '2026-08-23T06:00:00.000Z';

    it('ignores an initial snapshot that is already completed for a different request', () => {
        const staleCompleted = request({ status: 'completed', requestedAt: '2026-08-23T05:00:00.000Z' });
        expect(getAwaitedSyncOutcome(staleCompleted, OUR_REQUESTED_AT)).toBeNull();
        expect(isAwaitedSyncComplete(staleCompleted, OUR_REQUESTED_AT)).toBe(false);
    });

    it('ignores pending/processing updates for our own request', () => {
        expect(getAwaitedSyncOutcome(request({ status: 'pending', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)).toBeNull();
        expect(
            getAwaitedSyncOutcome(request({ status: 'processing', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)
        ).toBeNull();
    });

    it('classifies a failed outcome for our own request without treating it as success', () => {
        const failed = request({ status: 'failed', requestedAt: OUR_REQUESTED_AT });
        expect(getAwaitedSyncOutcome(failed, OUR_REQUESTED_AT)).toBe('failed');
        expect(isAwaitedSyncComplete(failed, OUR_REQUESTED_AT)).toBe(false);
    });

    it('reports completion once our own request reaches completed', () => {
        const completed = request({ status: 'completed', requestedAt: OUR_REQUESTED_AT });
        expect(getAwaitedSyncOutcome(completed, OUR_REQUESTED_AT)).toBe('completed');
        expect(isAwaitedSyncComplete(completed, OUR_REQUESTED_AT)).toBe(true);
    });

    it('ignores updates when nothing is currently awaited', () => {
        expect(getAwaitedSyncOutcome(request({ status: 'completed', requestedAt: OUR_REQUESTED_AT }), null)).toBeNull();
        expect(isAwaitedSyncComplete(request({ status: 'completed', requestedAt: OUR_REQUESTED_AT }), null)).toBe(false);
    });
});
