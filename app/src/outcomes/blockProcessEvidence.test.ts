import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, ShadowVerdict } from '../engine/models';
import type { SessionOutcome, SessionOutcomeStatus } from '../responses/outcome';
import { deriveBlockProcessEvidence } from './blockProcessEvidence';

type RecommendationEvidence = DailyRecommendation & { engineVerdict?: ShadowVerdict };

function recommendation(
    date: string,
    engineVerdict: ShadowVerdict,
    adherence: DailyRecommendation['adherence'],
    category: DailyRecommendation['category'] = 'Hard Endurance',
): RecommendationEvidence {
    return {
        userId: 'u1',
        date,
        templateId: `template-${date}`,
        templateTitle: 'Session',
        category,
        modality: category === 'Rest' ? 'None' : 'Cycling',
        mode: category === 'Rest' ? 'recover' : (engineVerdict === 'scale' ? 'modify' : 'train'),
        rationale: 'test',
        schemaVersion: 3,
        revision: 2,
        createdAt: `${date}T05:00:00.000Z`,
        updatedAt: `${date}T05:00:00.000Z`,
        adherence,
        engineVerdict,
    };
}

function answered(followed: boolean, skipped = false): DailyRecommendation['adherence'] {
    return {
        respondedAt: '2026-08-21T08:00:00.000Z',
        followed,
        actualModality: followed || skipped ? null : 'Cycling',
        actualDurationMin: followed || skipped ? null : 45,
        skipped,
        notes: null,
    };
}

const unanswered: DailyRecommendation['adherence'] = {
    respondedAt: null,
    followed: null,
    actualModality: null,
    actualDurationMin: null,
    skipped: false,
    notes: null,
};

function outcome(id: string, date: string, status: SessionOutcomeStatus): SessionOutcome {
    return {
        policyVersion: 'm5.3-outcome-v1',
        sourceSession: { kind: 'execution', id, date },
        status,
        hasFollowUpData: status !== 'unknown',
        sourceFacts: { responseIds: [], tissueRegions: [] },
        override: {},
    };
}

describe('deriveBlockProcessEvidence', () => {
    it('reconciles exact completed history separately from recommendation adherence and M5.3 responses', () => {
        const result = deriveBlockProcessEvidence({
            keyRoles: {
                plannedOccurrenceIds: ['role-b', 'role-a', 'role-a'],
                completedOccurrenceIds: ['role-a', 'not-planned'],
            },
            completedSessions: { sessionIds: ['session-b', 'session-a', 'unplanned-completed', 'session-a'] },
            recommendations: [
                recommendation('2026-08-01', 'proceed', answered(true)),
                recommendation('2026-08-02', 'scale', answered(false)),
                recommendation('2026-08-03', 'defer', unanswered),
                recommendation('2026-08-04', 'skip', unanswered),
                recommendation('2026-08-05', 'proceed', answered(false, true)),
                recommendation('2026-08-06', 'advisory', unanswered, 'Rest'),
            ],
            sessionOutcomes: [
                outcome('session-c', '2026-08-03', 'unknown'),
                outcome('session-a', '2026-08-01', 'passed'),
                outcome('session-b', '2026-08-02', 'reactive'),
            ],
        });

        expect(result.plannedKeyRoles).toBe(2);
        expect(result.completedKeyRoles).toBe(1);
        expect(result.plannedSessionCount).toBe(5);
        expect(result.completedSessionCount).toBe(3);
        expect(result.adherencePct).toBe(20);
        expect(result.scaledCount).toBe(1);
        expect(result.deferredCount).toBe(1);
        expect(result.skippedCount).toBe(1);
        expect(result.unplannedRestCount).toBe(1);
        expect(result.responseCounts).toEqual({ passed: 1, caution: 0, reactive: 1, unknown: 1 });
        expect(result.responseCoveragePct).toBe(66.67);
        expect(result.sourceIds.recommendationIds).toEqual([
            '2026-08-01@r2', '2026-08-02@r2', '2026-08-03@r2',
            '2026-08-04@r2', '2026-08-05@r2', '2026-08-06@r2',
        ]);
        expect(result.sourceIds.sessionIds).toEqual(['session-a', 'session-b', 'session-c', 'unplanned-completed']);
    });

    it('does not invent completed key roles outside the supplied planned occurrence set', () => {
        const result = deriveBlockProcessEvidence({
            keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: ['orphan'] },
            completedSessions: { sessionIds: [] },
            recommendations: [],
            sessionOutcomes: [],
        });
        expect(result.plannedKeyRoles).toBe(0);
        expect(result.completedKeyRoles).toBe(0);
        expect(result.adherencePct).toBe(100);
        expect(result.responseCoveragePct).toBe(0);
    });
});
