import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GarminSyncRequestService, type GarminSyncRequest } from './garminSyncRequestService';
import { STALE_AFTER_MS } from '../utils/garminSyncStaleness';

type FakeSnapshot = { exists: () => boolean; data?: () => unknown };

const mockOnSnapshot = vi.fn();
const mockGetDoc = vi.fn<(...args: unknown[]) => Promise<FakeSnapshot>>(() =>
    Promise.resolve({ exists: () => false })
);
const mockTransactionGet = vi.fn<(...args: unknown[]) => Promise<FakeSnapshot>>(() =>
    Promise.resolve({ exists: () => false })
);
const mockTransactionSet = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, path) => ({ path })),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
    runTransaction: async (_db: unknown, updateFn: (tx: unknown) => Promise<void>) => {
        const transaction = { get: mockTransactionGet, set: mockTransactionSet };
        return updateFn(transaction);
    },
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

beforeEach(() => {
    mockTransactionGet.mockReset().mockResolvedValue({ exists: () => false });
    mockTransactionSet.mockReset();
});

function requestData(overrides: Partial<GarminSyncRequest> = {}): FakeSnapshot {
    return {
        exists: () => true,
        data: () => ({
            userId: 'user-1',
            status: 'pending',
            requestedAt: new Date().toISOString(),
            ...overrides,
        }),
    };
}

describe('GarminSyncRequestService.requestSync', () => {
    it('writes a pending request to users/{userId}/garmin_sync_requests/latest when none exists', async () => {
        const service = new GarminSyncRequestService();

        await expect(service.requestSync('user-1')).resolves.not.toThrow();
        expect(mockTransactionSet).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/garmin_sync_requests/latest' }),
            expect.objectContaining({ userId: 'user-1', status: 'pending', completedAt: null, error: null })
        );
    });

    it('overwrites a terminal (completed/failed) request', async () => {
        mockTransactionGet.mockResolvedValue(requestData({ status: 'failed' }));
        const service = new GarminSyncRequestService();

        await service.requestSync('user-1');

        expect(mockTransactionSet).toHaveBeenCalledOnce();
    });

    it('overwrites a stale in-flight request', async () => {
        const staleRequestedAt = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
        mockTransactionGet.mockResolvedValue(requestData({ status: 'processing', requestedAt: staleRequestedAt }));
        const service = new GarminSyncRequestService();

        await service.requestSync('user-1');

        expect(mockTransactionSet).toHaveBeenCalledOnce();
    });

    it('does not overwrite a live (non-stale) pending or processing request', async () => {
        const service = new GarminSyncRequestService();

        mockTransactionGet.mockResolvedValue(requestData({ status: 'pending' }));
        await service.requestSync('user-1');
        expect(mockTransactionSet).not.toHaveBeenCalled();

        mockTransactionGet.mockResolvedValue(requestData({ status: 'processing', claimId: 'abc' }));
        await service.requestSync('user-1');
        expect(mockTransactionSet).not.toHaveBeenCalled();
    });
});

describe('GarminSyncRequestService.getRequest', () => {
    it('returns null when no request doc exists', async () => {
        mockGetDoc.mockResolvedValueOnce({ exists: () => false });
        const service = new GarminSyncRequestService();

        await expect(service.getRequest('user-1')).resolves.toBeNull();
    });

    it('returns the request data when a doc exists', async () => {
        mockGetDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ userId: 'user-1', status: 'completed', requestedAt: '2026-08-21T06:00:00Z' }),
        });
        const service = new GarminSyncRequestService();

        await expect(service.getRequest('user-1')).resolves.toEqual(
            expect.objectContaining({ status: 'completed' })
        );
    });
});

describe('GarminSyncRequestService.subscribeToRequest', () => {
    it('subscribes to request snapshots and invokes onUpdate', () => {
        const service = new GarminSyncRequestService();
        const onUpdate = vi.fn();
        const unsubscribe = vi.fn();

        mockOnSnapshot.mockImplementation((_ref, callback) => {
            callback({
                exists: () => true,
                data: () => ({ userId: 'user-1', status: 'pending', requestedAt: '2026-08-21T06:00:00Z' }),
            });
            return unsubscribe;
        });

        const unsub = service.subscribeToRequest('user-1', onUpdate);
        expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
        expect(unsub).toBe(unsubscribe);
    });

    it('passes null to onUpdate when the request doc does not exist', () => {
        const service = new GarminSyncRequestService();
        const onUpdate = vi.fn();

        mockOnSnapshot.mockImplementation((_ref, callback) => {
            callback({ exists: () => false });
            return vi.fn();
        });

        service.subscribeToRequest('user-1', onUpdate);
        expect(onUpdate).toHaveBeenCalledWith(null);
    });
});
