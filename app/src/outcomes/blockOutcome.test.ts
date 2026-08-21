import { describe, expect, it } from 'vitest';
import type { CompetitionOutcome } from '../observations/models';
import type { ProgressResult, ProgressStatus } from '../observations/progress';
import type { BlockProcessEvidence } from './blockProcessEvidence';
import { BLOCK_VERDICT_POLICY_VERSION, deriveBlockOutcome } from './blockOutcome';
import type { OutcomeEvaluationSnapshot } from './evaluationSpec';

function evaluation(): OutcomeEvaluationSnapshot {
    return {
        revision: {
            id: 'eval-1',
            revision: 3,
            title: 'August block',
            startDate: '2026-08-01',
            endDate: '2026-08-21',
            status: 'active',
            activatedAt: '2026-07-31T08:00:00.000Z',
            contentHash: 'hash-abc',
            createdAt: '2026-07-31T07:00:00.000Z',
        },
        bindings: [
            {
                id: 'primary-20m',
                metricId: 'cycling_tt_20m_mean_power_w',
                role: 'primary',
                baseline: { kind: 'declared_observation', observationId: 'baseline-20m' },
                expectedDirection: { kind: 'higher_is_better' },
                practicalThreshold: { kind: 'absolute', value: 5, unit: 'W' },
                rationale: 'Primary block outcome',
            },
            {
                id: 'secondary-4m',
                metricId: 'cycling_tt_4m_mean_power_w',
                role: 'secondary',
                baseline: { kind: 'declared_observation', observationId: 'baseline-4m' },
                expectedDirection: { kind: 'higher_is_better' },
                rationale: 'Secondary context',
            },
        ],
    };
}

function progress(metricId: string, status: ProgressStatus): ProgressResult {
    return {
        metricId,
        baselineObservationId: `baseline-${metricId}`,
        latestObservationId: `latest-${metricId}`,
        absoluteChange: status.includes('decline') ? -8 : 8,
        percentChange: status.includes('decline') ? -3 : 3,
        comparable: status !== 'non_comparable' && status !== 'insufficient_evidence',
        comparisonSeriesKey: 'series-1',
        status,
        reasons: [status],
        progressPolicyVersion: 'ov-progress-v1',
    };
}

function process(overrides: Partial<BlockProcessEvidence> = {}): BlockProcessEvidence {
    return {
        plannedKeyRoles: 4,
        completedKeyRoles: 4,
        plannedSessionCount: 10,
        completedSessionCount: 9,
        adherencePct: 90,
        scaledCount: 1,
        deferredCount: 0,
        skippedCount: 0,
        unplannedRestCount: 1,
        responseCounts: { passed: 8, caution: 1, reactive: 0, unknown: 1 },
        responseCoveragePct: 90,
        sourceIds: {
            recommendationIds: ['2026-08-01@r1'],
            sessionIds: ['execution-1'],
        },
        ...overrides,
    };
}

function competitionOutcome(): CompetitionOutcome {
    return {
        id: 'race-1',
        eventRef: 'event-1',
        sport: 'cycling',
        occurredAt: '2026-08-20T08:00:00.000Z',
        source: 'manual',
        result: { completed: true, placing: 10, fieldSize: 80 },
        metrics: {},
        context: { weather_note: 'windy' },
        createdAt: '2026-08-20T10:00:00.000Z',
    };
}

function derive(
    metricProgress: ProgressResult[],
    processEvidence: BlockProcessEvidence = process(),
    ecologicalOutcomes: CompetitionOutcome[] = [],
) {
    return deriveBlockOutcome({
        evaluation: evaluation(),
        metricProgress,
        process: processEvidence,
        ecologicalOutcomes,
        policySegments: [{
            startDate: '2026-08-01', endDate: '2026-08-21',
            policyVersion: 'policy-v1', planningMode: 'unknown',
        }],
    });
}

