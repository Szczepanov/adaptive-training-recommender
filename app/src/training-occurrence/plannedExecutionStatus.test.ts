import type { DailyRecommendation } from '../engine/models';
import type { ExternalPlanSessionOccurrence, SessionExecution } from '../sessions/models';
import type { PerformedTrainingOccurrence } from './models';
import { projectPlannedExecutionStatus, renderPlannedExecutionStatuses, type PlannedExecutionStatus, type PlannedExecutionStatusInput } from './plannedExecutionStatus';
import { describe, expect, it } from 'vitest';

const source = { planId: 'plan-a', revision: 2, sessionId: 'ride-1', contentHash: 'a'.repeat(64) };
const occurrence: ExternalPlanSessionOccurrence = {
    userId: 'u1', occurrenceId: 'occ-1', date: '2026-09-20', authority: 'external_plan', state: 'scheduled',
    externalPlanRef: source, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
};
const execution: SessionExecution = {
    userId: 'u1', executionId: 'exec-1', occurrenceId: 'occ-1',
    sessionSource: { kind: 'external_plan', ...source }, prescriptionHash: 'p'.repeat(64),
    date: occurrence.date, startedAt: '2026-09-20T06:00:00.000Z', completedAt: '2026-09-20T06:45:00.000Z',
    updatedAt: '2026-09-20T06:45:00.000Z', state: 'completed', schemaVersion: 1,
};
const performed: PerformedTrainingOccurrence = {
    schemaVersion: 1, performedOccurrenceId: 'performed-1', userId: 'u1', status: 'active',
    localDate: occurrence.date,
    sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', sessionOccurrenceId: 'occ-1', prescriptionHash: execution.prescriptionHash }],
    reconciliation: { state: 'single_source' }, createdAt: '2026-09-20T06:00:00.000Z', updatedAt: '2026-09-20T06:45:00.000Z',
};

function input(overrides: Partial<PlannedExecutionStatusInput> = {}): PlannedExecutionStatusInput {
    return {
        date: occurrence.date, authored: { kind: 'session', source }, authoredDate: occurrence.date,
        occurrenceId: occurrence.occurrenceId, occurrencesReadable: true, executionsReadable: true, performedReadable: true,
        occurrences: [occurrence], recommendations: [], executions: [], performedOccurrences: [],
        ...overrides,
    };
}

describe('projectPlannedExecutionStatus', () => {
    it('joins completed performance through exact occurrence and execution identity', () => {
        const result = projectPlannedExecutionStatus(input({
            executions: [{ execution, entries: [] }],
            recommendations: [{ date: occurrence.date, recommendationAudit: {
                externalPlan: source,
                primarySession: { sessionSource: execution.sessionSource, occurrenceId: occurrence.occurrenceId, prescriptionHash: execution.prescriptionHash },
                plannedDose: { volume: 1, intensity: 1 }, executionDose: { volume: 1, intensity: 1 },
            } } as DailyRecommendation],
            performedOccurrences: [performed],
        }));
        expect(result).toMatchObject({
            placement: 'as_authored', performance: 'completed',
            executionId: 'exec-1', performedOccurrenceId: 'performed-1', prescriptionHash: execution.prescriptionHash,
        });
    });

    it('does not infer a miss from a recent scheduled occurrence without execution', () => {
        expect(projectPlannedExecutionStatus(input()).performance).toBe('unknown');
    });

    it('uses only an explicit missed occurrence as evidence of no performance', () => {
        expect(projectPlannedExecutionStatus(input({ occurrences: [{ ...occurrence, state: 'missed' }] })).performance)
            .toBe('none_observed');
    });

    it('does not join same-day records with a different immutable plan source', () => {
        const otherOccurrence = { ...occurrence, externalPlanRef: { ...source, sessionId: 'ride-2' } };
        const result = projectPlannedExecutionStatus(input({ occurrences: [otherOccurrence], executions: [{ execution, entries: [] }] }));
        expect(result.executionId).toBeUndefined();
        expect(result.performance).toBe('unknown');
    });

    it('does not join an occurrence from another local date', () => {
        const result = projectPlannedExecutionStatus(input({
            date: '2026-09-21',
            occurrences: [occurrence],
            executions: [{ execution, entries: [] }],
        }));
        expect(result.occurrenceId).toBeUndefined();
        expect(result.executionId).toBeUndefined();
        expect(result.performance).toBe('unknown');
    });

    it('renders source read failures as unknown', () => {
        const result = projectPlannedExecutionStatus(input({
            occurrencesReadable: false, recommendations: [{ date: occurrence.date } as DailyRecommendation],
        }));
        expect(result.adjudication).toBe('unknown');
        expect(result.performance).toBe('unknown');
    });

    it('keeps authored rest distinct while reporting unexpected performed work', () => {
        const result = projectPlannedExecutionStatus(input({
            authored: { kind: 'rest', planId: 'plan-a', revision: 2, restDirectiveId: 'rest-1' },
            occurrences: [], recommendations: [], executions: [], performedOccurrences: [performed],
        }));
        expect(result.authored).toMatchObject({ kind: 'rest', restDirectiveId: 'rest-1' });
        expect(result.performance).toBe('not_applicable');
        expect(result.evidence).toContain('observed-work:performed-1');
    });
    it('renders round-trip rows chronologically with deterministic tie-breakers', () => {
        const status = (date: string, sessionId: string, occurrenceId: string): PlannedExecutionStatus => ({
            date,
            authored: { kind: 'session', source: { ...source, sessionId } },
            placement: 'as_authored',
            adjudication: 'as_authored',
            athleteDisposition: 'accepted',
            performance: 'completed',
            occurrenceId,
            evidence: [],
        });
        const rows = renderPlannedExecutionStatuses([
            status('2026-09-21', 'ride-a', 'occ-2'),
            status('2026-09-19', 'ride-z', 'occ-9'),
            status('2026-09-21', 'ride-b', 'occ-3'),
            status('2026-09-21', 'ride-a', 'occ-1'),
        ]).filter(line => line.startsWith('- '));

        expect(rows[0]).toContain('2026-09-19');
        expect(rows[0]).toContain('/ride-z');
        expect(rows[1]).toContain('/ride-a');
        expect(rows[1]).toContain('occurrence occ-1');
        expect(rows[2]).toContain('/ride-a');
        expect(rows[2]).toContain('occurrence occ-2');
        expect(rows[3]).toContain('/ride-b');
    });

});
