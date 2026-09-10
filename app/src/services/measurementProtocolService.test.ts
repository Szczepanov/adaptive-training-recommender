import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPARISON_CANONICALIZATION_V1 } from '../observations/comparability';
import type { MeasurementProtocol } from '../observations/models';

const { firestore, mockDb } = vi.hoisted(() => ({
    firestore: {
        doc: vi.fn(),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
    },
    mockDb: { id: 'default-db' },
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    setDoc: firestore.setDoc,
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => mockDb),
}));

import { MeasurementProtocolService, measurementProtocolService } from './measurementProtocolService';

const validProtocol: MeasurementProtocol = {
    id: 'cycling-4m-tt',
    revision: 1,
    title: 'Cycling 4-minute TT',
    intent: 'testing',
    metricIds: ['cycling_tt_4m_mean_power_w'],
    instructions: [{ id: 'effort', text: 'Ride 4 minutes continuously.' }],
    comparisonContext: {
        required: ['power_source_id'],
        seriesDefining: ['power_source_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'moderate',
    invalidationRules: ['Interrupted effort'],
    createdAt: '2026-08-21T00:00:00.000Z',
};

function docSnapshot(data: unknown | null) {
    if (data === null) {
        return { exists: () => false, data: () => undefined };
    }
    return { exists: () => true, data: () => data };
}

describe('MeasurementProtocolService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
            path: segments.join('/'),
        }));
        firestore.setDoc.mockResolvedValue(undefined);
    });

    describe('constructor & singleton', () => {
        it('uses getDb() when no db parameter is provided', () => {
            const service = new MeasurementProtocolService();
            expect(service).toBeInstanceOf(MeasurementProtocolService);
        });

        it('exports a default singleton instance', () => {
            expect(measurementProtocolService).toBeInstanceOf(MeasurementProtocolService);
        });
    });

    describe('createRevision', () => {
        it('creates and returns a new protocol revision when it does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce(docSnapshot(null));
            const service = new MeasurementProtocolService({} as never);

            const result = await service.createRevision('user-1', validProtocol);

            expect(result).toEqual(validProtocol);
            expect(firestore.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-1',
                'measurement_protocols',
                'cycling-4m-tt',
                'revisions',
                '1'
            );
            expect(firestore.setDoc).toHaveBeenCalledWith(
                { path: 'users/user-1/measurement_protocols/cycling-4m-tt/revisions/1' },
                validProtocol
            );
        });

        it('throws validation error if protocol is invalid', async () => {
            const service = new MeasurementProtocolService({} as never);
            const invalidProtocol = { ...validProtocol, title: '' };

            await expect(service.createRevision('user-1', invalidProtocol as MeasurementProtocol)).rejects.toThrow();
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('throws an error if the protocol revision already exists', async () => {
            firestore.getDoc.mockResolvedValueOnce(docSnapshot(validProtocol));
            const service = new MeasurementProtocolService({} as never);

            await expect(service.createRevision('user-1', validProtocol)).rejects.toThrow(
                'Measurement protocol cycling-4m-tt@1 already exists and is immutable'
            );
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });
    });

    describe('ensureRevision', () => {
        it('returns existing protocol without writing when existing revision matches protocol', async () => {
            firestore.getDoc.mockResolvedValueOnce(docSnapshot(validProtocol));
            const service = new MeasurementProtocolService({} as never);

            const result = await service.ensureRevision('user-1', validProtocol);

            expect(result).toEqual(validProtocol);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('throws an error when existing revision conflicts with the bundled protocol', async () => {
            firestore.getDoc.mockResolvedValueOnce(
                docSnapshot({ ...validProtocol, title: 'Conflicting Title' })
            );
            const service = new MeasurementProtocolService({} as never);

            await expect(service.ensureRevision('user-1', validProtocol)).rejects.toThrow(
                'Measurement protocol cycling-4m-tt@1 conflicts with the bundled immutable revision'
            );
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('creates the revision when existing revision does not exist', async () => {
            firestore.getDoc
                .mockResolvedValueOnce(docSnapshot(null)) // getRevision snapshot check
                .mockResolvedValueOnce(docSnapshot(null)); // createRevision existing check
            const service = new MeasurementProtocolService({} as never);

            const result = await service.ensureRevision('user-1', validProtocol);

            expect(result).toEqual(validProtocol);
            expect(firestore.setDoc).toHaveBeenCalledOnce();
        });

        it('throws validation error if input protocol is invalid', async () => {
            const service = new MeasurementProtocolService({} as never);
            const invalidProtocol = { ...validProtocol, id: '' };

            await expect(service.ensureRevision('user-1', invalidProtocol as MeasurementProtocol)).rejects.toThrow();
        });
    });

    describe('getRevision', () => {
        it('returns null if the revision document does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce(docSnapshot(null));
            const service = new MeasurementProtocolService({} as never);

            const result = await service.getRevision('user-1', 'cycling-4m-tt', 1);

            expect(result).toBeNull();
        });

        it('returns protocol when document exists and matches identity', async () => {
            firestore.getDoc.mockResolvedValueOnce(docSnapshot(validProtocol));
            const service = new MeasurementProtocolService({} as never);

            const result = await service.getRevision('user-1', 'cycling-4m-tt', 1);

            expect(result).toEqual(validProtocol);
        });

        it('throws validation error if retrieved data fails schema assertion', async () => {
            firestore.getDoc.mockResolvedValueOnce(
                docSnapshot({ ...validProtocol, metricIds: ['invalid_unknown_metric_id'] })
            );
            const service = new MeasurementProtocolService({} as never);

            await expect(service.getRevision('user-1', 'cycling-4m-tt', 1)).rejects.toThrow(
                'Unsupported metric id: invalid_unknown_metric_id'
            );
        });

        it('throws error when retrieved document has path identity mismatch for protocolId', async () => {
            firestore.getDoc.mockResolvedValueOnce(
                docSnapshot({ ...validProtocol, id: 'different-id' })
            );
            const service = new MeasurementProtocolService({} as never);

            await expect(service.getRevision('user-1', 'cycling-4m-tt', 1)).rejects.toThrow(
                'Measurement protocol path identity mismatch for cycling-4m-tt@1'
            );
        });

        it('throws error when retrieved document has path identity mismatch for revision', async () => {
            firestore.getDoc.mockResolvedValueOnce(
                docSnapshot({ ...validProtocol, revision: 2 })
            );
            const service = new MeasurementProtocolService({} as never);

            await expect(service.getRevision('user-1', 'cycling-4m-tt', 1)).rejects.toThrow(
                'Measurement protocol path identity mismatch for cycling-4m-tt@1'
            );
        });
    });
});
