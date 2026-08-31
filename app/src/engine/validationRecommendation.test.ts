import { describe, expect, it } from 'vitest';
import { validateRecommendation } from './validation';

function validV4Recommendation() {
    return {
        userId: 'athlete-a',
        date: '2026-08-31',
        templateId: 'easy_01',
        templateTitle: 'Easy Ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'A compact rationale.',
        schemaVersion: 4,
        revision: 1,
        createdAt: '2026-08-31T06:00:00Z',
        updatedAt: '2026-08-31T06:00:00Z',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        recommendationAudit: {
            policyVersion: '2026-08-skr1-persisted-knowledge-lineage-v1',
            evaluatedAt: '2026-08-31T06:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-31:7:none:none',
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: {
                    activities: 'AVAILABLE',
                    recommendations: 'AVAILABLE',
                    manualTraining: 'MISSING',
                },
            },
            envelope: {
                safetyRestrictedModalityCount: 0,
                planMaxAllowableTier: 'Easy',
            },
            candidateScores: [],
            knowledgeLineage: [{ claimId: 'readiness.objective_mode_thresholds', version: 1 }],
        },
    };
}

describe('recommendation validation boundary', () => {
    it('rejects a null recommendation audit without throwing', () => {
        const raw = { ...validV4Recommendation(), recommendationAudit: null };
        expect(() => validateRecommendation(raw)).not.toThrow();
        const result = validateRecommendation(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual({
            field: 'recommendationAudit',
            message: 'Recommendation audit must be an object',
        });
    });

    it('rejects a non-object recommendation root without throwing', () => {
        expect(() => validateRecommendation(null)).not.toThrow();
        expect(validateRecommendation(null).isValid).toBe(false);
    });

    it('requires lineage for schema v4 while retaining the v3 compatibility contract', () => {
        const v4 = validV4Recommendation();
        const legacyAudit: Record<string, unknown> = { ...v4.recommendationAudit };
        delete legacyAudit.knowledgeLineage;

        const invalidV4 = validateRecommendation({ ...v4, recommendationAudit: legacyAudit });
        expect(invalidV4.isValid).toBe(false);
        expect(invalidV4.errors.some(error => error.field === 'recommendationAudit.knowledgeLineage')).toBe(true);

        const validV3 = validateRecommendation({ ...v4, schemaVersion: 3, recommendationAudit: legacyAudit });
        expect(validV3.isValid).toBe(true);
    });

    it('rejects duplicate lineage claim ids', () => {
        const raw = validV4Recommendation();
        raw.recommendationAudit.knowledgeLineage = [
            { claimId: 'readiness.objective_mode_thresholds', version: 1 },
            { claimId: 'readiness.objective_mode_thresholds', version: 2 },
        ];
        const result = validateRecommendation(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.field === 'recommendationAudit')).toBe(true);
    });
});
