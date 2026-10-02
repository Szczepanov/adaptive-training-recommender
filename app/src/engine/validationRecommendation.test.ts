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
            candidateScores: [] as Array<Record<string, unknown>>,
            knowledgeLineage: [{ claimId: 'readiness.objective_mode_thresholds', version: 1 }],
        },
    };
}

describe('recommendation validation boundary', () => {
    it('accepts a content-addressed context binding only for the same user, date, and revision', () => {
        const base = validV4Recommendation();
        const raw = {
            ...base,
            recommendationAudit: {
                ...base.recommendationAudit,
                decisionContext: {
                    path: 'users/athlete-a/daily_recommendations/2026-08-31/decision_contexts/1',
                    revision: 1,
                    contentHash: 'a'.repeat(64),
                },
            },
        };
        expect(validateRecommendation(raw).isValid).toBe(true);

        raw.recommendationAudit.decisionContext.path = 'users/other/daily_recommendations/2026-08-31/decision_contexts/1';
        const invalid = validateRecommendation(raw);
        expect(invalid.isValid).toBe(false);
        expect(invalid.errors.some(error => error.field === 'recommendationAudit.decisionContext')).toBe(true);

        const missingRevision = {
            ...base,
            revision: undefined,
            recommendationAudit: {
                ...base.recommendationAudit,
                decisionContext: {
                    path: 'users/athlete-a/daily_recommendations/2026-08-31/decision_contexts/1',
                    revision: 1,
                    contentHash: 'a'.repeat(64),
                },
            },
        };
        const invalidMissingRevision = validateRecommendation(missingRevision);
        expect(invalidMissingRevision.isValid).toBe(false);
        expect(invalidMissingRevision.errors.some(error => error.field === 'recommendationAudit.decisionContext')).toBe(true);
    });

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

    it('rejects malformed audit provenance retained as a bounded Firestore container', () => {
        const cases = [
            {
                name: 'a lineage reference with an extra field',
                apply: (audit: Record<string, unknown>) => {
                    audit.knowledgeLineage = [{ claimId: 'readiness.objective_mode_thresholds', version: 1, extra: true }];
                },
            },
            {
                name: 'an invalid planned dose',
                apply: (audit: Record<string, unknown>) => {
                    audit.plannedDose = { volume: -1, intensity: 1 };
                },
            },
            {
                name: 'an invalid external-plan revision',
                apply: (audit: Record<string, unknown>) => {
                    audit.externalPlan = { planId: 'autumn-block', revision: 0, sessionId: 'w1-threshold', contentHash: 'a'.repeat(64) };
                },
            },
            {
                name: 'an incomplete subjective-drift metric map',
                apply: (audit: Record<string, unknown>) => {
                    audit.subjectiveDrift = {
                        estimatorId: 'subjective-baseline-v1',
                        estimatorPolicyVersion: 'subjective-drift-v1',
                        historyThroughDateExclusive: '2026-08-31',
                        recentRecordedDays: 7,
                        longRecordedDays: 28,
                        contribution: 1,
                        decisionRelevant: true,
                        perMetricContributions: { readiness: 1 },
                    };
                },
            },
            {
                name: 'an invalid external-rest revision',
                apply: (audit: Record<string, unknown>) => {
                    audit.externalRest = {
                        planId: 'autumn-block', revision: 0, contentHash: 'a'.repeat(64),
                        restDirectiveId: 'rest-1', date: '2026-08-31',
                    };
                },
            },
            {
                name: 'an identity decision with an incomplete bundle reference',
                apply: (audit: Record<string, unknown>) => {
                    audit.identityDecision = {
                        identityAssessmentId: 'identity-1',
                        automaticStatus: 'UNCERTAIN',
                        effectiveStatus: 'UNCERTAIN',
                        reviewEventId: null,
                        identityPolicyVersion: 'identity-v1',
                        featureSchemaVersion: 'features-v1',
                        passportVersion: null,
                        sharedBundleRef: {
                            id: 'shared', provider: 'eight_sleep', transport: 'google_health',
                            revision: 1, sourcePayloadHash: 'hash',
                        },
                        anchorBundleRefs: [],
                        selectedEffectiveSource: null,
                        fallbackReason: 'ANCHOR_MISSING',
                    };
                },
            },
            {
                name: 'an audit history with an extra unvalidated key',
                apply: (audit: Record<string, unknown>) => {
                    audit.history = {
                        ...(audit.history as Record<string, unknown>),
                        extra: true,
                    };
                },
            },
            {
                name: 'an authored occurrence missing its occurrence id',
                apply: (audit: Record<string, unknown>) => {
                    audit.authoredOccurrence = { decision: 'proceed' };
                },
            },
            {
                name: 'an athlete evidence lineage ref with an extra field',
                apply: (audit: Record<string, unknown>) => {
                    audit.athleteEvidenceLineage = [{
                        recordId: 'athlete-evidence-1',
                        version: 1,
                        domain: 'subjective_calibration',
                        refinementType: 'calibrate_scalar',
                        baseKnowledgeClaimId: 'readiness.objective_mode_thresholds',
                        extra: true,
                    }];
                },
            },
            {
                name: 'duplicate athlete evidence lineage record ids',
                apply: (audit: Record<string, unknown>) => {
                    const ref = {
                        recordId: 'athlete-evidence-1',
                        version: 1,
                        domain: 'subjective_calibration',
                        refinementType: 'calibrate_scalar',
                        baseKnowledgeClaimId: 'readiness.objective_mode_thresholds',
                    };
                    audit.athleteEvidenceLineage = [ref, { ...ref, version: 2 }];
                },
            },
        ];

        for (const { name, apply } of cases) {
            const raw = validV4Recommendation();
            apply(raw.recommendationAudit as Record<string, unknown>);
            expect(validateRecommendation(raw).isValid, name).toBe(false);
        }
    });
    it('accepts bounded exact athlete-evidence lineage emitted by provenance', () => {
        const raw = validV4Recommendation();
        (raw.recommendationAudit as Record<string, unknown>).athleteEvidenceLineage = [{
            recordId: 'athlete-evidence-1',
            version: 2,
            domain: 'subjective_calibration',
            refinementType: 'calibrate_scalar',
            baseKnowledgeClaimId: 'readiness.objective_mode_thresholds',
        }];
        expect(validateRecommendation(raw).isValid).toBe(true);
    });

    it('rejects malformed optional FIT fingerprint pairs before persistence', () => {
        const base = validV4Recommendation();
        const binding = {
            sessionSource: { kind: 'catalog', workoutId: 'easy_ride', catalogVersion: 'v1' },
            prescriptionHash: 'prescription-hash',
        };
        expect(validateRecommendation({
            ...base,
            primarySession: { ...binding, fitWorkoutFingerprint: 'fit-workout-v2:abc' },
        }).isValid).toBe(false);
        expect(validateRecommendation({
            ...base,
            primarySession: {
                ...binding,
                fitWorkoutFingerprint: 'fit-workout-v2:abc',
                fitWorkoutFingerprintKind: 'unknown',
            },
        }).isValid).toBe(false);
        expect(validateRecommendation({
            ...base,
            primarySession: {
                ...binding,
                fitWorkoutFingerprint: 'fit-workout-v2:abc',
                fitWorkoutFingerprintKind: 'semantic_definition',
            },
        }).isValid).toBe(true);
    });

    it('accepts candidate scores with legacy diagnostic fields (benefitScore, costPenalty)', () => {
        const raw = validV4Recommendation();
        raw.recommendationAudit.candidateScores = [
            {
                templateId: 'end_easy_01',
                utilityScore: 0.75,
                excludedReasons: [],
                benefitScore: 1.2,
                costPenalty: 0.45,
            },
        ];
        expect(validateRecommendation(raw).isValid).toBe(true);
    });

    it('rejects candidate scores with unknown fields', () => {
        const raw = validV4Recommendation();
        raw.recommendationAudit.candidateScores = [
            {
                templateId: 'end_easy_01',
                utilityScore: 0.75,
                excludedReasons: [],
                unexpectedDiagnostic: true,
            } as Record<string, unknown>,
        ];
        const result = validateRecommendation(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.field === 'recommendationAudit')).toBe(true);
    });

    it('rejects candidate scores with non-finite or non-numeric scores', () => {
        const raw = validV4Recommendation();
        raw.recommendationAudit.candidateScores = [
            {
                templateId: 'end_easy_01',
                utilityScore: NaN,
                excludedReasons: [],
            },
        ];
        expect(validateRecommendation(raw).isValid).toBe(false);

        raw.recommendationAudit.candidateScores = [
            {
                templateId: 'end_easy_01',
                utilityScore: 0.5,
                excludedReasons: [],
                benefitScore: Infinity,
            },
        ];
        expect(validateRecommendation(raw).isValid).toBe(false);
    });
});
