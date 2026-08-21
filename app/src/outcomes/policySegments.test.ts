import { describe, expect, it } from 'vitest';
import type { DailyRecommendation } from '../engine/models';
import { derivePolicySegments } from './policySegments';

function recommendation(
    date: string,
    policyVersion?: string,
    externalPlan?: { planId: string; revision: number; sessionId: string; contentHash: string },
): DailyRecommendation {
    return {
        userId: 'u1',
        date,
        templateId: `template-${date}`,
        templateTitle: 'Session',
        category: 'Hard Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'test',
        schemaVersion: 3,
        revision: 1,
        createdAt: `${date}T05:00:00.000Z`,
        updatedAt: `${date}T05:00:00.000Z`,
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        ...(policyVersion ? {
            recommendationAudit: {
                policyVersion,
                evaluatedAt: `${date}T05:00:00.000Z`,
                decisionContextRevision: `ctx-${date}`,
                safetyStatus: 'complete',
                history: {
                    completedEventCount: 0,
                    unmatchedEventCount: 0,
                    sourceStatuses: {
                        activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'AVAILABLE',
                    },
                },
                envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
                candidateScores: [],
                droppedContributorObjectives: [],
                ...(externalPlan ? { externalPlan } : {}),
            },
        } : {}),
    };
}

describe('derivePolicySegments', () => {
    it('uses an explicit unknown segment when no persisted policy context exists', () => {
        expect(derivePolicySegments([], { startDate: '2026-08-01', endDate: '2026-08-21' })).toEqual([{
            startDate: '2026-08-01',
            endDate: '2026-08-21',
            policyVersion: 'unknown',
            planningMode: 'unknown',
        }]);
    });

    it('does not backfill context before the first persisted recommendation', () => {
        expect(derivePolicySegments(
            [recommendation('2026-08-05', 'policy-a')],
            { startDate: '2026-08-01', endDate: '2026-08-10' },
        )).toEqual([
            { startDate: '2026-08-01', endDate: '2026-08-04', policyVersion: 'unknown', planningMode: 'unknown' },
            { startDate: '2026-08-05', endDate: '2026-08-10', policyVersion: 'policy-a', planningMode: 'unknown' },
        ]);
    });

    it('splits policy changes and preserves exact authored-plan revision context', () => {
        const segments = derivePolicySegments([
            recommendation('2026-08-01', 'policy-a', {
                planId: 'plan-1', revision: 2, sessionId: 's1', contentHash: 'h1',
            }),
            recommendation('2026-08-08', 'policy-a', {
                planId: 'plan-1', revision: 2, sessionId: 's2', contentHash: 'h1',
            }),
            recommendation('2026-08-12', 'policy-b', {
                planId: 'plan-1', revision: 3, sessionId: 's3', contentHash: 'h2',
            }),
        ], { startDate: '2026-08-01', endDate: '2026-08-21' });

        expect(segments).toEqual([
            {
                startDate: '2026-08-01', endDate: '2026-08-11', policyVersion: 'policy-a',
                planningMode: 'externally_planned', authoredPlanRef: 'plan-1@r2',
            },
            {
                startDate: '2026-08-12', endDate: '2026-08-21', policyVersion: 'policy-b',
                planningMode: 'externally_planned', authoredPlanRef: 'plan-1@r3',
            },
        ]);
    });
});
