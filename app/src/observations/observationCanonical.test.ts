import { describe, expect, it } from 'vitest';
import type { MetricObservationRevision } from './models';
import {
    sameCanonicalAssessmentTrial,
    sameCanonicalObservationRevision,
} from './observationCanonical';

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

    it('treats changed typed evidence refs as semantic conflicts and identical refs as idempotent retries', () => {
        const derivedA = revision({
            source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'attempt-1', trialId: 'trial-1' }],
            algorithmVersion: 'algo-v1',
            createdAt: '2026-08-21T06:05:00.000Z',
        });
        const derivedB = revision({
            source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'attempt-1', trialId: 'trial-2' }],
            algorithmVersion: 'algo-v1',
            createdAt: '2026-08-21T06:05:00.000Z',
        });
        const derivedRetry = revision({
            source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'attempt-1', trialId: 'trial-1' }],
            algorithmVersion: 'algo-v1',
            createdAt: '2026-08-21T06:06:00.000Z',
        });

        expect(sameCanonicalObservationRevision(derivedA, derivedB)).toBe(false);
        expect(sameCanonicalObservationRevision(derivedA, derivedRetry)).toBe(true);
    });
});

describe('sameCanonicalAssessmentTrial', () => {
    function trial(overrides: Partial<import('./models').AssessmentTrial> = {}): import('./models').AssessmentTrial {
        return {
            id: 'trial-1',
            assessmentAttemptId: 'attempt-1',
            ordinal: 1,
            correctionIndex: 0,
            validity: 'valid',
            values: { distance_cm: 240 },
            context: {},
            createdAt: '2026-10-19T07:30:00.000Z',
            ...overrides,
        };
    }

    it('treats identical trial payloads with different createdAt as idempotent', () => {
        expect(sameCanonicalAssessmentTrial(
            trial({ createdAt: '2026-10-19T07:30:00.000Z' }),
            trial({ createdAt: '2026-10-19T07:30:05.000Z' }),
        )).toBe(true);
    });

    it('treats changed trial values or validity as semantic conflicts', () => {
        expect(sameCanonicalAssessmentTrial(trial(), trial({ values: { distance_cm: 245 } }))).toBe(false);
        expect(sameCanonicalAssessmentTrial(trial(), trial({ validity: 'invalid', invalidReason: 'Fell' }))).toBe(false);
        expect(sameCanonicalAssessmentTrial(trial(), trial({ ordinal: 2, id: 'trial-2' }))).toBe(false);
    });
});
