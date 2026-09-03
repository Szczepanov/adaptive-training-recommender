import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(() => 'connection-ref'),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
}));
const authService = vi.hoisted(() => ({ getConnectionStatus: vi.fn() }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => 'db') }));
vi.mock('./garminAuthService', () => ({ garminAuthService: authService }));

import { garminConnectionService } from './garminConnectionService';

function snapshot(exists: boolean, data: Record<string, unknown> = {}) {
    return { exists: () => exists, data: () => data };
}

describe('garminConnectionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses an active non-secret mirror without calling the backend', async () => {
        firestore.getDoc.mockResolvedValue(snapshot(true, { status: 'active', linkedAt: 'linked' }));

        await expect(garminConnectionService.getConnectionState('u1')).resolves.toEqual({
            state: 'connected', linkedAt: 'linked',
        });
        expect(authService.getConnectionStatus).not.toHaveBeenCalled();
    });

    it('reconciles a missing mirror with canonical server state', async () => {
        firestore.getDoc.mockResolvedValue(snapshot(false));
        authService.getConnectionStatus.mockResolvedValue({ status: 'active', linkedAt: 'server-linked' });

        await expect(garminConnectionService.getConnectionState('u1')).resolves.toEqual({
            state: 'connected', linkedAt: 'server-linked',
        });
    });

    it('keeps a failed mirror and canonical read unknown', async () => {
        const failure = new Error('offline');
        firestore.getDoc.mockRejectedValue(failure);
        authService.getConnectionStatus.mockRejectedValue(failure);

        const result = await garminConnectionService.getConnectionState('u1');
        expect(result.state).toBe('unknown');
        expect(result.error).toBe(failure);
    });

    it('reconciles missing realtime mirror state before emitting disconnected', async () => {
        let onNext: ((value: ReturnType<typeof snapshot>) => void) | undefined;
        firestore.onSnapshot.mockImplementation((_ref, next) => {
            onNext = next;
            return vi.fn();
        });
        authService.getConnectionStatus.mockResolvedValue({ status: 'disconnected' });
        const callback = vi.fn();

        garminConnectionService.subscribeToGarminConnection('u1', callback);
        onNext?.(snapshot(false));
        await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({ state: 'disconnected' }));
        expect(authService.getConnectionStatus).toHaveBeenCalledOnce();
    });

    it('falls back to canonical status after a realtime mirror error', async () => {
        let onError: (() => void) | undefined;
        firestore.onSnapshot.mockImplementation((_ref, _next, error) => {
            onError = error;
            return vi.fn();
        });
        authService.getConnectionStatus.mockResolvedValue({ status: 'active' });
        const callback = vi.fn();

        garminConnectionService.subscribeToGarminConnection('u1', callback);
        onError?.();
        await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({
            state: 'connected', linkedAt: undefined,
        }));
    });
});
