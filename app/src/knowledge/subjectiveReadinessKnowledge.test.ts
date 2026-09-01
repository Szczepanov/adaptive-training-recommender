import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';
import { SUBJECTIVE_READINESS_CLAIM_IDS, SUBJECTIVE_READINESS_POLICY_DESCRIPTOR } from './subjectiveReadinessKnowledge';

describe('subjective readiness knowledge pack', () => {
    it('keeps the complete canonical registry structurally valid', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('limits science to contextual monitoring and measurement boundaries', () => {
        const contextual = getActiveKnowledgeClaim(SUBJECTIVE_READINESS_CLAIM_IDS.contextualMonitoring);
        const measurement = getActiveKnowledgeClaim(SUBJECTIVE_READINESS_CLAIM_IDS.measurementQualityLimits);
        const cutpoints = getActiveKnowledgeClaim(SUBJECTIVE_READINESS_CLAIM_IDS.exactCutpointLimits);
        expect(contextual).toMatchObject({ maturity: 'supported', evidenceCertainty: 'low', recommendationStrength: 'informational', safetyImpact: 'high' });
        expect(contextual.statement).toContain('do not independently establish medical cause');
        expect(contextual.limitations.some(limit => limit.includes('very low'))).toBe(true);
        expect(measurement.statement).toContain('incompletely established measurement properties');
        expect(measurement.limitations.some(limit => limit.includes('instrument-specific'))).toBe(true);
        expect(cutpoints.statement).toContain('does not validate');
        [contextual, measurement, cutpoints].forEach(claim => {
            expect(claim.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(false);
        });
        expect(contextual.evidence.some(link => getKnowledgeSource(link.sourceId).externalIds?.some(id => id.type === 'pmid' && id.value === '40159621'))).toBe(true);
        expect(measurement.evidence.some(link => getKnowledgeSource(link.sourceId).externalIds?.some(id => id.type === 'pmid' && id.value === '38451830'))).toBe(true);
    });

    it('records the live classifier as high-safety product policy rather than scientific threshold authority', () => {
        const policy = getActiveKnowledgeClaim(SUBJECTIVE_READINESS_CLAIM_IDS.modeThresholdsPolicy);
        expect(policy).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high' });
        expect(policy.statement).toContain('above 5');
        expect(policy.statement).toContain('neutral 5');
        expect(policy.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(true);
    });

    it('makes the descriptor’s exclusions and boundary operators reviewable', () => {
        expect(SUBJECTIVE_READINESS_POLICY_DESCRIPTOR).toMatchObject({
            neutralDefaultForMissingScaleDimensions: 5,
            composite: { denominator: 5, modifyWhen: '> 5', recoverWhen: '> 7' },
            independentTriggers: { sorenessModifyWhen: '> 6', fatigueRecoverWhen: '> 8', sorenessRecoverWhen: '> 8' },
        });
        expect(SUBJECTIVE_READINESS_POLICY_DESCRIPTOR.excludedFromThisPolicySurface).toEqual([
            'painFlag', 'illnessSymptoms', 'subjectiveDrift',
        ]);
    });
});