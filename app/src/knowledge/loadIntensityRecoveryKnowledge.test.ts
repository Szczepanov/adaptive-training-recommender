import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
} from './sportsKnowledge';

const SCIENTIFIC_CLAIMS = [
    KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution,
    KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance,
    KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue,
    KNOWLEDGE_CLAIM_IDS.concurrentStrengthEnduranceContext,
] as const;

const PRODUCT_CLAIMS = [
    KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands,
    KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap,
    KNOWLEDGE_CLAIM_IDS.anchorSpacing,
    KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing,
    KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency,
    KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty,
    KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives,
] as const;

describe('load + intensity + recovery evidence pack', () => {
    it('keeps reviewed external evidence separate from exact product calibration', () => {
        SCIENTIFIC_CLAIMS.forEach(id => {
            const claim = getActiveKnowledgeClaim(id);
            expect(claim.maturity).not.toBe('heuristic');
            expect(claim.evidenceCertainty).toBe('moderate');
            expect(claim.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType !== 'product_policy')).toBe(true);
        });

        PRODUCT_CLAIMS.forEach(id => {
            const claim = getActiveKnowledgeClaim(id);
            expect(claim).toMatchObject({ maturity: 'heuristic', evidenceCertainty: 'not_applicable', status: 'active' });
            expect(claim.evidence.every(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(true);
        });
    });

    it('records systematic-review synthesis methods and stable publication identifiers', () => {
        const intensity = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution);
        const sources = intensity.evidence.map(link => getKnowledgeSource(link.sourceId));
        expect(sources).toHaveLength(2);
        expect(sources.every(source => source.sourceType === 'systematic_review')).toBe(true);
        expect(sources.some(source => source.synthesisMethods?.includes('meta_analysis'))).toBe(true);
        expect(sources.some(source => source.synthesisMethods?.includes('network_meta_analysis'))).toBe(true);
        expect(sources.every(source => source.externalIds?.some(id => id.type === 'pmid'))).toBe(true);
        expect(sources.every(source => source.externalIds?.some(id => id.type === 'doi'))).toBe(true);
    });

    it('does not turn residual lower-body fatigue evidence into a universal 48-hour rule', () => {
        const science = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue);
        const product = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing);

        expect(science.statement).toContain('24-72 hours');
        expect(science.limitations.join(' ')).toContain('does not establish the product lowerBodyCost >= 0.6 threshold or a universal two-day gap');
        expect(product.limitations.join(' ')).toContain('product calibration');
        expect(product.limitations.join(' ')).toContain('catalog-specific');
    });

    it('makes the concurrent-training evidence constrain, rather than falsely justify, the adjacency heuristic', () => {
        const science = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.concurrentStrengthEnduranceContext);
        const product = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency);

        expect(science.statement).toContain('same day is not inherently contraindicated');
        expect(science.limitations.join(' ')).toContain('must always be separated');
        expect(product.limitations.join(' ')).toContain('more conservative');
        expect(product.limitations.join(' ')).toContain('same-day strength and endurance training is harmful');
    });

    it('states that endurance-intensity evidence cannot validate internal systemic-cost cut-points', () => {
        const science = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution);
        const product = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands);

        expect(science.limitations.join(' ')).toContain('systemicCost >= 0.5/0.6');
        expect(science.limitations.join(' ')).toContain('universal maximum count');
        expect(product.limitations.join(' ')).toContain('internal product scales');
    });
});
