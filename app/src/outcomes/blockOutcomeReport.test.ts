import { describe, expect, it } from 'vitest';
import type { CompetitionOutcome } from '../observations/models';
import type { BlockOutcomeReport } from './blockOutcome';
import { blockOutcomeReportToCsv, blockOutcomeReportToJson } from './blockOutcomeReport';

function ecological(context: Record<string, string | number | boolean | null>): CompetitionOutcome {
    return {
        id: 'race-1',
        eventRef: 'event-1',
        sport: 'cycling',
        occurredAt: '2026-08-20T08:00:00.000Z',
        source: 'manual',
        result: { completed: true },
        metrics: {},
        context,
        createdAt: '2026-08-20T10:00:00.000Z',
    };
}

function report(context: Record<string, string | number | boolean | null>): BlockOutcomeReport {
    return {
        evaluationRef: { id: 'eval-1', revision: 2, contentHash: 'hash-2' },
        period: { startDate: '2026-08-01', endDate: '2026-08-21' },
        metricProgress: [
            {
                metricId: 'cycling_tt_4m_mean_power_w',
                baselineObservationId: 'b-4m',
                latestObservationId: 'p-4m',
                absoluteChange: 3,
                percentChange: 1,
                comparable: true,
                comparisonSeriesKey: 'series-4m',
                status: 'possible_improvement',
                reasons: ['z_reason', 'a_reason'],
                progressPolicyVersion: 'ov-progress-v1',
            },
            {
                metricId: 'cycling_tt_20m_mean_power_w',
                baselineObservationId: 'b-20m',
                latestObservationId: 'p-20m',
                absoluteChange: 10,
                percentChange: 4,
                comparable: true,
                comparisonSeriesKey: 'series-20m',
                status: 'meaningful_improvement',
                reasons: ['threshold_met'],
                progressPolicyVersion: 'ov-progress-v1',
            },
        ],
        ecologicalOutcomes: [ecological(context)],
        process: {
            plannedKeyRoles: 2,
            completedKeyRoles: 2,
            plannedSessionCount: 8,
            completedSessionCount: 7,
            adherencePct: 87.5,
            scaledCount: 1,
            deferredCount: 0,
            skippedCount: 0,
            unplannedRestCount: 1,
            responseCounts: { passed: 6, caution: 1, reactive: 0, unknown: 0 },
            responseCoveragePct: 100,
            sourceIds: {
                recommendationIds: ['2026-08-02@r1', '2026-08-01@r2'],
                sessionIds: ['execution-b', 'execution-a'],
            },
        },
        verdict: 'on_track',
        reasons: ['meaningful_primary_improvement', 'process_adequate'],
        policySegments: [{
            startDate: '2026-08-01', endDate: '2026-08-21',
            policyVersion: 'policy-v1', planningMode: 'unknown',
        }],
        blockVerdictPolicyVersion: 'block-adequacy-v1',
        sourceIds: {
            observationIds: ['b-20m', 'p-20m', 'b-4m', 'p-4m'],
            sessionIds: ['execution-a', 'execution-b'],
            recommendationIds: ['2026-08-01@r2', '2026-08-02@r1'],
            ecologicalOutcomeIds: ['race-1'],
        },
    };
}

describe('block outcome exports', () => {
    it('orders metric CSV rows and reason codes deterministically', () => {
        const csv = blockOutcomeReportToCsv(report({ wind: true }));
        const lines = csv.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('evaluationContentHash');
        expect(lines[1]).toContain('cycling_tt_20m_mean_power_w');
        expect(lines[2]).toContain('cycling_tt_4m_mean_power_w');
        expect(lines[2]).toContain('a_reason;z_reason');
        expect(lines[1]).toContain('hash-2');
        expect(lines[1]).toContain('ov-progress-v1');
        expect(lines[1]).toContain('block-adequacy-v1');
    });

    it('produces byte-stable JSON when equivalent nested maps have different insertion order', () => {
        const first = blockOutcomeReportToJson(report({ zeta: 1, alpha: 'x' }));
        const second = blockOutcomeReportToJson(report({ alpha: 'x', zeta: 1 }));
        expect(first).toBe(second);
        expect(first).toContain('"contentHash":"hash-2"');
        expect(first).toContain('"ecologicalOutcomeIds":["race-1"]');
        expect(first.indexOf('"alpha"')).toBeLessThan(first.indexOf('"zeta"'));
    });
});
