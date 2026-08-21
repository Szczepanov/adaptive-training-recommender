import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyDecisionInput } from '../engine/models';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import { SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from '../engine/healthAnomaly';
import { HealthAnomalyShadowTrace } from './HealthAnomalyShadowPanel';

const revision: HealthAnomalyAssessmentRevision = {
    userId: 'u1',
    date: '2026-08-21',
    revisionId: 'ha-1234567890abcdef',
    idempotencyKey: '2026-08-21:1234567890abcdef',
    computedAt: '2026-08-21T06:30:00Z',
    policyVersion: 'health-anomaly/ha3-v1',
    thresholdPolicy: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    mode: 'shadow-v1',
    source: {
        timezone: 'Europe/Warsaw',
        recoverySnapshotRevision: 'snapshot:rev:abc',
        checkinRevision: 'checkin:rev:def',
        historyWindowStart: '2026-07-24',
        historyWindowEndExclusive: '2026-08-21',
        historySnapshotRevisions: [],
        travelContextRevision: null,
        persistenceLookbackStart: '2026-08-20',
    },
    assessment: {
        state: 'watch_unexplained',
        evidenceLevel: 'high',
        coreSignals: [
            { signal: 'rhr', status: 'strong_anomaly', direction: 'high', currentValue: 55, baselineValue: 49, scaleValue: 2, standardizedDeviation: 3, estimator: 'mean-stdev-28d', baselineVersion: 5 },
            { signal: 'respiration', status: 'moderate_anomaly', direction: 'high', currentValue: 15, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 2, estimator: 'median-mad-28d', baselineVersion: 5 },
            { signal: 'hrv', status: 'normal', direction: null, currentValue: 4.1, baselineValue: 4.1, scaleValue: 0.1, standardizedDeviation: 0, estimator: 'log-mean-stdev-28d', baselineVersion: 5 },
        ],
        supportingSignals: [{ code: 'GARMIN_SLEEP_SCORE', status: 'normal', value: 85 }],
        explanations: [{ kind: 'hard_training', strength: 'weak', explainsSignals: ['respiration'], evidence: ['HARD_SESSION_WITHIN_3D'] }],
        unexplainedEvidence: ['rhr:strong_anomaly:high', 'respiration:moderate_anomaly:high'],
        persistenceDays: 1,
        episodeId: 'health-anomaly:2026-08-21',
        episodeDay: 1,
        dataQuality: [
            { signal: 'rhr', historyCount: 20, recentDayCoverage: 1, baselineWindowStart: '2026-07-24', baselineWindowEndExclusive: '2026-08-21', baselineAgeDays: 1, zeroOrNearZeroScale: false, currentValueMissing: false, suspectedQuantizationOrTies: false },
            { signal: 'respiration', historyCount: 20, recentDayCoverage: 1, baselineWindowStart: '2026-07-24', baselineWindowEndExclusive: '2026-08-21', baselineAgeDays: 1, zeroOrNearZeroScale: false, currentValueMissing: false, suspectedQuantizationOrTies: false },
            { signal: 'hrv', historyCount: 20, recentDayCoverage: 1, baselineWindowStart: '2026-07-24', baselineWindowEndExclusive: '2026-08-21', baselineAgeDays: 1, zeroOrNearZeroScale: false, currentValueMissing: false, suspectedQuantizationOrTies: false },
        ],
        rationale: { facts: [], explanations: [], cautions: ['NOT_A_DIAGNOSIS'] },
        policyVersion: 'health-anomaly/ha3-v1',
        thresholdPolicyVersion: SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion,
        mode: 'shadow-v1',
    },
    schemaVersion: 1,
};

const decisionInput = {
    date: '2026-08-21',
    recoverySnapshot: {
        raw: {
            last3DaysHardSessionsCount: 1,
            yesterdayTraining: { hardActivityCount: 1 },
            sleepScore: 85,
            sleepDurationSec: 28800,
            stress: { avg: 25, max: 60 },
        },
    },
    subjectiveCheckin: {
        sleepQuality: 8,
        mentalStress: 3,
        illnessSymptoms: false,
        healthContext: { alcoholDrinksLast24h: 0, closeSickContact: false },
    },
} as unknown as DailyDecisionInput;

describe('HealthAnomalyShadowTrace', () => {
    it('renders core evidence, quality, context, explanations, residuals and policy provenance', () => {
        const html = renderToStaticMarkup(<HealthAnomalyShadowTrace revision={revision} decisionInput={decisionInput} />);
        expect(html).toContain('Health anomaly (shadow)');
        expect(html).toContain('watch_unexplained');
        expect(html).toContain('health-anomaly/ha3-v1');
        expect(html).toContain('mean-stdev-28d');
        expect(html).toContain('Hard sessions last 3d');
        expect(html).toContain('hard_training');
        expect(html).toContain('rhr:strong_anomaly:high');
        expect(html).toContain('does not alter today');
    });
});
