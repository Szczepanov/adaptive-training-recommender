import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
    SPORTS_KNOWLEDGE_CLAIMS,
    SPORTS_KNOWLEDGE_SOURCES,
    validateSportsKnowledgeRegistry,
    type KnowledgeClaim,
} from './sportsKnowledge';

describe('sports knowledge registry', () => {
    it('validates the checked-in registry', () => {
        expect(validateSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('fails closed when a claim references an unknown source', () => {
        const invalidClaim: KnowledgeClaim = {
            ...SPORTS_KNOWLEDGE_CLAIMS[0],
            id: 'test.unknown_source',
            evidence: [{ sourceId: 'MISSING-SOURCE', directness: 'direct' }],
        };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [invalidClaim]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.unknown_source: unknown source MISSING-SOURCE');
    });

    it('keeps scientific certainty separate from product heuristics', () => {
        const whoStrength = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency);
        const productUpperTarget = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget);

        expect(whoStrength).toMatchObject({ maturity: 'established', evidenceCertainty: 'moderate' });
        expect(productUpperTarget).toMatchObject({ maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
        expect(whoStrength.limitations.join(' ')).toContain('does not establish the product default of three sessions');
    });

    it('rejects heuristic claims that masquerade as scientific certainty', () => {
        const heuristic = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior);
        const invalidClaim: KnowledgeClaim = { ...heuristic, id: 'test.false_certainty', evidenceCertainty: 'high' };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [invalidClaim]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.false_certainty: heuristic maturity must not masquerade as scientific certainty');
    });
});
