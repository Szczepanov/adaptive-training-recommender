import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutcomeEvaluationSpecRevision, OutcomeMetricBinding } from '../outcomes/evaluationSpec';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
    transaction: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    runTransaction: firestore.runTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'db' })) }));

import { OutcomeEvaluationService } from './outcomeEvaluationService';

const revision: OutcomeEvaluationSpecRevision = {
    id: 'block-1',
    revision: 1,
    title: 'Cycling build block',
    startDate: '2026-08-24',
    endDate: '2026-10-04',
    status: 'draft',
    contentHash: '',
    createdAt: '2026-08-21T08:00:00.000Z',
};

const binding: OutcomeMetricBinding = {
    id: 'p20',
    metricId: 'cycling_tt_20m_mean_power_w',
    protocolRef: { id: 'cycling-20m-tt', revision: 1 },
    role: 'primary',
    expectedDirection: { kind: 'higher_is_better' },
    baseline: { kind: 'declared_observation', observationId: 'baseline:cycling_tt_20m_mean_power_w' },
    targetObservationWindow: { startDate: '2026-09-28', endDate: '2026-10-04' },
    practicalThreshold: { kind: 'percent', value: 2 },
    rationale: 'Primary block outcome',
};

function snapshot<T>(value: T | null) {
    return value === null
        ? { exists: () => false, data: () => undefined }
        : { exists: () => true, data: () => value };
}

describe('OutcomeEvaluationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.runTransaction.mockImplementation(async (
            _db: unknown,
            callback: (transaction: typeof firestore.transaction) => Promise<unknown>,
        ) => callback(firestore.transaction));
    });

    it('creates revision 1 and its bounded bindings atomically with the head', async () => {
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(null))
            .mockResolvedValueOnce(snapshot(null));
        const service = new OutcomeEvaluationService({} as never);

        await expect(service.createDraftRevision('u1', revision, [binding])).resolves.toEqual({
            revision,
            bindings: [binding],
        });

        expect(firestore.transaction.set).toHaveBeenCalledTimes(2);
        const revisionWrite = firestore.transaction.set.mock.calls.find(call => call[0].path.endsWith('/revisions/1'));
        expect(revisionWrite?.[1]).toMatchObject({
            ...revision,
            bindings: [binding],
        });
        const headWrite = firestore.transaction.set.mock.calls.find(call => call[0].path.endsWith('/outcome_evaluations/block-1'));
        expect(headWrite?.[1]).toMatchObject({ id: 'block-1', currentRevision: 1 });
    });

    it('requires contiguous replacement revisions instead of mutating a draft', async () => {
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot({
                id: 'block-1', currentRevision: 1,
                createdAt: revision.createdAt, updatedAt: revision.createdAt,
            }))
            .mockResolvedValueOnce(snapshot(null));
        const service = new OutcomeEvaluationService({} as never);
        await expect(service.createDraftRevision('u1', { ...revision, revision: 3 }, [binding])).rejects.toThrow(/Next outcome evaluation revision must be 2/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('activates from the exact persisted revision+binding snapshot in one transaction', async () => {
        firestore.transaction.get.mockResolvedValueOnce(snapshot({ ...revision, bindings: [binding] }));
        const service = new OutcomeEvaluationService({} as never);
        const activated = await service.activateRevision('u1', 'block-1', 1, '2026-08-22T06:00:00.000Z');

        expect(activated.revision.status).toBe('active');
        expect(activated.revision.activatedAt).toBe('2026-08-22T06:00:00.000Z');
        expect(activated.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(activated.bindings).toEqual([binding]);
        expect(firestore.transaction.set).toHaveBeenCalledOnce();
        expect(firestore.transaction.set.mock.calls[0]?.[1]).toMatchObject({
            status: 'active',
            bindings: [binding],
            contentHash: activated.revision.contentHash,
        });
        expect(firestore.getDoc).not.toHaveBeenCalled();
    });

    it('refuses to activate an already active revision', async () => {
        firestore.transaction.get.mockResolvedValueOnce(snapshot({
            ...revision,
            status: 'active',
            activatedAt: '2026-08-22T06:00:00.000Z',
            contentHash: 'a'.repeat(64),
            bindings: [binding],
        }));
        const service = new OutcomeEvaluationService({} as never);
        await expect(service.activateRevision('u1', 'block-1', 1)).rejects.toThrow(/Cannot activate.*active/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('reads and validates the binding set from the same revision document', async () => {
        firestore.getDoc.mockResolvedValueOnce(snapshot({ ...revision, bindings: [binding] }));
        const service = new OutcomeEvaluationService({} as never);
        await expect(service.getRevision('u1', 'block-1', 1)).resolves.toEqual({ revision, bindings: [binding] });
    });
});
