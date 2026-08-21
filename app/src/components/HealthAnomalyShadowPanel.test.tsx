import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyDecisionInput } from '../engine/models';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import { SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from '../engine/healthAnomaly';
import { HealthAnomalyShadowTrace } from './HealthAnomalyShadowPanel';
import { selectHealthAnomalyLoadState, selectHealthAnomalyShadowRevision } from './healthAnomalyShadowView';

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

    it('selects the newest matching user/date revision across live and persisted sources', () => {
        const newer = {
            ...revision,
            revisionId: 'ha-fedcba0987654321',
            computedAt: '2026-08-21T06:35:00Z',
        };
        const wrongUser = {
            ...newer,
            userId: 'u2',
            computedAt: '2026-08-21T06:40:00Z',
        };
        const wrongDate = {
            ...newer,
            date: '2026-08-20',
            computedAt: '2026-08-21T06:45:00Z',
        };

        expect(selectHealthAnomalyShadowRevision('u1', '2026-08-21', revision, newer, wrongUser, wrongDate))
            .toBe(newer);
        expect(selectHealthAnomalyShadowRevision('u1', '2026-08-22', revision, newer)).toBeNull();
    });
});

describe('selectHealthAnomalyLoadState', () => {
    it('reports loading with no result yet', () => {
        expect(selectHealthAnomalyLoadState('u1', '2026-08-21', null)).toBe('loading');
    });

    it('reports the result status once it matches the active user/date', () => {
        expect(selectHealthAnomalyLoadState('u1', '2026-08-21', { userId: 'u1', date: '2026-08-21', status: 'error' }))
            .toBe('error');
        expect(selectHealthAnomalyLoadState('u1', '2026-08-21', { userId: 'u1', date: '2026-08-21', status: 'ready' }))
            .toBe('ready');
    });

    it('reports loading -- not the prior target\'s stale error -- once the date changes while the new request is pending', () => {
        const failedForPriorDate = { userId: 'u1', date: '2026-08-20', status: 'error' } as const;

        // The new date's request hasn't resolved yet: the previous date's error must not leak.
        expect(selectHealthAnomalyLoadState('u1', '2026-08-21', failedForPriorDate)).toBe('loading');

        // Same guard for a user switch on an otherwise-unchanged date.
        expect(selectHealthAnomalyLoadState('u2', '2026-08-20', failedForPriorDate)).toBe('loading');

        // Once the new target's own request resolves, its result is reported.
        const readyForNewDate = { userId: 'u1', date: '2026-08-21', status: 'ready' } as const;
        expect(selectHealthAnomalyLoadState('u1', '2026-08-21', readyForNewDate)).toBe('ready');
    });
});
