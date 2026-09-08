import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    runTransaction: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    getDoc: firestore.getDoc,
    setDoc: firestore.setDoc,
    runTransaction: firestore.runTransaction,
}));

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
vi.mock('./constraintService', () => ({
    constraintService: { listConstraints: vi.fn().mockResolvedValue([]) },
}));

import { createDefaultTrainingSettings, TrainingSettingsService } from './trainingSettingsService';

function snapshot(data: ReturnType<typeof createDefaultTrainingSettings>) {
    return { exists: () => true, data: () => data };
}

describe('ADR-0038 recovery bootstrap persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            handler: (transaction: { get: typeof firestore.transactionGet; set: typeof firestore.transactionSet }) => Promise<unknown>,
        ) => handler({ get: firestore.transactionGet, set: firestore.transactionSet }));
    });

    it('re-reads inside the transaction so a concurrent first writer wins', async () => {
        const before = createDefaultTrainingSettings('athlete', '2026-09-01T00:00:00.000Z');
        const concurrentlyInitialized = { ...before, recoveryBootstrapDate: '2026-09-01' };
        firestore.getDoc.mockResolvedValue(snapshot(before));
        firestore.transactionGet.mockResolvedValue(snapshot(concurrentlyInitialized));

        const result = await new TrainingSettingsService().ensureRecoveryBootstrapDate('athlete', '2026-09-03');

        expect(result).toBe('2026-09-01');
        expect(firestore.transactionSet).not.toHaveBeenCalled();
    });

    it('initializes B exactly once when the transactional read still has no epoch', async () => {
        const before = createDefaultTrainingSettings('athlete', '2026-09-01T00:00:00.000Z');
        firestore.getDoc.mockResolvedValue(snapshot(before));
        firestore.transactionGet.mockResolvedValue(snapshot(before));

        const result = await new TrainingSettingsService().ensureRecoveryBootstrapDate('athlete', '2026-09-03');

        expect(result).toBe('2026-09-03');
        expect(firestore.transactionSet).toHaveBeenCalledTimes(1);
        expect(firestore.transactionSet.mock.calls[0]?.[1]).toMatchObject({
            userId: 'athlete',
            recoveryBootstrapDate: '2026-09-03',
        });
    });

    it('rejects an invalid candidate date before reading or writing settings', async () => {
        await expect(new TrainingSettingsService().ensureRecoveryBootstrapDate('athlete', 'not-a-date'))
            .rejects.toThrow(/asOfDate is invalid/);
        expect(firestore.getDoc).not.toHaveBeenCalled();
        expect(firestore.runTransaction).not.toHaveBeenCalled();
    });
});
