import { describe, expect, it } from 'vitest';
import type { ExternalPlanSessionOccurrence } from '../sessions/models';
import { projectPlannedExecutionStatus } from './plannedExecutionStatus';

const source = {
    planId: 'coach-plan',
    revision: 7,
    sessionId: 'am-ride',
    contentHash: 'e'.repeat(64),
};

const superseded: ExternalPlanSessionOccurrence = {
    userId: 'u1',
    occurrenceId: 'occ-external-1',
    date: '2026-10-05',
    authority: 'external_plan',
    externalPlanRef: source,
    state: 'superseded',
    createdAt: '2026-10-05T03:30:00.000Z',
    updatedAt: '2026-10-05T05:00:00.000Z',
};

describe('planned execution status after manual replacement', () => {
    it('keeps verified manually_replaced attribution when the prepared external occurrence is superseded', () => {
        const result = projectPlannedExecutionStatus({
            date: superseded.date,
            authored: { kind: 'session', source },
            authoredDate: superseded.date,
            occurrenceId: superseded.occurrenceId,
            occurrencesReadable: true,
            executionsReadable: true,
            performedReadable: true,
            occurrences: [superseded],
            recommendations: [],
            executions: [],
            performedOccurrences: [],
            authoredSessionCountOnDate: 1,
            replacedByOccurrenceId: 'occ-manual-1',
        });

        expect(result).toMatchObject({
            occurrenceId: superseded.occurrenceId,
            athleteDisposition: 'manually_replaced',
            performance: 'unknown',
        });
        expect(result.evidence).toContain('replaced-by:occ-manual-1');
    });

    it('does not turn an unrelated superseded occurrence into a manual replacement', () => {
        const result = projectPlannedExecutionStatus({
            date: superseded.date,
            authored: { kind: 'session', source },
            authoredDate: superseded.date,
            occurrenceId: superseded.occurrenceId,
            occurrencesReadable: true,
            executionsReadable: true,
            performedReadable: true,
            occurrences: [superseded],
            recommendations: [],
            executions: [],
            performedOccurrences: [],
            authoredSessionCountOnDate: 1,
        });

        expect(result.athleteDisposition).toBe('unknown');
        expect(result.evidence.some(item => item.startsWith('replaced-by:'))).toBe(false);
    });
});
