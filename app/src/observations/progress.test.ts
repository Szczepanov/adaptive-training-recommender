import { describe, expect, it } from 'vitest';
import type { MetricObservationHead, MetricObservationRevision, ReliabilityEstimate } from './models';
import type { OutcomeMetricBinding, PracticalThreshold } from '../outcomes/evaluationSpec';
import { deriveProgress, type CurrentObservation } from './progress';

const binding: OutcomeMetricBinding = {
    id: 'p20',
    metricId: 'cycling_tt_20m_mean_power_w',
    protocolRef: { id: 'cycling-20m-tt', revision: 1 },
    role: 'primary',
    expectedDirection: { kind: 'higher_is_better' },
    baseline: { kind: 'declared_observation', observationId: 'base:cycling_tt_20m_mean_power_w' },
    targetObservationWindow: { startDate: '2026-09-01', endDate: '2026-10-31' },
    practicalThreshold: { kind: 'percent', value: 2 },
    rationale: 'Primary cycling outcome',
};

function current(
    observationKey: string,
    value: number,
    observedAt: string,
    overrides: Partial<MetricObservationRevision> = {},
    headRevision?: number,
): CurrentObservation {
    const revision: MetricObservationRevision = {
        observationKey,
        revision: 1,
        metricId: 'cycling_tt_20m_mean_power_w',
        value,
        unit: 'W',
        observedAt,
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series-a',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: observationKey.split(':')[0]!,
        validity: 'valid',
        context: { power_source_id: 'assioma' },
        createdAt: observedAt,
        ...overrides,
    };
    const head: MetricObservationHead = {
        observationKey: revision.observationKey,
        assessmentAttemptId: revision.assessmentAttemptId,
        metricId: revision.metricId,
        headRevision: headRevision ?? revision.revision,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
    };
    return { head, revision };
}

const literature: ReliabilityEstimate = {
    source: 'literature_reference', statistic: 'typical_error_pct', value: 1.5, reference: 'reviewed-ref',
};
const personal: ReliabilityEstimate = {
    source: 'personal_repeatability', statistic: 'typical_error_pct', value: 1, estimatedAt: '2026-09-01T00:00:00Z',
};

describe('OV4 progress derivation', () => {
    it('classifies a favourable change as meaningful only when error and declared practical threshold are both exceeded', () => {
        const result = deriveProgress(binding, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 309, '2026-10-01T06:00:00Z'),
        ], [{ comparisonSeriesKey: 'series-a', estimate: literature }]);
        expect(result.status).toBe('meaningful_improvement');
        expect(result.percentChange).toBe(3);
        expect(result.reasons).toContain('change_exceeds_available_measurement_error');
        expect(result.reasons).toContain('declared_practical_threshold_met');
    });

    it('reports raw change but insufficient evidence when no reliability estimate exists', () => {
        const result = deriveProgress(binding, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 312, '2026-10-01T06:00:00Z'),
        ]);
        expect(result.status).toBe('insufficient_evidence');
        expect(result.absoluteChange).toBe(12);
        expect(result.reasons).toContain('no_reliability_estimate');
    });

    it('keeps changes inside available error as unclear', () => {
        const result = deriveProgress(binding, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 303, '2026-10-01T06:00:00Z'),
        ], [{ comparisonSeriesKey: 'series-a', estimate: { ...literature, value: 1.5 } }]);
        expect(result.status).toBe('unclear_within_noise');
    });

    it('does not promote invalid, practice, or superseded observations', () => {
        const observations = [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('invalid:cycling_tt_20m_mean_power_w', 340, '2026-10-01T06:00:00Z', { validity: 'invalid', invalidReason: 'Interrupted' }),
            current('practice:cycling_tt_20m_mean_power_w', 335, '2026-10-02T06:00:00Z', { validity: 'practice' }),
            current('stale:cycling_tt_20m_mean_power_w', 330, '2026-10-03T06:00:00Z', { revision: 1 }, 2),
            current('post:cycling_tt_20m_mean_power_w', 309, '2026-10-04T06:00:00Z'),
        ];
        const result = deriveProgress(binding, observations, [{ comparisonSeriesKey: 'series-a', estimate: personal }]);
        expect(result.latestObservationId).toBe('post:cycling_tt_20m_mean_power_w');
        expect(result.status).toBe('meaningful_improvement');
    });

    it('returns non-comparable when target evidence exists only in a different series', () => {
        const result = deriveProgress(binding, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 320, '2026-10-01T06:00:00Z', { comparisonSeriesKey: 'series-b' }),
        ], [{ comparisonSeriesKey: 'series-a', estimate: personal }]);
        expect(result.status).toBe('non_comparable');
        expect(result.comparable).toBe(false);
    });

    it('never replaces a declared baseline with a better historical result', () => {
        const result = deriveProgress(binding, [
            current('pb:cycling_tt_20m_mean_power_w', 330, '2026-08-15T06:00:00Z'),
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 309, '2026-10-01T06:00:00Z'),
        ], [{ comparisonSeriesKey: 'series-a', estimate: personal }]);
        expect(result.baselineObservationId).toBe('base:cycling_tt_20m_mean_power_w');
    });

    it('supports lower-is-better without changing raw absolute-change sign', () => {
        const lower: OutcomeMetricBinding = {
            ...binding,
            expectedDirection: { kind: 'lower_is_better' },
            practicalThreshold: { kind: 'absolute', value: 5, unit: 'W' },
        };
        const result = deriveProgress(lower, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 290, '2026-10-01T06:00:00Z'),
        ], [{ comparisonSeriesKey: 'series-a', estimate: { source: 'manual', statistic: 'typical_error_abs', value: 3 } }]);
        expect(result.absoluteChange).toBe(-10);
        expect(result.status).toBe('meaningful_improvement');
    });

    it('handles zero baseline without invalid percentage arithmetic', () => {
        const zeroBinding: OutcomeMetricBinding = {
            ...binding,
            practicalThreshold: { kind: 'absolute', value: 5, unit: 'W' } satisfies PracticalThreshold,
        };
        const result = deriveProgress(zeroBinding, [
            current('base:cycling_tt_20m_mean_power_w', 0, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 10, '2026-10-01T06:00:00Z'),
        ], [{ comparisonSeriesKey: 'series-a', estimate: { source: 'manual', statistic: 'typical_error_abs', value: 2 } }]);
        expect(result.percentChange).toBeUndefined();
        expect(result.status).toBe('meaningful_improvement');
    });

    it('prefers personal repeatability over literature reference for the same series', () => {
        const result = deriveProgress(binding, [
            current('base:cycling_tt_20m_mean_power_w', 300, '2026-09-01T06:00:00Z'),
            current('post:cycling_tt_20m_mean_power_w', 306, '2026-10-01T06:00:00Z'),
        ], [
            { comparisonSeriesKey: 'series-a', estimate: literature },
            { comparisonSeriesKey: 'series-a', estimate: personal },
        ]);
        expect(result.reliability?.source).toBe('personal_repeatability');
        expect(result.status).toBe('meaningful_improvement');
    });

    it('context bindings never receive improvement/decline labels', () => {
        const contextBinding: OutcomeMetricBinding = {
            id: 'hr', metricId: 'cycling_submax_mean_hr_bpm', role: 'context',
            baseline: { kind: 'declared_observation', observationId: 'base:cycling_submax_mean_hr_bpm' },
            rationale: 'Context only',
        };
        expect(deriveProgress(contextBinding, []).status).toBe('insufficient_evidence');
    });
});
