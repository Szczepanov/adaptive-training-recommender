import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPARISON_CANONICALIZATION_V1 } from '../observations/comparability';
import type { MeasurementProtocol } from '../observations/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    setDoc: firestore.setDoc,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'db' })) }));

import { MeasurementProtocolService } from './measurementProtocolService';

const protocol: MeasurementProtocol = {
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

function snapshot(value: MeasurementProtocol | null) {
    return value === null
        ? { exists: () => false, data: () => undefined }
        : { exists: () => true, data: () => value };
}

describe('MeasurementProtocolService.ensureRevision', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('reuses an identical immutable revision without rewriting it', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot(protocol));
        const service = new MeasurementProtocolService({} as never);
        await expect(service.ensureRevision('u1', protocol)).resolves.toEqual(protocol);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('creates the bundled revision when it is absent', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot(null)).mockResolvedValueOnce(snapshot(null));
        const service = new MeasurementProtocolService({} as never);
        await expect(service.ensureRevision('u1', protocol)).resolves.toEqual(protocol);
        expect(firestore.setDoc).toHaveBeenCalledOnce();
    });

    it('fails closed when the same id/revision contains different criteria', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot({ ...protocol, burden: 'high' }));
        const service = new MeasurementProtocolService({} as never);
        await expect(service.ensureRevision('u1', protocol)).rejects.toThrow(/conflicts with the bundled immutable revision/);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });
});
