import { describe, expect, it } from 'vitest';
import type { MetricObservationRevision } from './models';
import { sameCanonicalObservationRevision } from './observationCanonical';

function revision(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    return {
        observationKey: 'attempt-1:cycling_tt_20m_mean_power_w',
        revision: 1,
        metricId: 'cycling_tt_20m_mean_power_w',
        value: 300,
        unit: 'W',
        observedAt: '2026-08-21T06:00:00.000Z',
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series-a',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'attempt-1',
        validity: 'valid',
        context: { power_source_id: 'assioma', duration_seconds: 1200 },
        createdAt: '2026-08-21T06:05:00.000Z',
        ...overrides,
    };
}

describe('canonical observation revision payload', () => {
    it('ignores write provenance timestamps for exact offline/double-tap retries', () => {
        expect(sameCanonicalObservationRevision(
            revision({ createdAt: '2026-08-21T06:05:00.000Z' }),
            revision({ createdAt: '2026-08-21T06:06:00.000Z' }),
        )).toBe(true);
    });

    it('ignores object insertion order in comparison context', () => {
        expect(sameCanonicalObservationRevision(
            revision({ context: { power_source_id: 'assioma', duration_seconds: 1200 } }),
            revision({ context: { duration_seconds: 1200, power_source_id: 'assioma' } }),
        )).toBe(true);
    });

    it('treats measured value, validity and comparison context as semantic conflicts', () => {
        expect(sameCanonicalObservationRevision(revision(), revision({ value: 301 }))).toBe(false);
        expect(sameCanonicalObservationRevision(revision(), revision({ validity: 'practice' }))).toBe(false);
        expect(sameCanonicalObservationRevision(revision(), revision({ context: { power_source_id: 'other', duration_seconds: 1200 } }))).toBe(false);
    });
});
