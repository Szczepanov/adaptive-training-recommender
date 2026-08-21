import { describe, expect, it, vi } from 'vitest';
import { GarminSyncRequestService } from './garminSyncRequestService';

const mockOnSnapshot = vi.fn();
const mockSetDoc = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockGetDoc = vi.fn<
    (...args: unknown[]) => Promise<{ exists: () => boolean; data?: () => unknown }>
>(() => Promise.resolve({ exists: () => false }));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, path) => ({ path })),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

describe('GarminSyncRequestService', () => {
    it('writes a pending request to users/{userId}/garmin_sync_requests/latest', async () => {
        const service = new GarminSyncRequestService();

        await expect(service.requestSync('user-1')).resolves.not.toThrow();
        expect(mockSetDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/user-1/garmin_sync_requests/latest' }),
            expect.objectContaining({ userId: 'user-1', status: 'pending' })
        );
    });

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
