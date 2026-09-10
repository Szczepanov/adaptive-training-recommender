import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    MetricObservationHead,
    MetricObservationRevision,
} from '../observations/models';
import { COMPARISON_CANONICALIZATION_V1 } from '../observations/comparability';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
    transaction: {
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    runTransaction: firestore.runTransaction,
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({ id: 'default-db' })),
}));

import { MetricObservationService, metricObservationService } from './metricObservationService';

function snapshot<T>(value: T | null) {
    return value === null
        ? { exists: () => false, data: () => undefined }
        : { exists: () => true, data: () => value };
}

const VALID_METRIC_1 = 'cycling_tt_20m_mean_power_w';
const VALID_METRIC_2 = 'cycling_tt_4m_mean_power_w';

function makeRevision(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    const metricId = overrides.metricId ?? VALID_METRIC_1;
    const assessmentAttemptId = overrides.assessmentAttemptId ?? 'attempt-1';
    const observationKey = overrides.observationKey ?? `${assessmentAttemptId}:${metricId}`;
    return {
        observationKey,
        revision: 1,
        metricId,
        value: 300,
        unit: 'W',
        observedAt: '2026-08-21T06:00:00.000Z',
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series-a',
        comparisonCanonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
        assessmentAttemptId,
        validity: 'valid',
        context: { power_source_id: 'assioma' },
        createdAt: '2026-08-21T06:05:00.000Z',
        ...overrides,
    };
}

function makeHead(overrides: Partial<MetricObservationHead> = {}): MetricObservationHead {
    const metricId = overrides.metricId ?? VALID_METRIC_1;
    const assessmentAttemptId = overrides.assessmentAttemptId ?? 'attempt-1';
    const observationKey = overrides.observationKey ?? `${assessmentAttemptId}:${metricId}`;
    return {
        observationKey,
        assessmentAttemptId,
        metricId,
        headRevision: 1,
        createdAt: '2026-08-21T06:05:00.000Z',
        updatedAt: '2026-08-21T06:05:00.000Z',
        ...overrides,
    };
}

