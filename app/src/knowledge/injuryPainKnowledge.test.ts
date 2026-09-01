import { describe, expect, it } from 'vitest';
import { getActiveKnowledgeClaim, getKnowledgeSource, validateCanonicalSportsKnowledgeRegistry } from './sportsKnowledgeRegistry';
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

    it('keeps the combined clinical-symptom semantics and all four region families reviewable', () => {
        expect(INJURY_PAIN_POLICY_DESCRIPTOR.genericClinicalEnvelope).toEqual({
            painFlag: 'painOrInjury || (illnessSymptoms && !allergyLikeSymptomDay)',
            painFlagRestriction: 'Running',
            maxTierWhenPainFlag: 'Mobility',
            maxTierWhenPainFlagAndAlreadyTrained: 'Rest',
        });
        expect(Object.keys(INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings)).toEqual([
            'lowerLimbImpact', 'lowerLimbStrength', 'lumbarLoading', 'upperLimbLoading',
        ]);
    });
});
