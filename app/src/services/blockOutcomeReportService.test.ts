import { describe, expect, it } from 'vitest';
import type { DailyRecommendation } from '../engine/models';
import type {
    AssessmentAttempt,
    AssessmentAttemptPurpose,
    AssessmentAttemptState,
    CompetitionOutcome,
    MetricObservationHead,
    MetricObservationRevision,
} from '../observations/models';
import type { CurrentObservation } from '../observations/progress';
import type { SessionOutcome } from '../responses/outcome';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { BlockOutcomeReportService } from './blockOutcomeReportService';

function evaluation(): OutcomeEvaluationSnapshot {
    return {
        revision: {
            id: 'eval-compose',
            revision: 1,
            title: 'Composition test',
            startDate: '2026-08-01',
            endDate: '2026-08-10',
            status: 'active',
            activatedAt: '2026-07-31T08:00:00.000Z',
            contentHash: 'frozen-hash',
            createdAt: '2026-07-31T07:00:00.000Z',
        },
        bindings: [{
            id: 'primary',
            metricId: 'cycling_tt_20m_mean_power_w',
            role: 'primary',
            baseline: { kind: 'declared_observation', observationId: 'missing-baseline' },
            expectedDirection: { kind: 'higher_is_better' },
            rationale: 'Primary outcome',
        }],
    };
}

function recommendation(date: string): DailyRecommendation {
    return {
        userId: 'u1',
        date,
        templateId: 'cycling-threshold',
        templateTitle: 'Threshold',
        category: 'Hard Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'test',
        schemaVersion: 3,
        revision: 1,
        createdAt: `${date}T05:00:00.000Z`,
        updatedAt: `${date}T05:00:00.000Z`,
        adherence: {
            respondedAt: `${date}T19:00:00.000Z`,
            followed: true,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
    };
}

function sessionOutcome(id: string, date: string): SessionOutcome {
    return {
        policyVersion: 'm5.3-outcome-v1',
        sourceSession: { kind: 'execution', id, date },
        status: 'passed',
        hasFollowUpData: true,
        sourceFacts: { responseIds: [], tissueRegions: [] },
        override: {},
    };
}

function race(id: string, occurredAt: string): CompetitionOutcome {
    return {
        id,
        sport: 'cycling',
        occurredAt,
        source: 'manual',
        result: { completed: true },
        metrics: {},
        context: {},
        createdAt: occurredAt,
    };
}

const P20_METRIC = 'cycling_tt_20m_mean_power_w';

function windowBaselineEvaluation(): OutcomeEvaluationSnapshot {
    const base = evaluation();
    return {
        ...base,
        bindings: [{
            id: 'primary',
            metricId: P20_METRIC,
            role: 'primary',
            baseline: {
                kind: 'first_valid_in_window',
                window: { startDate: '2026-08-01', endDate: '2026-08-04' },
                selection: 'earliest_valid',
            },
            expectedDirection: { kind: 'higher_is_better' },
            rationale: 'Primary outcome',
        }],
    };
}

function attempt(id: string, purpose: AssessmentAttemptPurpose, state: AssessmentAttemptState = 'completed'): AssessmentAttempt {
    return {
        id,
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        state,
        purpose,
    };
}

function observation(attemptId: string, value: number, observedAt: string): CurrentObservation {
    const revision: MetricObservationRevision = {
        observationKey: `${attemptId}:${P20_METRIC}`,
        revision: 1,
        metricId: P20_METRIC,
        value,
        unit: 'W',
        observedAt,
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series-a',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: attemptId,
        validity: 'valid',
        context: {},
        createdAt: observedAt,
    };
    const head: MetricObservationHead = {
        observationKey: revision.observationKey,
        assessmentAttemptId: attemptId,
        metricId: P20_METRIC,
        headRevision: 1,
        createdAt: observedAt,
        updatedAt: observedAt,
    };
    return { head, revision };
}

function buildWindowReport(observations: readonly CurrentObservation[], assessmentAttempts: readonly AssessmentAttempt[]) {
    return new BlockOutcomeReportService().buildReport({
        evaluation: windowBaselineEvaluation(),
        observations,
        assessmentAttempts,
        recommendations: [],
        completedSessions: [],
        sessionOutcomes: [],
        keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: [] },
        ecologicalOutcomes: [],
    });
}

