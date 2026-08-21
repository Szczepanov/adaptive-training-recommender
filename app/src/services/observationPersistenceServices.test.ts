import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from '../observations/models';
import { COMPARISON_CANONICALIZATION_V1 } from '../observations/comparability';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    runTransaction: vi.fn(),
    transaction: {
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('firebase/firestore', () => ({
    collection: firestore.collection,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    setDoc: firestore.setDoc,
    updateDoc: firestore.updateDoc,
    runTransaction: firestore.runTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'db' })) }));

import { AssessmentAttemptService } from './assessmentAttemptService';
import { CompetitionOutcomeService } from './competitionOutcomeService';
import { MeasurementProtocolService } from './measurementProtocolService';
import { MetricObservationService } from './metricObservationService';

function snapshot<T>(value: T | null) {
    return value === null
        ? { exists: () => false, data: () => undefined }
        : { exists: () => true, data: () => value };
}

const protocol: MeasurementProtocol = {
    id: 'cycling-20m-tt',
    revision: 1,
    title: 'Cycling 20-minute TT',
    intent: 'testing',
    metricIds: ['cycling_tt_20m_mean_power_w'],
    instructions: [{ id: 'main', text: 'Complete the declared protocol.' }],
    comparisonContext: {
        required: ['power_source_id'],
        seriesDefining: ['power_source_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'high',
    invalidationRules: ['Interrupted effort'],
    createdAt: '2026-08-21T00:00:00.000Z',
};

function revision(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    return {
        observationKey: 'attempt-1:cycling_tt_20m_mean_power_w',
        revision: 1,
        metricId: 'cycling_tt_20m_mean_power_w',
        value: 300,
        unit: 'W',
        observedAt: '2026-08-21T06:00:00.000Z',
        source: 'manual',
        protocolRef: { id: protocol.id, revision: protocol.revision },
        comparisonSeriesKey: 'series-a',
        comparisonCanonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
        assessmentAttemptId: 'attempt-1',
        validity: 'valid',
        context: { power_source_id: 'assioma' },
        createdAt: '2026-08-21T06:05:00.000Z',
        ...overrides,
    };
}

const head: MetricObservationHead = {
    observationKey: 'attempt-1:cycling_tt_20m_mean_power_w',
    assessmentAttemptId: 'attempt-1',
    metricId: 'cycling_tt_20m_mean_power_w',
    headRevision: 1,
    createdAt: '2026-08-21T06:05:00.000Z',
    updatedAt: '2026-08-21T06:05:00.000Z',
};

const attempt: AssessmentAttempt = {
    id: 'attempt-1',
    protocolRef: { id: protocol.id, revision: 1 },
    scheduledDate: '2026-08-22',
    state: 'scheduled',
    purpose: 'baseline',
};

const outcome: CompetitionOutcome = {
    id: 'race-1',
    sport: 'cycling',
    occurredAt: '2026-08-20T10:00:00.000Z',
    source: 'manual',
    result: { completed: true, placing: 10, fieldSize: 100 },
    metrics: { elapsed_seconds: 3600 },
    context: { course: 'loop-a' },
    createdAt: '2026-08-21T06:00:00.000Z',
};

describe('OV2/OV3 persistence services', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.updateDoc.mockResolvedValue(undefined);
        firestore.getDocs.mockResolvedValue({ docs: [] });
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            callback: (transaction: typeof firestore.transaction) => Promise<unknown>,
        ) => callback(firestore.transaction));
    });

    it('creates protocol revisions once and never overwrites an existing revision', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot(null));
        const service = new MeasurementProtocolService({} as never);
        await expect(service.createRevision('u1', protocol)).resolves.toEqual(protocol);
        expect(firestore.setDoc).toHaveBeenCalledOnce();

        firestore.getDoc.mockResolvedValueOnce(snapshot(protocol));
        await expect(service.createRevision('u1', protocol)).rejects.toThrow(/already exists and is immutable/);
    });

    it('creates observation revision 1 and head atomically', async () => {
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(null))
            .mockResolvedValueOnce(snapshot(null));
        const service = new MetricObservationService({} as never);
        await service.createInitialRevision('u1', revision());

        expect(firestore.transaction.set).toHaveBeenCalledTimes(2);
        const written = firestore.transaction.set.mock.calls.map(call => [call[0].path, call[1]]);
        expect(written[0][0]).toContain('/revisions/1');
        expect(written[1][1]).toMatchObject({ headRevision: 1, metricId: 'cycling_tt_20m_mean_power_w' });
    });

    it('treats an exact semantic initial retry as success without rewriting immutable bytes', async () => {
        const stored = revision({ createdAt: '2026-08-21T06:05:00.000Z' });
        const retried = revision({ createdAt: '2026-08-21T06:06:30.000Z' });
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(head))
            .mockResolvedValueOnce(snapshot(stored));
        const service = new MetricObservationService({} as never);

        await expect(service.createInitialRevision('u1', retried)).resolves.toEqual(stored);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
        expect(firestore.transaction.update).not.toHaveBeenCalled();
    });

    it('rejects a conflicting initial retry and requires the correction workflow', async () => {
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(head))
            .mockResolvedValueOnce(snapshot(revision()));
        const service = new MetricObservationService({} as never);
        await expect(service.createInitialRevision('u1', revision({ value: 302 }))).rejects.toThrow(/different content.*correction workflow/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('fails closed when only one side of the initial head/revision pair exists', async () => {
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(head))
            .mockResolvedValueOnce(snapshot(null));
        const service = new MetricObservationService({} as never);
        await expect(service.createInitialRevision('u1', revision())).rejects.toThrow(/incomplete head\/revision chain/);
    });

    it('advances correction head exactly one revision and rejects a stale writer', async () => {
        const service = new MetricObservationService({} as never);
        const correction = revision({
            revision: 2,
            supersedesRevision: 1,
            value: 301,
            correctionReason: 'Transcription error',
            createdAt: '2026-08-21T07:00:00.000Z',
        });
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(head))
            .mockResolvedValueOnce(snapshot(null));
        await service.appendCorrection('u1', correction);
        expect(firestore.transaction.update).toHaveBeenCalledWith(
            expect.anything(),
            { headRevision: 2, updatedAt: '2026-08-21T07:00:00.000Z' },
        );

        firestore.transaction.get.mockReset();
        firestore.transaction.set.mockClear();
        firestore.transaction.update.mockClear();
        firestore.transaction.get.mockResolvedValueOnce(snapshot({ ...head, headRevision: 2 }));
        await expect(service.appendCorrection('u1', correction)).rejects.toThrow(/Stale correction/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('reads current observation through the head pointer rather than guessing the largest revision', async () => {
        firestore.getDoc
            .mockResolvedValueOnce(snapshot({ ...head, headRevision: 2, updatedAt: '2026-08-21T07:00:00.000Z' }))
            .mockResolvedValueOnce(snapshot(revision({
                revision: 2,
                supersedesRevision: 1,
                value: 301,
                correctionReason: 'Transcription error',
                createdAt: '2026-08-21T07:00:00.000Z',
            })));
        const service = new MetricObservationService({} as never);
        await expect(service.getCurrentRevision('u1', head.observationKey)).resolves.toMatchObject({ revision: 2, value: 301 });
        expect(firestore.doc.mock.calls.at(-1)?.slice(-2)).toEqual(['revisions', '2']);
    });

    it('enforces assessment state transitions before issuing Firestore writes', async () => {
        firestore.transaction.get.mockResolvedValueOnce(snapshot(attempt));
        const service = new AssessmentAttemptService({} as never);
        await service.startAttempt('u1', 'attempt-1', '2026-08-22T06:00:00.000Z');
        expect(firestore.transaction.set).toHaveBeenCalledWith(expect.anything(), {
            ...attempt,
            state: 'in_progress',
            startedAt: '2026-08-22T06:00:00.000Z',
        });

        firestore.transaction.get.mockResolvedValueOnce(snapshot({ ...attempt, state: 'completed', startedAt: '2026-08-22T06:00:00Z', completedAt: '2026-08-22T07:00:00Z' }));
        await expect(service.startAttempt('u1', 'attempt-1', '2026-08-22T08:00:00Z')).rejects.toThrow(/Cannot start assessment from completed/);
    });

    it('recovers the newest open assessment attempt and ignores completed records', async () => {
        const older = { ...attempt, id: 'attempt-old', scheduledDate: '2026-08-20' };
        const newer = { ...attempt, id: 'attempt-new', scheduledDate: '2026-08-22' };
        const completed: AssessmentAttempt = {
            ...attempt,
            id: 'attempt-complete',
            state: 'completed',
            startedAt: '2026-08-23T06:00:00.000Z',
            completedAt: '2026-08-23T07:00:00.000Z',
        };
        firestore.getDocs.mockResolvedValueOnce({
            docs: [older, completed, newer].map(value => ({ id: value.id, data: () => value })),
        });
        const service = new AssessmentAttemptService({} as never);
        await expect(service.findOpenAttempt('u1')).resolves.toEqual(newer);
    });

    it('creates competition outcomes without any protocol-series persistence path', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot(null));
        const service = new CompetitionOutcomeService({} as never);
        await service.createOutcome('u1', outcome);
        expect(firestore.setDoc).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'users/u1/competition_outcomes/race-1' }),
            outcome,
        );
    });
});
