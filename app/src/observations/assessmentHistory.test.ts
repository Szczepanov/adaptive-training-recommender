import { describe, expect, it } from 'vitest';
import {
    buildAssessmentHistory,
    determineSourceKind,
} from './assessmentHistory';
import type {
    AssessmentAttempt,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    BENCH_PRESS_1RM_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL_V2,
    STANDING_BROAD_JUMP_PROTOCOL,
} from './physicalCapitalProtocols';
import { PERFORMANCE_TEST_DEFINITIONS } from './performanceTestingCatalog';

function makeAttempt(
    id: string,
    protocolId: string,
    revision: number,
    purpose: AssessmentAttempt['purpose'],
    completedAt: string,
    state: AssessmentAttempt['state'] = 'completed',
): AssessmentAttempt {
    return {
        id,
        protocolRef: { id: protocolId, revision },
        scheduledDate: completedAt.slice(0, 10),
        state,
        purpose,
        completedAt,
    };
}

function makeObs(
    attempt: AssessmentAttempt,
    metricId: string,
    value: number,
    seriesKey: string,
    observedAt: string,
    isDerivedWithRefs = true,
    unit = 'cm',
): { head: MetricObservationHead; revision: MetricObservationRevision } {
    const observationKey = `${attempt.id}:${metricId}`;
    return {
        head: {
            observationKey,
            assessmentAttemptId: attempt.id,
            metricId,
            headRevision: 1,
            createdAt: observedAt,
            updatedAt: observedAt,
        },
        revision: {
            observationKey,
            revision: 1,
            metricId,
            value,
            unit,
            observedAt,
            source: isDerivedWithRefs ? 'derived' : 'manual',
            derivedFromEvidenceRefs: isDerivedWithRefs
                ? [{ kind: 'assessment_trial', assessmentAttemptId: attempt.id, trialId: 'trial-1' }]
                : undefined,
            protocolRef: attempt.protocolRef,
            comparisonSeriesKey: seriesKey,
            comparisonCanonicalizationVersion: 'ov-series-v1',
            assessmentAttemptId: attempt.id,
            validity: 'valid',
            context: {},
            createdAt: observedAt,
        },
    };
}