describe('BlockOutcomeReportService', () => {
    const service = new BlockOutcomeReportService();

    it('bounds canonical inputs to the frozen evaluation period and derives rather than persists evidence', () => {
        const report = service.buildReport({
            evaluation: evaluation(),
            observations: [],
            assessmentAttempts: [],
            recommendations: [recommendation('2026-07-31'), recommendation('2026-08-02'), recommendation('2026-08-11')],
            completedSessions: [
                { id: 'completed-before', date: '2026-07-31' },
                { id: 'inside', date: '2026-08-02' },
                { id: 'unplanned-inside', date: '2026-08-05' },
                { id: 'completed-after', date: '2026-08-11' },
            ],
            sessionOutcomes: [sessionOutcome('before', '2026-07-31'), sessionOutcome('inside', '2026-08-02')],
            keyRoles: { plannedOccurrenceIds: ['role-1'], completedOccurrenceIds: ['role-1'] },
            ecologicalOutcomes: [
                race('inside-race', '2026-08-09T08:00:00.000Z'),
                race('after-race', '2026-08-11T08:00:00.000Z'),
            ],
        });

        expect(report.process.plannedSessionCount).toBe(1);
        expect(report.process.completedSessionCount).toBe(2);
        expect(report.process.sourceIds.sessionIds).toEqual(['inside', 'unplanned-inside']);
        expect(report.process.sourceIds.recommendationIds).toEqual(['2026-08-02@r1']);
        expect(report.ecologicalOutcomes.map(item => item.id)).toEqual(['inside-race']);
        expect(report.sourceIds.ecologicalOutcomeIds).toEqual(['inside-race']);
        expect(report.metricProgress[0]?.status).toBe('insufficient_evidence');
        expect(report.verdict).toBe('insufficient_evidence');
        expect(report.evaluationRef.contentHash).toBe('frozen-hash');
    });

    it('rejects a draft evaluation so reports cannot interpret unfrozen criteria', () => {
        const draft = evaluation();
        draft.revision.status = 'draft';
        draft.revision.activatedAt = undefined;
        draft.revision.contentHash = '';
        expect(() => service.buildReport({
            evaluation: draft,
            observations: [],
            assessmentAttempts: [],
            recommendations: [],
            completedSessions: [],
            sessionOutcomes: [],
            keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: [] },
            ecologicalOutcomes: [],
        })).toThrow('activated/frozen');
    });

    it('does not attribute same-day ecological evidence from another or unlinked event', () => {
        const linkedEvaluation = {
            ...evaluation(),
            revision: {
                ...evaluation().revision,
                sourceRef: { kind: 'event' as const, id: 'event-1' },
            },
        };
        const matching = {
            ...race('matching', '2026-08-05T08:00:00.000Z'),
            eventRef: 'event-1',
            evaluationRef: { id: 'eval-compose', revision: 1, contentHash: 'frozen-hash' },
        };
        const other = {
            ...matching,
            id: 'other',
            eventRef: 'event-2',
            evaluationRef: { id: 'other-eval', revision: 1, contentHash: 'other-hash' },
        };
        const wrongEvent = {
            ...matching,
            id: 'wrong-event',
            eventRef: 'event-2',
        };
        const unlinked = race('unlinked', '2026-08-05T08:00:00.000Z');
        const legacyMatching = {
            ...race('legacy-matching', '2026-08-05T08:00:00.000Z'),
            eventRef: 'event-1',
        };

        const report = service.buildReport({
            evaluation: linkedEvaluation,
            observations: [],
            assessmentAttempts: [],
            recommendations: [],
            completedSessions: [],
            sessionOutcomes: [],
            keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: [] },
            ecologicalOutcomes: [other, wrongEvent, unlinked, legacyMatching, matching],
        });

        expect(report.ecologicalOutcomes.map(item => item.id)).toEqual(['legacy-matching', 'matching']);
    });

    describe('benchmark evidence eligibility (#897 WP8)', () => {
        const windowObservations = [
            observation('famil', 280, '2026-08-01T06:00:00.000Z'),
            observation('base', 300, '2026-08-02T06:00:00.000Z'),
            observation('post', 312, '2026-08-09T06:00:00.000Z'),
        ];

        it('does not let an earlier familiarization attempt become the window baseline', () => {
            const report = buildWindowReport(windowObservations, [
                attempt('famil', 'familiarization'),
                attempt('base', 'baseline'),
                attempt('post', 'post_block'),
            ]);
            expect(report.metricProgress[0]?.baselineObservationId).toBe(`base:${P20_METRIC}`);
            expect(report.metricProgress[0]?.absoluteChange).toBe(12);
        });

        it('does not promote an abandoned attempt to the window baseline', () => {
            const report = buildWindowReport(windowObservations, [
                attempt('famil', 'baseline', 'abandoned'),
                attempt('base', 'baseline'),
                attempt('post', 'post_block'),
            ]);
            expect(report.metricProgress[0]?.baselineObservationId).toBe(`base:${P20_METRIC}`);
        });

        it('fails closed for observations whose attempt was not supplied', () => {
            const report = buildWindowReport(windowObservations, [attempt('post', 'post_block')]);
            expect(report.metricProgress[0]?.baselineObservationId).toBeUndefined();
            expect(report.metricProgress[0]?.reasons).toContain('baseline_not_found');
        });
    });
});
