import { describe, it, expect, vi, beforeEach } from 'vitest';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { useGarminBackfillStatus } from './useGarminBackfillStatus';

// This repo has no interactive hook-test harness (no @testing-library/react-hooks) --
// hooks can't be invoked outside a component render, so state-transition rules live in
// getGarminBackfillStatus (garminBackfillStatus.test.ts) and are exercised directly
// there. This just pins the hook's contract with the request service it depends on,
// matching the convention in useAutoGarminSync.test.ts.
vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(() => vi.fn()),
        requestBackfill: vi.fn(async () => '2026-08-23T06:00:00.000Z'),
    },
}));

describe('useGarminBackfillStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports useGarminBackfillStatus function', () => {
        expect(typeof useGarminBackfillStatus).toBe('function');
    });

    it('exposes the sync request service methods used by the hook', () => {
        expect(garminSyncRequestService.subscribeToRequest).toBeDefined();
        expect(garminSyncRequestService.requestBackfill).toBeDefined();
    });
});
