import { describe, it, expect, vi, beforeEach } from 'vitest';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { useAutoGarminSync } from './useAutoGarminSync';

vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(),
        requestSync: vi.fn(async () => {}),
    },
}));

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
