import { describe, expect, it } from 'vitest';
import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MetricObservationRevision,
} from './models';
import {
    assertValidAssessmentAttempt,
    assertValidCompetitionOutcome,
    assertValidMetricObservationRevision,
    observationKeyFor,
} from './validation';

function observation(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    return {
        observationKey: 'attempt-1:cycling_tt_20m_mean_power_w',
        revision: 1,
        metricId: 'cycling_tt_20m_mean_power_w',
        value: 300,
        unit: 'W',
        observedAt: '2026-08-21T06:00:00.000Z',
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series-key',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'attempt-1',
        validity: 'valid',
        context: { power_source_id: 'assioma' },
        createdAt: '2026-08-21T06:05:00.000Z',
        ...overrides,
    };
}

function competition(overrides: Partial<CompetitionOutcome> = {}): CompetitionOutcome {
    return {
        id: 'race-1',
        sport: 'cycling',
        occurredAt: '2026-08-20T10:00:00.000Z',
        source: 'manual',
        result: { completed: true, placing: 12, fieldSize: 100, elapsedSeconds: 3600 },
        metrics: { normalized_power_w: 280 },
        context: { course: 'local-loop' },
        createdAt: '2026-08-21T06:00:00.000Z',
        ...overrides,
    };
}

describe('OV2 evidence validation', () => {
    it('derives deterministic logical observation identity from attempt + metric', () => {
        expect(observationKeyFor('attempt-1', 'cycling_tt_20m_mean_power_w'))
            .toBe('attempt-1:cycling_tt_20m_mean_power_w');
    });

    it('requires correction revisions to point to the immediately prior revision', () => {
        expect(() => assertValidMetricObservationRevision(observation({ revision: 2 }))).toThrow(/must supersede revision 1/);
        expect(() => assertValidMetricObservationRevision(observation({ revision: 2, supersedesRevision: 1 }))).not.toThrow();
        expect(() => assertValidMetricObservationRevision(observation({ revision: 1, supersedesRevision: 1 }))).toThrow(/Revision 1 cannot supersede/);
    });

    it('requires invalid attempts to preserve an explicit reason', () => {
        expect(() => assertValidMetricObservationRevision(observation({ validity: 'invalid' }))).toThrow(/invalidReason/);
        expect(() => assertValidMetricObservationRevision(observation({ validity: 'invalid', invalidReason: 'Interrupted effort' }))).not.toThrow();
    });

    it('rejects unit mismatch and non-finite raw values', () => {
        expect(() => assertValidMetricObservationRevision(observation({ unit: 'kW' }))).toThrow(/requires unit W/);
        expect(() => assertValidMetricObservationRevision(observation({ value: Number.NaN }))).toThrow(/must be finite/);
    });

    it('requires source IDs and algorithm version for derived observations and forbids them on raw observations', () => {
        expect(() => assertValidMetricObservationRevision(observation({ source: 'derived' }))).toThrow(/source observation IDs/);
        expect(() => assertValidMetricObservationRevision(observation({
            source: 'derived', derivedFromObservationIds: ['obs-a'], algorithmVersion: 'algo-v1',
        }))).not.toThrow();
        expect(() => assertValidMetricObservationRevision(observation({
            derivedFromObservationIds: ['obs-a'], algorithmVersion: 'algo-v1',
        }))).toThrow(/Only derived observations/);
    });

    it('enforces assessment lifecycle timestamp invariants', () => {
        const scheduled: AssessmentAttempt = {
            id: 'attempt-1', protocolRef: { id: 'cycling-20m-tt', revision: 1 }, state: 'scheduled', purpose: 'baseline', scheduledDate: '2026-08-22',
        };
        expect(() => assertValidAssessmentAttempt(scheduled)).not.toThrow();
        expect(() => assertValidAssessmentAttempt({ ...scheduled, state: 'in_progress' })).toThrow(/requires startedAt/);
        expect(() => assertValidAssessmentAttempt({ ...scheduled, state: 'in_progress', startedAt: '2026-08-22T06:00:00Z' })).not.toThrow();
        expect(() => assertValidAssessmentAttempt({ ...scheduled, state: 'completed', completedAt: '2026-08-22T07:00:00Z' })).toThrow(/requires startedAt and completedAt/);
    });

    it('keeps competition evidence ecological and validates result bounds', () => {
        expect(() => assertValidCompetitionOutcome(competition())).not.toThrow();
        expect(() => assertValidCompetitionOutcome(competition({ result: { completed: true, placing: 101, fieldSize: 100 } })))
            .toThrow(/placing cannot exceed fieldSize/);
        expect(() => assertValidCompetitionOutcome(competition({ result: { completed: true, elapsedSeconds: -1 } })))
            .toThrow(/elapsedSeconds/);
    });
});
