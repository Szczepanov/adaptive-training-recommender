import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecoverySnapshot } from '../engine/models';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));

const localDataServiceMock = vi.hoisted(() => ({
    getRecoverySnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('./localDataService', () => ({ localDataService: localDataServiceMock }));

import { RecoverySnapshotService, recoverySnapshotService } from './recoverySnapshotService';

function snapshotDoc(date: string, overrides: Partial<DailyRecoverySnapshot> = {}): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: {
            garminSyncedAt: `${date}T06:00:00Z`,
            sourceSchemaVersion: 3,
        },
        raw: {
            sleepScore: 85,
            sleepDurationSec: 28800,
            restingHr: 50,
            hrvOvernightAvg: 65,
            hrvStatus: 'BALANCED',
            respirationAvg: 14,
            bodyBatteryWake: 90,
            bodyBatteryChange: 50,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 1,
            yesterdayTraining: null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion: 1,
            sleepScore7dAvg: 80,
            sleepScore28dAvg: 82,
            restingHr7dAvg: 51,
            restingHr28dAvg: 52,
            hrv7dAvg: 63,
            hrv28dAvg: 62,
            respiration7dAvg: 14,
            respiration28dAvg: 14,
            steps7dAvg: 8000,
            steps28dAvg: 8100,
            steps28dStdev: 500,
            deltas: {
                sleepScoreVs7d: 5,
                sleepScoreVs28d: 3,
                restingHrVs7d: -1,
                restingHrVs28d: -2,
                hrvVs7d: 2,
                hrvVs28d: 3,
                respirationVs7d: 0,
                respirationVs28d: 0,
                stepsVs7d: 0,
                stepsVs28d: -100,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
        createdAt: `${date}T06:00:00Z`,
        updatedAt: `${date}T06:00:00Z`,
        ...overrides,
    };
}

function queryDoc(id: string, data: unknown) {
    return { id, data: () => data };
}

describe('RecoverySnapshotService', () => {
    let service: RecoverySnapshotService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new RecoverySnapshotService();
        firestore.doc.mockReturnValue({ path: 'users/u1/daily_recovery_snapshots/2026-08-26' });
        firestore.collection.mockReturnValue({ path: 'users/u1/daily_recovery_snapshots' });
        firestore.where.mockImplementation((...args: unknown[]) => args);
        firestore.orderBy.mockImplementation((...args: unknown[]) => args);
        firestore.query.mockImplementation((...args: unknown[]) => args);
    });

    describe('subscribeToSnapshot', () => {
        it('emits parsed snapshot data when valid document exists and status is AVAILABLE', () => {
            let nextCallback: ((snap: unknown) => void) | undefined;
            firestore.onSnapshot.mockImplementation((_ref, next) => {
                nextCallback = next;
                return vi.fn();
            });

            const onUpdate = vi.fn();
            service.subscribeToSnapshot('u1', '2026-08-26', onUpdate);

            expect(firestore.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1', 'daily_recovery_snapshots', '2026-08-26');
            expect(nextCallback).toBeDefined();

            const validDoc = snapshotDoc('2026-08-26');
            nextCallback!({
                exists: () => true,
                data: () => validDoc,
            });

            expect(onUpdate).toHaveBeenCalledWith(validDoc);
        });

        it('emits null when document does not exist', () => {
            let nextCallback: ((snap: unknown) => void) | undefined;
            firestore.onSnapshot.mockImplementation((_ref, next) => {
                nextCallback = next;
                return vi.fn();
            });

            const onUpdate = vi.fn();
            service.subscribeToSnapshot('u1', '2026-08-26', onUpdate);

            nextCallback!({
                exists: () => false,
                data: () => ({}),
            });

            expect(onUpdate).toHaveBeenCalledWith(null);
        });

        it('emits null when document fails parsing / validation', () => {
            let nextCallback: ((snap: unknown) => void) | undefined;
            firestore.onSnapshot.mockImplementation((_ref, next) => {
                nextCallback = next;
                return vi.fn();
            });

            const onUpdate = vi.fn();
            service.subscribeToSnapshot('u1', '2026-08-26', onUpdate);

            const invalidDoc = { ...snapshotDoc('2026-08-26'), source: { garminSyncedAt: 'invalid-date', sourceSchemaVersion: 999 } };
            nextCallback!({
                exists: () => true,
                data: () => invalidDoc,
            });

            expect(onUpdate).toHaveBeenCalledWith(null);
        });

        it('calls custom onError handler when firestore subscription error occurs', () => {
            let errorCallback: ((err: Error) => void) | undefined;
            firestore.onSnapshot.mockImplementation((_ref, _next, error) => {
                errorCallback = error;
                return vi.fn();
            });

            const onError = vi.fn();
            service.subscribeToSnapshot('u1', '2026-08-26', vi.fn(), onError);

            const testError = new Error('Permission denied');
            errorCallback!(testError);

            expect(onError).toHaveBeenCalledWith(testError);
        });

        it('logs to console.error when firestore subscription error occurs without custom onError handler', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            let errorCallback: ((err: Error) => void) | undefined;
            firestore.onSnapshot.mockImplementation((_ref, _next, error) => {
                errorCallback = error;
                return vi.fn();
            });

            service.subscribeToSnapshot('u1', '2026-08-26', vi.fn());

            const testError = new Error('Network offline');
            errorCallback!(testError);

            expect(consoleSpy).toHaveBeenCalledWith('[RecoverySnapshotService] Subscription error:', testError);
            consoleSpy.mockRestore();
        });
    });

    describe('getRecoverySnapshotState', () => {
        it('returns AVAILABLE state with parsed data when authoritative Firestore document exists', async () => {
            const validDoc = snapshotDoc('2026-08-26');
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => validDoc,
            });

            const state = await service.getRecoverySnapshotState('u1', '2026-08-26');

            expect(state.status).toBe('AVAILABLE');
            if (state.status === 'AVAILABLE') {
                expect(state.data).toEqual(validDoc);
            }
            expect(localDataServiceMock.getRecoverySnapshot).not.toHaveBeenCalled();
        });

        it('fails closed and returns UNAVAILABLE when Firestore throws, without consulting local cache', async () => {
            firestore.getDoc.mockRejectedValueOnce(new Error('Firestore error'));

            const state = await service.getRecoverySnapshotState('u1', '2026-08-26');

            expect(state).toEqual({
                status: 'UNAVAILABLE',
                operation: 'read recovery snapshot',
                retryable: true,
            });
            expect(localDataServiceMock.getRecoverySnapshot).not.toHaveBeenCalled();
        });

        it('consults local cache after authoritative Firestore miss and returns parsed local snapshot', async () => {
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => false,
            });
            const validLocal = snapshotDoc('2026-08-26');
            localDataServiceMock.getRecoverySnapshot.mockResolvedValueOnce(validLocal);

            const state = await service.getRecoverySnapshotState('u1', '2026-08-26');

            expect(localDataServiceMock.getRecoverySnapshot).toHaveBeenCalledWith('2026-08-26', 'u1');
            expect(state.status).toBe('AVAILABLE');
            if (state.status === 'AVAILABLE') {
                expect(state.data).toEqual(validLocal);
            }
        });

        it('returns MISSING when Firestore doc is absent and local cache returns null', async () => {
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => false,
            });
            localDataServiceMock.getRecoverySnapshot.mockResolvedValueOnce(null);

            const state = await service.getRecoverySnapshotState('u1', '2026-08-26');

            expect(state).toEqual({ status: 'MISSING' });
        });
    });

    describe('getRecoverySnapshotsInRangeState', () => {
        it('rejects invalid or inverted date ranges before querying Firestore', async () => {
            expect((await service.getRecoverySnapshotsInRangeState('u1', 'invalid-date', '2026-08-26')).status).toBe('INVALID');
            expect((await service.getRecoverySnapshotsInRangeState('u1', '2026-08-26', '2026-08-26')).status).toBe('INVALID');
            expect((await service.getRecoverySnapshotsInRangeState('u1', '2026-08-27', '2026-08-26')).status).toBe('INVALID');
            expect(firestore.getDocs).not.toHaveBeenCalled();
        });

        it('returns MISSING when Firestore query returns no documents', async () => {
            firestore.getDocs.mockResolvedValueOnce({ empty: true, docs: [] });

            const rangeState = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(rangeState).toEqual({ status: 'MISSING' });
            expect(firestore.where).toHaveBeenCalledWith('date', '>=', '2026-08-01');
            expect(firestore.where).toHaveBeenCalledWith('date', '<', '2026-08-10');
            expect(firestore.orderBy).toHaveBeenCalledWith('date', 'asc');
        });

        it('returns AVAILABLE state with snapshots and joined revisions for valid range results', async () => {
            const doc1 = snapshotDoc('2026-08-01');
            const doc2 = snapshotDoc('2026-08-02');
            firestore.getDocs.mockResolvedValueOnce({
                empty: false,
                docs: [queryDoc('2026-08-01', doc1), queryDoc('2026-08-02', doc2)],
            });

            const state = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(state.status).toBe('AVAILABLE');
            if (state.status === 'AVAILABLE') {
                expect(state.data).toEqual([doc1, doc2]);
                expect(state.revision).toBe(
                    `2026-08-01T06:00:00Z|2026-08-02T06:00:00Z`
                );
            }
        });

        it('collects issues and filters out rows with user ID or validation mismatches', async () => {
            const validDoc = snapshotDoc('2026-08-01');
            const badUserDoc = { ...snapshotDoc('2026-08-02'), userId: 'other-user' };
            firestore.getDocs.mockResolvedValueOnce({
                empty: false,
                docs: [queryDoc('2026-08-01', validDoc), queryDoc('2026-08-02', badUserDoc)],
            });

            const state = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(state.status).toBe('AVAILABLE');
            if (state.status === 'AVAILABLE') {
                expect(state.data).toEqual([validDoc]);
                expect(state.issues).toBeDefined();
                expect(state.issues?.length).toBeGreaterThan(0);
            }
        });

        it('collects issue when a row has date outside requested range', async () => {
            const outOfRangeDoc = snapshotDoc('2026-08-15');
            firestore.getDocs.mockResolvedValueOnce({
                empty: false,
                docs: [queryDoc('2026-08-15', outOfRangeDoc)],
            });

            const state = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(state.status).toBe('INVALID');
            if (state.status === 'INVALID') {
                expect(state.issues).toContainEqual(
                    expect.objectContaining({ code: 'row-outside-requested-range' })
                );
            }
        });

        it('returns INVALID when all query results are invalid documents', async () => {
            const invalidDoc = { ...snapshotDoc('2026-08-01'), source: { garminSyncedAt: 'invalid' } };
            firestore.getDocs.mockResolvedValueOnce({
                empty: false,
                docs: [queryDoc('2026-08-01', invalidDoc)],
            });

            const state = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(state.status).toBe('INVALID');
        });

        it('returns UNAVAILABLE state when getDocs throws', async () => {
            firestore.getDocs.mockRejectedValueOnce(new Error('Firestore read failure'));

            const state = await service.getRecoverySnapshotsInRangeState('u1', '2026-08-01', '2026-08-10');

            expect(state).toEqual({
                status: 'UNAVAILABLE',
                operation: 'read recovery snapshot history',
                retryable: true,
            });
        });
    });

    describe('getRecoverySnapshotByDate', () => {
        it('returns snapshot data when state is AVAILABLE', async () => {
            const validDoc = snapshotDoc('2026-08-26');
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => validDoc,
            });

            const result = await service.getRecoverySnapshotByDate('u1', '2026-08-26');
            expect(result).toEqual(validDoc);
        });

        it('returns null when state is not AVAILABLE', async () => {
            firestore.getDoc.mockResolvedValueOnce({
                exists: () => false,
            });
            localDataServiceMock.getRecoverySnapshot.mockResolvedValueOnce(null);

            const result = await service.getRecoverySnapshotByDate('u1', '2026-08-26');
            expect(result).toBeNull();
        });
    });

    describe('exported singleton instance', () => {
        it('exports a singleton instance of RecoverySnapshotService', () => {
            expect(recoverySnapshotService).toBeInstanceOf(RecoverySnapshotService);
        });
    });
});
