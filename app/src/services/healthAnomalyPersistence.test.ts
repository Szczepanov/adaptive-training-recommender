import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhysiologicalAnomalyAssessment } from '../engine/healthAnomalyModels';
import { SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from '../engine/healthAnomaly';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDocs: vi.fn(),
    runTransaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import {
    buildHealthAnomalyAssessmentRevision,
    healthAnomalyRevisionIdentity,
    HealthAnomalyAssessmentRepository,
    parseHealthAnomalyAssessmentRevision,
} from './healthAnomalyPersistence';

const source = {
    timezone: 'Europe/Warsaw' as const,
    recoverySnapshotRevision: '2026-08-21:sync-1:5',
    checkinRevision: '2026-08-21:checkin-1',
    historyWindowStart: '2026-07-24',
    historyWindowEndExclusive: '2026-08-21',
    historySnapshotRevisions: [{ date: '2026-08-20', revision: '2026-08-20:sync:5' }],
    travelContextRevision: null,
    persistenceLookbackStart: '2026-08-20',
};

const assessment: PhysiologicalAnomalyAssessment = {
    state: 'watch_unexplained',
    evidenceLevel: 'moderate',
    coreSignals: [
        { signal: 'rhr', status: 'moderate_anomaly', direction: 'high', currentValue: 55, baselineValue: 50, scaleValue: 2, standardizedDeviation: 2.5, estimator: 'mean-stdev-28d', baselineVersion: 5 },
        { signal: 'respiration', status: 'normal', direction: null, currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, estimator: 'median-mad-28d', baselineVersion: 5 },
        { signal: 'hrv', status: 'normal', direction: null, currentValue: 4, baselineValue: 4, scaleValue: 0.1, standardizedDeviation: 0, estimator: 'log-mean-stdev-28d', baselineVersion: 5 },
    ],
    supportingSignals: [],
    explanations: [],
    unexplainedEvidence: ['rhr:moderate_anomaly:high'],
    persistenceDays: 1,
    episodeId: 'health-anomaly:2026-08-21',
    episodeDay: 1,
    dataQuality: [],
    rationale: { facts: [], explanations: [], cautions: ['NOT_A_DIAGNOSIS'] },
    policyVersion: 'health-anomaly/ha3-v1',
    thresholdPolicyVersion: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion,
    mode: 'shadow-v1',
};

function revision() {
    return buildHealthAnomalyAssessmentRevision({
        userId: 'u1',
        date: '2026-08-21',
        computedAt: '2026-08-21T06:30:00Z',
        mode: 'shadow-v1',
        thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
        source,
        assessment,
    });
}

describe('health anomaly immutable persistence identity', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is deterministic for the exact source/policy identity and changes after a source revision changes', () => {
        const first = healthAnomalyRevisionIdentity({
            date: '2026-08-21', mode: 'shadow-v1', policyVersion: assessment.policyVersion,
            thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS, source,
        });
        const same = healthAnomalyRevisionIdentity({
            date: '2026-08-21', mode: 'shadow-v1', policyVersion: assessment.policyVersion,
            thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS, source: { ...source },
        });
        const changed = healthAnomalyRevisionIdentity({
            date: '2026-08-21', mode: 'shadow-v1', policyVersion: assessment.policyVersion,
            thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
            source: { ...source, recoverySnapshotRevision: '2026-08-21:sync-2:5' },
        });
        expect(first).toEqual(same);
        expect(changed).not.toEqual(first);
    });

    it('rejects a revision whose immutable fingerprint was tampered with', () => {
        const record = revision();
        expect(() => parseHealthAnomalyAssessmentRevision({ ...record, revisionId: 'ha-0000000000000000' }, 'u1', '2026-08-21'))
            .toThrow('identity mismatch');
    });

    it('returns the existing immutable revision on an exact idempotent retry', async () => {
        const record = revision();
        firestore.doc.mockReturnValue({ path: 'revision' });
        const transaction = {
            get: vi.fn().mockResolvedValue({ exists: () => true, data: () => record }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction));

        const result = await new HealthAnomalyAssessmentRepository().persistImmutable(record);
        expect(result).toEqual(record);
        expect(transaction.set).not.toHaveBeenCalled();
    });

    it('creates a new immutable revision when the fingerprint does not already exist', async () => {
        const record = revision();
        firestore.doc.mockReturnValue({ path: 'revision' });
        const transaction = {
            get: vi.fn().mockResolvedValue({ exists: () => false }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction));

        await new HealthAnomalyAssessmentRepository().persistImmutable(record);
        expect(transaction.set).toHaveBeenCalledWith({ path: 'revision' }, record);
    });
});
