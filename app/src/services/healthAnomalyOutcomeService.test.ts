import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
}));
const assessmentRepo = vi.hoisted(() => ({ getLatestForDate: vi.fn() }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('./healthAnomalyPersistence', () => ({ healthAnomalyAssessmentRepository: assessmentRepo }));

import {
    findRecentHealthAnomalyFollowupCandidate,
    followupCandidateFromRevision,
    HealthAnomalyOutcomeRepository,
} from './healthAnomalyOutcomeService';

function revision(date: string, episodeDay: number | null): HealthAnomalyAssessmentRevision {
    return {
        userId: 'u1', date,
        revisionId: 'ha-1234567890abcdef',
        idempotencyKey: `${date}:1234567890abcdef`,
        computedAt: `${date}T06:00:00.000Z`,
        policyVersion: 'health-anomaly/ha3-v1',
        thresholdPolicy: {
            policyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
            moderateDeviation: 1.5, strongDeviation: 2.5,
            minimumCoreSignalsForMultiSignal: 2, persistenceDaysForEscalation: 2,
            minimumHistoryCount: 14, minimumRecentDayCoverage: 4 / 7, maxBaselineAgeDays: 3,
            estimatorBySignal: { rhr: 'mean-stdev-28d', respiration: 'median-mad-28d', hrv: 'log-mean-stdev-28d' },
        },
        mode: 'shadow-v1',
        source: {
            timezone: 'Europe/Warsaw', recoverySnapshotRevision: null, checkinRevision: null,
            historyWindowStart: '2026-07-24', historyWindowEndExclusive: date,
            historySnapshotRevisions: [], travelContextRevision: null, persistenceLookbackStart: '2026-08-19',
        },
        assessment: {
            state: episodeDay ? 'watch_unexplained' : 'normal', evidenceLevel: episodeDay ? 'moderate' : 'none',
            coreSignals: [], supportingSignals: [], explanations: [], unexplainedEvidence: [], persistenceDays: episodeDay ?? 0,
            episodeId: episodeDay ? 'health-anomaly:2026-08-20' : null,
            episodeDay, dataQuality: [], rationale: { facts: [], explanations: [], cautions: [] },
            policyVersion: 'health-anomaly/ha3-v1', thresholdPolicyVersion: 'health-anomaly-thresholds/shadow-candidate-v1', mode: 'shadow-v1',
        },
        schemaVersion: 1,
    };
}

describe('HA6 follow-up candidate selection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not prompt on the first day of a new episode', () => {
        expect(followupCandidateFromRevision(revision('2026-08-21', 1))).toBeNull();
    });

    it('prompts on episode day 2+', () => {
        expect(followupCandidateFromRevision(revision('2026-08-21', 2))?.episodeDay).toBe(2);
    });

    it('recovers a one-day episode on a later day using bounded prior-day reads', async () => {
        assessmentRepo.getLatestForDate
            .mockResolvedValueOnce(revision('2026-08-20', 1));
        const candidate = await findRecentHealthAnomalyFollowupCandidate('u1', '2026-08-21', revision('2026-08-21', null));
        expect(candidate?.episodeId).toBe('health-anomaly:2026-08-20');
        expect(assessmentRepo.getLatestForDate).toHaveBeenCalledWith('u1', '2026-08-20');
    });
});

describe('HealthAnomalyOutcomeRepository', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates a separate mutable outcome document for an episode', async () => {
        firestore.doc.mockReturnValue({ path: 'outcome' });
        const transaction = {
            get: vi.fn().mockResolvedValue({ exists: () => false }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction));
        const candidate = followupCandidateFromRevision(revision('2026-08-21', 2))!;

        const result = await new HealthAnomalyOutcomeRepository().save({
            userId: 'u1', candidate, explanation: 'nothing_obvious', now: '2026-08-21T18:00:00.000Z',
        });
        expect(result.episodeId).toBe(candidate.episodeId);
        expect(result.respiratoryTest).toBeNull();
        expect(transaction.set).toHaveBeenCalledWith({ path: 'outcome' }, result);
    });

    it('updates the conclusion while preserving the original assessment identity and createdAt', async () => {
        firestore.doc.mockReturnValue({ path: 'outcome' });
        const existing = {
            userId: 'u1', episodeId: 'health-anomaly:2026-08-20',
            sourceAssessment: { date: '2026-08-20', revisionId: 'ha-1234567890abcdef' },
            explanation: 'nothing_obvious', symptomOnset: null, respiratoryTest: null, note: null,
            createdAt: '2026-08-21T06:00:00.000Z', updatedAt: '2026-08-21T06:00:00.000Z', schemaVersion: 1,
        } as const;
        const transaction = {
            get: vi.fn().mockResolvedValue({ exists: () => true, data: () => existing }),
            set: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction));
        const candidate = { episodeId: existing.episodeId, sourceAssessment: { date: '2026-08-21', revisionId: 'ha-fedcba0987654321' }, episodeDay: 2 };

        const result = await new HealthAnomalyOutcomeRepository().save({
            userId: 'u1', candidate, explanation: 'illness_symptoms',
            symptomOnset: { date: '2026-08-21', precision: 'day' },
            now: '2026-08-21T18:00:00.000Z',
        });
        expect(result.sourceAssessment).toEqual(existing.sourceAssessment);
        expect(result.createdAt).toBe(existing.createdAt);
        expect(result.explanation).toBe('illness_symptoms');
    });
});