describe('assessmentHistory', () => {
    it('groups all catalog tests by family, including legacy fallback for legacy tests', () => {
        const history = buildAssessmentHistory({
            definitions: PERFORMANCE_TEST_DEFINITIONS,
            attempts: [],
            observations: [],
        });

        const families = new Set(history.tests.map(t => t.family));
        expect(families).toContain('cycling');
        expect(families).toContain('strength');
        expect(families).toContain('field');

        // Check legacy tests like cycling-20m-tt or sprint-10m-standing
        const tt20m = history.tests.find(t => t.protocolId === 'cycling-20m-tt');
        expect(tt20m?.family).toBe('cycling');

        const sprint10m = history.tests.find(t => t.protocolId === 'sprint-10m-standing');
        expect(sprint10m?.family).toBe('field');
    });

    it('identifies sourceKind: trial-derived vs summary-only historical assessment (D5)', () => {
        const att1 = makeAttempt('att-1', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z');
        const obsDerived = makeObs(att1, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z', true);
        expect(determineSourceKind(obsDerived.revision)).toBe('trial-derived');

        const att2 = makeAttempt('att-2', 'cycling-tt-20m', 1, 'baseline', '2026-09-01T10:00:00Z');
        const obsLegacy = makeObs(att2, 'cycling_tt_20m_mean_power_w', 280, 'series-1', '2026-09-01T10:00:00Z', false);
        expect(determineSourceKind(obsLegacy.revision)).toBe('summary-only historical assessment');
    });

    it('separates active series and older series with explicit nonComparableReason', () => {
        const att1 = makeAttempt('att-1', STANDING_BROAD_JUMP_PROTOCOL.id, 1, 'baseline', '2026-10-10T10:00:00Z');
        const att2 = makeAttempt('att-2', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z');
        const att3 = makeAttempt('att-3', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'checkpoint', '2026-10-25T10:00:00Z');

        const obs1 = makeObs(att1, 'standing_broad_jump_distance_cm', 225, 'series-setup-1', '2026-10-10T10:00:00Z');
        const obs2 = makeObs(att2, 'standing_broad_jump_distance_cm', 230, 'series-setup-2', '2026-10-20T10:00:00Z');
        const obs3 = makeObs(att3, 'standing_broad_jump_distance_cm', 238, 'series-setup-2', '2026-10-25T10:00:00Z');

        const history = buildAssessmentHistory({
            attempts: [att1, att2, att3],
            observations: [obs1, obs2, obs3],
        });

        const broadJump = history.tests.find(t => t.protocolId === STANDING_BROAD_JUMP_PROTOCOL.id);
        expect(broadJump).toBeDefined();

        // Active series should be rev 2 series-setup-2
        const distanceMetric = broadJump?.metrics.find(metric => metric.metricId === 'standing_broad_jump_distance_cm');
        expect(distanceMetric?.activeSeries?.protocolRevision).toBe(2);
        expect(distanceMetric?.activeSeries?.comparisonSeriesKey).toBe('series-setup-2');
        expect(distanceMetric?.activeSeries?.progress.comparable).toBe(true);
        expect(distanceMetric?.activeSeries?.progress.absoluteChange).toBe(8);

        // Other series should contain rev 1 series-setup-1
        expect(distanceMetric?.otherSeries).toHaveLength(1);
        expect(distanceMetric?.otherSeries[0].protocolRevision).toBe(1);
        expect(distanceMetric?.otherSeries[0].nonComparableReason).toBe('protocol revision changed');
    });

    it('reports unreadable counts without dropping other valid records (D6)', () => {
        const att = makeAttempt('att-1', STANDING_BROAD_JUMP_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z');
        const obs = makeObs(att, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z');

        const history = buildAssessmentHistory({
            attempts: [att],
            observations: [obs],
            unreadableAttemptsCount: 2,
            unreadableObservationsCount: 1,
        });

        expect(history.totalUnreadableCount).toBe(3);
        const broadJump = history.tests.find(t => t.protocolId === STANDING_BROAD_JUMP_PROTOCOL.id);
        expect(broadJump?.metrics[0]?.activeSeries?.observations).toHaveLength(1);
    });

    it('accurately counts completedWithoutBenchmark and abandoned attempts', () => {
        const attCompletedNoObs = makeAttempt('att-no-obs', BENCH_PRESS_1RM_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z', 'completed');
        const attAbandoned = makeAttempt('att-aband', BENCH_PRESS_1RM_PROTOCOL.id, 2, 'baseline', '2026-10-20T10:00:00Z', 'abandoned');

        const history = buildAssessmentHistory({
            attempts: [attCompletedNoObs, attAbandoned],
            observations: [],
        });

        const bench = history.tests.find(t => t.protocolId === BENCH_PRESS_1RM_PROTOCOL.id);
        expect(bench?.completedWithoutBenchmarkCount).toBe(1);
        expect(bench?.abandonedCount).toBe(1);
        expect(bench?.metrics[0]?.activeSeries).toBeNull();
    });

    it('keeps multi-metric protocol progress in independent D1 series', () => {
        const protocol = CYCLING_6S_SEATED_SPRINT_PROTOCOL_V2;
        const baseline = makeAttempt('sprint-base', protocol.id, protocol.revision, 'baseline', '2026-10-23T08:00:00Z');
        const checkpoint = makeAttempt('sprint-check', protocol.id, protocol.revision, 'checkpoint', '2027-02-20T08:00:00Z');

        const observations = [
            makeObs(baseline, 'cycling_sprint_1s_peak_power_w', 1200, 'sprint-series', '2026-10-23T08:00:00Z', true, 'W'),
            makeObs(baseline, 'cycling_sprint_5s_mean_power_w', 1050, 'sprint-series', '2026-10-23T08:00:00Z', true, 'W'),
            makeObs(checkpoint, 'cycling_sprint_1s_peak_power_w', 1260, 'sprint-series', '2027-02-20T08:00:00Z', true, 'W'),
            makeObs(checkpoint, 'cycling_sprint_5s_mean_power_w', 1080, 'sprint-series', '2027-02-20T08:00:00Z', true, 'W'),
        ];

        const history = buildAssessmentHistory({
            attempts: [baseline, checkpoint],
            observations,
        });
        const sprint = history.tests.find(test => test.protocolId === protocol.id);
        const peak = sprint?.metrics.find(metric => metric.metricId === 'cycling_sprint_1s_peak_power_w');
        const mean5s = sprint?.metrics.find(metric => metric.metricId === 'cycling_sprint_5s_mean_power_w');

        expect(peak?.activeSeries?.baseline?.value).toBe(1200);
        expect(peak?.activeSeries?.latest?.value).toBe(1260);
        expect(peak?.activeSeries?.progress.absoluteChange).toBe(60);

        expect(mean5s?.activeSeries?.baseline?.value).toBe(1050);
        expect(mean5s?.activeSeries?.latest?.value).toBe(1080);
        expect(mean5s?.activeSeries?.progress.absoluteChange).toBe(30);

        expect(peak?.activeSeries?.observations).toHaveLength(2);
        expect(mean5s?.activeSeries?.observations).toHaveLength(2);
    });
});