describe('deriveBlockOutcome', () => {
    it('is on-track only with meaningful primary progress and adequate process/response evidence', () => {
        const report = derive([
            progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement'),
            progress('cycling_tt_4m_mean_power_w', 'possible_improvement'),
        ]);
        expect(report.verdict).toBe('on_track');
        expect(report.blockVerdictPolicyVersion).toBe(BLOCK_VERDICT_POLICY_VERSION);
        expect(report.reasons).toContain('meaningful_primary_improvement');
        expect(report).not.toHaveProperty('score');
    });

    it('withholds the verdict when process adequacy is below the versioned threshold', () => {
        const report = derive(
            [progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement')],
            process({ completedKeyRoles: 2, adherencePct: 60 }),
        );
        expect(report.verdict).toBe('insufficient_evidence');
        expect(report.reasons).toContain('process_adequacy_failed');
    });

    it('labels positive outcome with low response coverage as mixed', () => {
        const report = derive(
            [progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement')],
            process({ responseCoveragePct: 60 }),
        );
        expect(report.verdict).toBe('mixed');
        expect(report.reasons).toContain('positive_primary_outcome_with_low_response_coverage');
    });

    it('labels primary improvement with secondary decline as mixed', () => {
        const report = derive([
            progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement'),
            progress('cycling_tt_4m_mean_power_w', 'meaningful_decline'),
        ]);
        expect(report.verdict).toBe('mixed');
        expect(report.reasons).toContain('primary_improvement_with_secondary_decline');
    });

    it('keeps two frozen bindings for the same metric distinct instead of collapsing by metric id', () => {
        const duplicateMetricEvaluation = evaluation();
        duplicateMetricEvaluation.bindings = [
            duplicateMetricEvaluation.bindings[0]!,
            {
                id: 'secondary-20m-late-window',
                metricId: 'cycling_tt_20m_mean_power_w',
                role: 'secondary',
                baseline: { kind: 'declared_observation', observationId: 'baseline-20m-late' },
                targetObservationWindow: { startDate: '2026-08-15', endDate: '2026-08-21' },
                expectedDirection: { kind: 'higher_is_better' },
                rationale: 'Same metric, different frozen window',
            },
        ];

        const report = deriveBlockOutcome({
            evaluation: duplicateMetricEvaluation,
            metricProgress: [
                progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement'),
                progress('cycling_tt_20m_mean_power_w', 'meaningful_decline'),
            ],
            process: process(),
            ecologicalOutcomes: [],
            policySegments: [{
                startDate: '2026-08-01', endDate: '2026-08-21',
                policyVersion: 'policy-v1', planningMode: 'unknown',
            }],
        });

        expect(report.verdict).toBe('mixed');
        expect(report.reasons).toContain('primary_improvement_with_secondary_decline');
        expect(report.metricProgress).toHaveLength(2);
    });

    it('keeps response cost separate and reports repeated reactive responses as mixed', () => {
        const report = derive(
            [progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement')],
            process({ responseCounts: { passed: 6, caution: 0, reactive: 2, unknown: 0 }, responseCoveragePct: 100 }),
        );
        expect(report.verdict).toBe('mixed');
        expect(report.reasons).toContain('primary_improvement_with_repeated_reactive_response');
    });

    it('is off-track for a meaningful primary decline with otherwise adequate evidence', () => {
        const report = derive([progress('cycling_tt_20m_mean_power_w', 'meaningful_decline')]);
        expect(report.verdict).toBe('off_track');
        expect(report.reasons).toContain('meaningful_primary_decline');
    });

    it.each(['non_comparable', 'insufficient_evidence'] as const)(
        'withholds the block verdict for %s primary evidence',
        status => {
            const report = derive([progress('cycling_tt_20m_mean_power_w', status)]);
            expect(report.verdict).toBe('insufficient_evidence');
            expect(report.reasons).toContain('declared_primary_progress_non_comparable_or_insufficient');
        },
    );

    it('keeps ecological outcomes separate from protocol metric progress and preserves exact source IDs', () => {
        const race = competitionOutcome();
        const report = derive([progress('cycling_tt_20m_mean_power_w', 'meaningful_improvement')], process(), [race]);
        expect(report.ecologicalOutcomes).toEqual([race]);
        expect(report.metricProgress).toHaveLength(1);
        expect(report.sourceIds.ecologicalOutcomeIds).toEqual(['race-1']);
        expect(report.sourceIds.sessionIds).toEqual(['execution-1']);
        expect(report.sourceIds.recommendationIds).toEqual(['2026-08-01@r1']);
        expect(report.evaluationRef).toEqual({ id: 'eval-1', revision: 3, contentHash: 'hash-abc' });
    });
});
