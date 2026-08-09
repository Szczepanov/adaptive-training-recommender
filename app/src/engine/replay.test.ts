import { describe, expect, it } from 'vitest';
import type { DailyRecommendation } from './models';
import { POLICY_VERSION } from './policy';
import { replayRecommendationAudit } from './replay';

function auditedRecommendation(): DailyRecommendation {
    return {
        userId: 'u1', date: '2026-08-07', templateId: 'easy_01', templateTitle: 'Easy Ride',
        category: 'Easy Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 3,
        createdAt: '', updatedAt: '', adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        recommendationAudit: {
            policyVersion: POLICY_VERSION, evaluatedAt: '2026-08-07T08:00:00Z', decisionContextRevision: 'history-v1:2026-08-07:7:none:none', safetyStatus: 'complete',
            history: { completedEventCount: 1, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            candidateScores: [{ templateId: 'easy_01', utilityScore: 1, excludedReasons: [] }, { templateId: 'easy_02', utilityScore: 0.5, excludedReasons: [] }],
            droppedContributorObjectives: [],
        },
    };
}

describe('recommendation audit replay', () => {
    it('accepts a current-policy audit whose selected template is the top candidate', () => {
        expect(replayRecommendationAudit(auditedRecommendation())).toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });

    it('explicitly rejects the historical single-ranking-path policy as audit-only', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = '2026-08-single-ranking-path-v1';
        expect(replayRecommendationAudit(record)).toEqual({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Historical policy version 2026-08-single-ranking-path-v1 is intentionally audit-only and cannot be replayed by this build.'],
        });
    });

    it('rejects an unknown policy version distinctly from a known historical policy', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.policyVersion = 'unknown-policy';
        expect(replayRecommendationAudit(record)).toMatchObject({
            reproducible: false,
            policyMatchesCurrent: false,
            errors: ['Policy version unknown-policy is not available in this build.'],
        });
    });

    it('rejects a record whose selected template was not the highest-scoring candidate', () => {
        const record = auditedRecommendation();
        record.recommendationAudit!.candidateScores[1].utilityScore = 2;
        expect(replayRecommendationAudit(record)).toMatchObject({ reproducible: false, errors: ['Persisted template was not the highest-utility audited candidate.'] });
    });
});