describe('MetricObservationService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.getDoc.mockResolvedValue(snapshot(null));
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            callback: (transaction: typeof firestore.transaction) => Promise<unknown>,
        ) => callback(firestore.transaction));
    });

    describe('constructor', () => {
        it('uses custom Firestore instance when provided', () => {
            const customDb = { id: 'custom-db' } as never;
            const service = new MetricObservationService(customDb);
            expect(service).toBeInstanceOf(MetricObservationService);
        });

        it('uses default getDb() instance when omitted', () => {
            const service = new MetricObservationService();
            expect(service).toBeInstanceOf(MetricObservationService);
        });
    });

    describe('createInitialRevision', () => {
        it('creates initial revision 1 and head snapshot atomically when neither exists', async () => {
            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(null))
                .mockResolvedValueOnce(snapshot(null));

            const service = new MetricObservationService({} as never);
            const rev = makeRevision();
            const result = await service.createInitialRevision('user-1', rev);

            expect(result).toEqual(rev);
            expect(firestore.transaction.set).toHaveBeenCalledTimes(2);
            const calls = firestore.transaction.set.mock.calls;
            expect(calls[0][0].path).toBe(`users/user-1/metric_observations/attempt-1:${VALID_METRIC_1}/revisions/1`);
            expect(calls[0][1]).toEqual(rev);
            expect(calls[1][0].path).toBe(`users/user-1/metric_observations/attempt-1:${VALID_METRIC_1}`);
            expect(calls[1][1]).toEqual({
                observationKey: rev.observationKey,
                assessmentAttemptId: rev.assessmentAttemptId,
                metricId: rev.metricId,
                headRevision: 1,
                createdAt: rev.createdAt,
                updatedAt: rev.createdAt,
            });
        });

        it('throws validation error when revision payload is invalid', async () => {
            const service = new MetricObservationService({} as never);
            const invalidRev = makeRevision({ metricId: '' });
            await expect(service.createInitialRevision('user-1', invalidRev)).rejects.toThrow();
        });

        it('throws error if revision is not 1 or has supersedesRevision', async () => {
            const service = new MetricObservationService({} as never);

            const rev2 = makeRevision({ revision: 2, supersedesRevision: 1, correctionReason: 'Reason' });
            await expect(service.createInitialRevision('user-1', rev2)).rejects.toThrow(
                'Initial observation write must be revision 1 with no supersedesRevision',
            );

            const revWithSupersedes = makeRevision({ revision: 1, supersedesRevision: 1 });
            await expect(service.createInitialRevision('user-1', revWithSupersedes)).rejects.toThrow(
                'Revision 1 cannot supersede another revision',
            );
        });

        it('returns stored revision on exact semantic retry without rewriting', async () => {
            const head = makeHead();
            const stored = makeRevision({ createdAt: '2026-08-21T06:05:00.000Z' });
            const retried = makeRevision({ createdAt: '2026-08-21T06:10:00.000Z' });

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(stored));

            const service = new MetricObservationService({} as never);
            const result = await service.createInitialRevision('user-1', retried);

            expect(result).toEqual(stored);
            expect(firestore.transaction.set).not.toHaveBeenCalled();
            expect(firestore.transaction.update).not.toHaveBeenCalled();
        });

        it('throws error when existing initial revision has different content', async () => {
            const head = makeHead();
            const stored = makeRevision({ value: 300 });
            const different = makeRevision({ value: 310 });

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(stored));

            const service = new MetricObservationService({} as never);
            await expect(service.createInitialRevision('user-1', different)).rejects.toThrow(
                /already exists with different content; use the correction workflow/,
            );
        });

        it('throws error when stored head/revision has conflicting logical identity', async () => {
            const head = makeHead({
                assessmentAttemptId: 'attempt-1',
                metricId: VALID_METRIC_1,
                observationKey: `attempt-1:${VALID_METRIC_1}`,
            });
            const stored = makeRevision({
                assessmentAttemptId: 'attempt-2',
                metricId: VALID_METRIC_1,
                observationKey: `attempt-2:${VALID_METRIC_1}`,
            });

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(stored));

            const service = new MetricObservationService({} as never);
            const incoming = makeRevision({
                assessmentAttemptId: 'attempt-1',
                metricId: VALID_METRIC_1,
                observationKey: `attempt-1:${VALID_METRIC_1}`,
            });
            await expect(service.createInitialRevision('user-1', incoming)).rejects.toThrow(
                /has conflicting logical identity/,
            );
        });

        it('throws error when initial write has incomplete head/revision chain', async () => {
            const head = makeHead();

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(null));

            const service = new MetricObservationService({} as never);
            await expect(service.createInitialRevision('user-1', makeRevision())).rejects.toThrow(
                /has an incomplete head\/revision chain/,
            );
        });
    });

    describe('appendCorrection', () => {
        it('appends valid correction and updates head revision', async () => {
            const head = makeHead({ headRevision: 1 });
            const correction = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                value: 305,
                correctionReason: 'Recalibrated power meter',
                createdAt: '2026-08-21T07:00:00.000Z',
            });

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(null));

            const service = new MetricObservationService({} as never);
            const result = await service.appendCorrection('user-1', correction);

            expect(result).toEqual(correction);
            expect(firestore.transaction.set).toHaveBeenCalledWith(
                { path: `users/user-1/metric_observations/attempt-1:${VALID_METRIC_1}/revisions/2` },
                correction,
            );
            expect(firestore.transaction.update).toHaveBeenCalledWith(
                { path: `users/user-1/metric_observations/attempt-1:${VALID_METRIC_1}` },
                {
                    headRevision: 2,
                    updatedAt: '2026-08-21T07:00:00.000Z',
                },
            );
        });

        it('throws validation error when correction payload is invalid', async () => {
            const service = new MetricObservationService({} as never);
            const invalidCorrection = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Reason',
                metricId: '',
            });
            await expect(service.appendCorrection('user-1', invalidCorrection)).rejects.toThrow();
        });

        it('throws error when revision < 2 or supersedesRevision is undefined', async () => {
            const service = new MetricObservationService({} as never);

            const rev1Correction = makeRevision({
                revision: 1,
                supersedesRevision: 1,
                correctionReason: 'Reason',
            });
            await expect(service.appendCorrection('user-1', rev1Correction)).rejects.toThrow(
                'Revision 1 cannot supersede another revision',
            );

            const noSupersedes = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Reason',
            });
            delete (noSupersedes as Partial<MetricObservationRevision>).supersedesRevision;
            await expect(service.appendCorrection('user-1', noSupersedes)).rejects.toThrow(
                'Revision 2 must supersede revision 1',
            );
        });

        it('throws error when correctionReason is missing or empty string', async () => {
            const service = new MetricObservationService({} as never);
            const noReason = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: '',
            });
            await expect(service.appendCorrection('user-1', noReason)).rejects.toThrow(
                'correctionReason is required',
            );
        });

        it('throws error when target head document does not exist', async () => {
            firestore.transaction.get.mockResolvedValueOnce(snapshot(null));

            const service = new MetricObservationService({} as never);
            const correction = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Reason',
            });
            await expect(service.appendCorrection('user-1', correction)).rejects.toThrow(
                /does not exist/,
            );
        });

        it('throws error when correction attempts to change logical identity', async () => {
            const head = makeHead({
                assessmentAttemptId: 'attempt-1',
                metricId: VALID_METRIC_1,
                observationKey: `attempt-1:${VALID_METRIC_1}`,
            });
            firestore.transaction.get.mockResolvedValueOnce(snapshot(head));

            const service = new MetricObservationService({} as never);
            const correction = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                assessmentAttemptId: 'attempt-1',
                metricId: VALID_METRIC_2,
                observationKey: `attempt-1:${VALID_METRIC_2}`,
                correctionReason: 'Reason',
            });
            await expect(service.appendCorrection('user-1', correction)).rejects.toThrow(
                'Correction cannot change logical observation identity',
            );
        });

        it('throws error on stale correction', async () => {
            const head = makeHead({ headRevision: 2 });
            firestore.transaction.get.mockResolvedValueOnce(snapshot(head));

            const service = new MetricObservationService({} as never);
            const staleCorrection = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Reason',
            });
            await expect(service.appendCorrection('user-1', staleCorrection)).rejects.toThrow(
                /Stale correction: expected revision 3 superseding 2/,
            );
        });

        it('throws error when target revision already exists', async () => {
            const head = makeHead({ headRevision: 1 });
            const existingRev2 = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Existing',
            });

            firestore.transaction.get
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(existingRev2));

            const service = new MetricObservationService({} as never);
            const correction = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'New reason',
            });
            await expect(service.appendCorrection('user-1', correction)).rejects.toThrow(
                /Observation revision 2 already exists/,
            );
        });
    });

    describe('getHead', () => {
        it('returns null when head document does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce(snapshot(null));
            const service = new MetricObservationService({} as never);
            await expect(service.getHead('user-1', 'obs-key')).resolves.toBeNull();
        });

        it('returns MetricObservationHead when valid and key matches', async () => {
            const head = makeHead();
            firestore.getDoc.mockResolvedValueOnce(snapshot(head));
            const service = new MetricObservationService({} as never);
            await expect(service.getHead('user-1', head.observationKey)).resolves.toEqual(head);
        });

        it('throws error when head snapshot fails validation', async () => {
            const invalidHead = makeHead({ metricId: '' });
            firestore.getDoc.mockResolvedValueOnce(snapshot(invalidHead));
            const service = new MetricObservationService({} as never);
            await expect(service.getHead('user-1', `attempt-1:${VALID_METRIC_1}`)).rejects.toThrow();
        });

        it('throws error on observationKey path mismatch', async () => {
            const head = makeHead({ observationKey: `attempt-1:${VALID_METRIC_1}` });
            firestore.getDoc.mockResolvedValueOnce(snapshot(head));
            const service = new MetricObservationService({} as never);
            await expect(service.getHead('user-1', 'other-key')).rejects.toThrow(
                'Observation head path mismatch for other-key',
            );
        });
    });

    describe('getRevision', () => {
        it('returns null when revision document does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce(snapshot(null));
            const service = new MetricObservationService({} as never);
            await expect(service.getRevision('user-1', 'obs-key', 1)).resolves.toBeNull();
        });

        it('returns MetricObservationRevision when valid and parameters match', async () => {
            const rev = makeRevision();
            firestore.getDoc.mockResolvedValueOnce(snapshot(rev));
            const service = new MetricObservationService({} as never);
            await expect(service.getRevision('user-1', rev.observationKey, 1)).resolves.toEqual(rev);
        });

        it('throws error when revision snapshot fails validation', async () => {
            const invalidRev = makeRevision({ metricId: '' });
            firestore.getDoc.mockResolvedValueOnce(snapshot(invalidRev));
            const service = new MetricObservationService({} as never);
            await expect(service.getRevision('user-1', invalidRev.observationKey, 1)).rejects.toThrow();
        });

        it('throws error on observationKey or revision number mismatch', async () => {
            const rev = makeRevision({ observationKey: `attempt-1:${VALID_METRIC_1}`, revision: 1 });
            firestore.getDoc.mockResolvedValueOnce(snapshot(rev));
            const service = new MetricObservationService({} as never);

            await expect(service.getRevision('user-1', 'other-key', 1)).rejects.toThrow(
                'Observation revision path mismatch for other-key@1',
            );

            firestore.getDoc.mockResolvedValueOnce(snapshot(rev));
            await expect(service.getRevision('user-1', `attempt-1:${VALID_METRIC_1}`, 2)).rejects.toThrow(
                `Observation revision path mismatch for attempt-1:${VALID_METRIC_1}@2`,
            );
        });
    });

    describe('getCurrentRevision', () => {
        it('returns null when getHead returns null', async () => {
            firestore.getDoc.mockResolvedValueOnce(snapshot(null));
            const service = new MetricObservationService({} as never);
            await expect(service.getCurrentRevision('user-1', 'obs-key')).resolves.toBeNull();
        });

        it('returns active revision corresponding to head pointer', async () => {
            const head = makeHead({ headRevision: 2 });
            const rev2 = makeRevision({
                revision: 2,
                supersedesRevision: 1,
                correctionReason: 'Reason',
            });

            firestore.getDoc
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(rev2));

            const service = new MetricObservationService({} as never);
            const result = await service.getCurrentRevision('user-1', head.observationKey);
            expect(result).toEqual(rev2);
        });

        it('throws error when head points to missing revision document', async () => {
            const head = makeHead({ headRevision: 2 });
            firestore.getDoc
                .mockResolvedValueOnce(snapshot(head))
                .mockResolvedValueOnce(snapshot(null));

            const service = new MetricObservationService({} as never);
            await expect(service.getCurrentRevision('user-1', head.observationKey)).rejects.toThrow(
                /head points to missing revision 2/,
            );
        });

        it('throws error on head/revision identity mismatch', async () => {
            const service = new MetricObservationService({} as never);
            vi.spyOn(service, 'getHead').mockResolvedValue(makeHead({ metricId: VALID_METRIC_1 }));
            vi.spyOn(service, 'getRevision').mockResolvedValue(makeRevision({ metricId: VALID_METRIC_2 }));

            await expect(service.getCurrentRevision('user-1', `attempt-1:${VALID_METRIC_1}`)).rejects.toThrow(
                /head\/revision identity mismatch/,
            );
        });
    });

    describe('metricObservationService singleton', () => {
        it('is an instance of MetricObservationService', () => {
            expect(metricObservationService).toBeInstanceOf(MetricObservationService);
        });
    });
});
