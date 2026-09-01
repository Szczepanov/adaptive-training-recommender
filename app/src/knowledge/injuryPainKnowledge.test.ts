import { describe, expect, it } from 'vitest';
import { getActiveKnowledgeClaim, getKnowledgeClaim, getKnowledgeSource, validateCanonicalSportsKnowledgeRegistry } from './sportsKnowledgeRegistry';
import { INJURY_PAIN_CLAIM_IDS, INJURY_PAIN_POLICY_DESCRIPTOR } from './injuryPainKnowledge';

describe('injury and clinical-symptom knowledge pack', () => {
    it('keeps the canonical registry structurally valid', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('records scientific evidence as a boundary rather than validating a universal restriction', () => {
        const symptoms = getActiveKnowledgeClaim(INJURY_PAIN_CLAIM_IDS.symptomsRequireContextualAssessment);
        const returnToSport = getActiveKnowledgeClaim(INJURY_PAIN_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement);
        const tissue = getActiveKnowledgeClaim(INJURY_PAIN_CLAIM_IDS.tissueResponseTemporalMonitoring);

        expect(symptoms).toMatchObject({ maturity: 'supported', evidenceCertainty: 'moderate', recommendationStrength: 'informational', safetyImpact: 'high' });
        expect(symptoms.statement).toContain('do not independently establish a diagnosis');
        expect(returnToSport.statement).toContain('condition-, athlete-, and activity-specific');
        expect(tissue).toMatchObject({ evidenceCertainty: 'low', recommendationStrength: 'informational' });
        expect(tissue.limitations.join(' ')).toContain('does not validate the product');
        [symptoms, returnToSport, tissue].forEach(claim => {
            expect(claim.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(false);
        });
    });

    it('records each executable family as high-safety product policy', () => {
        const policyIds = [
            INJURY_PAIN_CLAIM_IDS.tissueResponseSeverityPolicy,
            INJURY_PAIN_CLAIM_IDS.lowerLimbImpactPolicy,
            INJURY_PAIN_CLAIM_IDS.lowerLimbStrengthPolicy,
            INJURY_PAIN_CLAIM_IDS.lumbarLoadingPolicy,
            INJURY_PAIN_CLAIM_IDS.upperLimbLoadingPolicy,
            INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicy,
        ];
        policyIds.forEach(id => {
            const claim = getActiveKnowledgeClaim(id);
            expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high' });
            expect(claim.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(true);
        });
    });

    it('retires the coupled v1 clinical envelope without erasing historical lineage', () => {
        const prior = getKnowledgeClaim(INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicyV1);
        const current = getActiveKnowledgeClaim(INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicy);

        expect(prior.status).toBe('deprecated');
        expect(current.supersedes).toBe(prior.id);
        expect(current.statement).toContain('only current pain/injury adds the generic Running fallback');
        expect(current.limitations.join(' ')).toContain('not a diagnosis');
    });

    it('keeps systemic symptom handling separate from contextual Running fallback semantics', () => {
        expect(INJURY_PAIN_POLICY_DESCRIPTOR.genericClinicalEnvelope).toEqual({
            aggregateFlag: 'painOrInjury || (illnessSymptoms && !allergyLikeSymptomDay)',
            sourceCategories: ['pain_or_injury', 'non_allergy_illness'],
            maxTierWhenCurrentClinicalSymptoms: 'Mobility',
            maxTierWhenAlreadyTrained: 'Rest',
            genericRunningRestriction: {
                appliesToSource: 'pain_or_injury',
                currentPainLocationSource: 'today_structured_tissue_responses_only',
                restrictWhenLocationUnknown: true,
                restrictWhenRegionFamilyIncludes: ['lower_limb_impact'],
                noGenericRestrictionForIsolatedFamilies: ['lower_limb_strength', 'lumbar_loading', 'upper_limb_loading'],
                provenanceTraceMayControlPolicy: false,
            },
        });
        expect(Object.keys(INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings)).toEqual([
            'lowerLimbImpact', 'lowerLimbStrength', 'lumbarLoading', 'upperLimbLoading',
        ]);
    });
});
