import { describe, expect, it } from 'vitest';
import { POLICY_VERSION } from './policy';
import type { DailyRecommendation } from './models';
import { replayRecommendationAudit } from './replay';

/** Minimal current-policy recommendation used to exercise replay's provenance-shape guard. */
function auditedRecommendation(): DailyRecommendation {
    return {
        userId: 'u1', date: '2026-08-18', templateId: 'rest_01', templateTitle: 'Rest',
        category: 'Rest', modality: 'Recovery', mode: 'train', rationale: 'test', schemaVersion: 3,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        recommendationAudit: {
            policyVersion: POLICY_VERSION,
            evaluatedAt: '2026-08-18T08:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-18:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Hard' },
            candidateScores: [],
            droppedContributorObjectives: [],
            externalPlan: {
                planId: 'autumn-block', revision: 1, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64),
            },
            externalRest: {
                planId: 'autumn-block', revision: 1, contentHash: 'a'.repeat(64),
                restDirectiveId: 'w1-tue-rest', date: '2026-08-18',
            },
        },
    };
}

describe('recommendation replay external provenance invariants', () => {
    it('rejects an audit that claims both externalPlan and externalRest authority', () => {
        const result = replayRecommendationAudit(auditedRecommendation());

        expect(result.reproducible).toBe(false);
        expect(result.errors).toContain(
            'Recommendation audit cannot contain both externalPlan and externalRest provenance for the same decision.',
        );
    });
});
