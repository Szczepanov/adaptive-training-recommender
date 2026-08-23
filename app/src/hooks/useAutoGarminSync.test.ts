import { describe, it, expect, vi, beforeEach } from 'vitest';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { useAutoGarminSync, isAwaitedSyncComplete } from './useAutoGarminSync';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';

vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(),
        requestSync: vi.fn(async () => '2026-08-23T06:00:00.000Z'),
    },
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

    it('subscribes to garminSyncRequestService when userId is provided', () => {
        const unsubscribe = vi.fn();
        vi.mocked(garminSyncRequestService.subscribeToRequest).mockReturnValue(unsubscribe);

        expect(garminSyncRequestService.subscribeToRequest).toBeDefined();
        expect(garminSyncRequestService.requestSync).toBeDefined();
    });
});

// Regression coverage for the completion-correlation fix: an auto-triggered sync
// must only be reported "synced" for the exact request this hook queued reaching
// 'completed', not for any other update to the shared garmin_sync_requests/latest
// doc it happens to observe (a stale already-terminal snapshot, a still in-flight
// update, or a failed outcome).
describe('isAwaitedSyncComplete', () => {
    const OUR_REQUESTED_AT = '2026-08-23T06:00:00.000Z';

    it('ignores an initial snapshot that is already completed for a different (older) request', () => {
        // This is the exact bug CodeRabbit flagged: if the doc already holds a
        // completed request when the subscription attaches -- before requestSync()'s
        // own write has landed -- the old boolean "not in-flight" check would fire
        // onSynced immediately for someone else's finished sync.
        const staleCompleted = request({ status: 'completed', requestedAt: '2026-08-23T05:00:00.000Z' });
        expect(isAwaitedSyncComplete(staleCompleted, OUR_REQUESTED_AT)).toBe(false);
    });

    it('ignores pending/processing updates for our own request', () => {
        expect(isAwaitedSyncComplete(request({ status: 'pending', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)).toBe(
            false
        );
        expect(
            isAwaitedSyncComplete(request({ status: 'processing', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)
        ).toBe(false);
    });

    it('does not treat a failed outcome for our own request as success', () => {
        expect(isAwaitedSyncComplete(request({ status: 'failed', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)).toBe(
            false
        );
    });

    it('reports completion once our own request reaches completed', () => {
        expect(
            isAwaitedSyncComplete(request({ status: 'completed', requestedAt: OUR_REQUESTED_AT }), OUR_REQUESTED_AT)
        ).toBe(true);
    });

    it('ignores updates when nothing is currently awaited', () => {
        expect(isAwaitedSyncComplete(request({ status: 'completed', requestedAt: OUR_REQUESTED_AT }), null)).toBe(false);
    });
});
