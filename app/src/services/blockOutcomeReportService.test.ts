import { describe, expect, it } from 'vitest';
import type { DailyRecommendation } from '../engine/models';
import type { CompetitionOutcome } from '../observations/models';
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

describe('BlockOutcomeReportService', () => {
    const service = new BlockOutcomeReportService();

    it('bounds canonical inputs to the frozen evaluation period and derives rather than persists evidence', () => {
        const report = service.buildReport({
            evaluation: evaluation(),
            observations: [],
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
            recommendations: [],
            completedSessions: [],
            sessionOutcomes: [],
            keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: [] },
            ecologicalOutcomes: [],
        })).toThrow('activated/frozen');
    });
});
