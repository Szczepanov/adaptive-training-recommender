import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

let testEnvironment: RulesTestEnvironment;
let ownerDb: Firestore;

const ownerId = 'athlete-followup-wiring';

// The HA6 unit tests (healthAnomalyOutcomeService.test.ts) mock both `../firebase` and
// `healthAnomalyAssessmentRepository`, so they prove the day-1/day-2/lookback *logic* but never
// exercise a real Firestore write/read/parse round trip. This suite swaps in a real
// emulator-backed Firestore client (through firestore.rules, not withSecurityRulesDisabled) and
// runs the actual production repositories against it, closing that gap: it is the same code path
// HealthAnomalyShadowPanel/HealthAnomalyFollowupCard call in the running app.
vi.mock('../firebase', () => ({ getDb: () => ownerDb }));

const { healthAnomalyAssessmentRepository, buildHealthAnomalyAssessmentRevision } =
    await import('../services/healthAnomalyPersistence');
const { findRecentHealthAnomalyFollowupCandidate, healthAnomalyOutcomeRepository } =
    await import('../services/healthAnomalyOutcomeService');
const { SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } = await import('../engine/healthAnomaly');

function source(date: string, priorDate: string | null) {
    return {
        timezone: 'Europe/Warsaw' as const,
        recoverySnapshotRevision: `${date}:sync-1:1`,
        checkinRevision: `${date}:checkin-1`,
        historyWindowStart: '2026-07-13',
        historyWindowEndExclusive: date,
        historySnapshotRevisions: priorDate ? [{ date: priorDate, revision: `${priorDate}:sync-1:1` }] : [],
        travelContextRevision: null,
        persistenceLookbackStart: priorDate ?? date,
    };
}

function coreSignals() {
    return [
        { signal: 'rhr' as const, status: 'moderate_anomaly' as const, direction: 'high' as const, currentValue: 55, baselineValue: 50, scaleValue: 2, standardizedDeviation: 2.5, estimator: 'mean-stdev-28d', baselineVersion: 5 },
        { signal: 'respiration' as const, status: 'normal' as const, direction: null, currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, estimator: 'median-mad-28d', baselineVersion: 5 },
        { signal: 'hrv' as const, status: 'normal' as const, direction: null, currentValue: 4, baselineValue: 4, scaleValue: 0.1, standardizedDeviation: 0, estimator: 'log-mean-stdev-28d', baselineVersion: 5 },
    ];
}

function buildRevision(date: string, priorDate: string | null, episodeId: string, episodeDay: number): HealthAnomalyAssessmentRevision {
    return buildHealthAnomalyAssessmentRevision({
        userId: ownerId,
        date,
        computedAt: `${date}T06:30:00.000Z`,
        mode: 'shadow-v1',
        thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
        source: source(date, priorDate),
        assessment: {
            state: 'watch_unexplained',
            evidenceLevel: 'moderate',
            coreSignals: coreSignals(),
            supportingSignals: [],
            explanations: [],
            unexplainedEvidence: ['rhr:moderate_anomaly:high'],
            persistenceDays: episodeDay,
            episodeId,
            episodeDay,
            dataQuality: [],
            rationale: { facts: [], explanations: [], cautions: ['NOT_A_DIAGNOSIS'] },
            policyVersion: 'health-anomaly/ha3-v1',
            thresholdPolicyVersion: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion,
            mode: 'shadow-v1',
        },
    });
}

emulatorDescribe('HA6 follow-up wiring against a real Firestore emulator (no mocked repositories)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-followup-wiring',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        ownerDb = testEnvironment.authenticatedContext(ownerId).firestore() as unknown as Firestore;
    }, 30000);

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('suppresses the follow-up prompt on the real day-1 revision', async () => {
        const day1 = buildRevision('2026-08-20', null, 'health-anomaly:2026-08-20', 1);
        const persisted = await healthAnomalyAssessmentRepository.persistImmutable(day1);

        const candidate = await findRecentHealthAnomalyFollowupCandidate(ownerId, '2026-08-20', persisted);
        expect(candidate).toBeNull();
    });

    it('prompts once a real persisted revision reaches episode day 2', async () => {
        const day1 = buildRevision('2026-08-20', null, 'health-anomaly:2026-08-20', 1);
        await healthAnomalyAssessmentRepository.persistImmutable(day1);
        const day2 = buildRevision('2026-08-21', '2026-08-20', 'health-anomaly:2026-08-20', 2);
        const persistedDay2 = await healthAnomalyAssessmentRepository.persistImmutable(day2);

        const candidate = await findRecentHealthAnomalyFollowupCandidate(ownerId, '2026-08-21', persistedDay2);
        expect(candidate).toEqual({
            episodeId: 'health-anomaly:2026-08-20',
            sourceAssessment: { date: '2026-08-21', revisionId: persistedDay2.revisionId },
            episodeDay: 2,
        });
    });

    it('recovers a one-day episode via the real bounded prior-day lookback, reading actual persisted history', async () => {
        const oneDay = buildRevision('2026-08-10', null, 'health-anomaly:2026-08-10', 1);
        await healthAnomalyAssessmentRepository.persistImmutable(oneDay);

        // Nothing persisted for 08-11/08-12; only the 3-day lookback should surface 08-10.
        const candidate = await findRecentHealthAnomalyFollowupCandidate(ownerId, '2026-08-13', null);
        expect(candidate?.episodeId).toBe('health-anomaly:2026-08-10');
        expect(candidate?.episodeDay).toBe(1);
    });

    it('does not look back past the configured window for a stale one-day episode', async () => {
        const oneDay = buildRevision('2026-08-10', null, 'health-anomaly:2026-08-10', 1);
        await healthAnomalyAssessmentRepository.persistImmutable(oneDay);

        // 08-15 is 5 days after the episode; default lookbackDays=3 must not reach back that far.
        const candidate = await findRecentHealthAnomalyFollowupCandidate(ownerId, '2026-08-15', null);
        expect(candidate).toBeNull();
    });

    it('round-trips a saved outcome label through the real repository and rules', async () => {
        const day1 = buildRevision('2026-08-20', null, 'health-anomaly:2026-08-20', 1);
        await healthAnomalyAssessmentRepository.persistImmutable(day1);
        const day2 = buildRevision('2026-08-21', '2026-08-20', 'health-anomaly:2026-08-20', 2);
        const persistedDay2 = await healthAnomalyAssessmentRepository.persistImmutable(day2);
        const candidate = await findRecentHealthAnomalyFollowupCandidate(ownerId, '2026-08-21', persistedDay2);
        expect(candidate).not.toBeNull();

        const saved = await healthAnomalyOutcomeRepository.save({
            userId: ownerId,
            candidate: candidate!,
            explanation: 'hard_training_recovery',
            symptomOnset: null,
            respiratoryTest: null,
            note: 'Heavy interval session two days prior.',
            now: '2026-08-21T18:00:00.000Z',
        });
        expect(saved.explanation).toBe('hard_training_recovery');

        const reloaded = await healthAnomalyOutcomeRepository.get(ownerId, candidate!.episodeId);
        expect(reloaded).toEqual(saved);
    });
});
