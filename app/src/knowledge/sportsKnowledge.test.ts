import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
    SPORTS_KNOWLEDGE_CLAIMS,
    SPORTS_KNOWLEDGE_SOURCES,
    validateSportsKnowledgeRegistry,
    type KnowledgeClaim,
    type KnowledgeSource,
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

    it('rejects circular supersedes lineage', () => {
        const first: KnowledgeClaim = {
            ...SPORTS_KNOWLEDGE_CLAIMS[0],
            id: 'test.lineage.first',
            supersedes: 'test.lineage.second',
        };
        const second: KnowledgeClaim = {
            ...SPORTS_KNOWLEDGE_CLAIMS[1],
            id: 'test.lineage.second',
            supersedes: 'test.lineage.first',
        };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [first, second]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.lineage.first: supersedes chain contains a cycle');
        expect(result.errors).toContain('claim test.lineage.second: supersedes chain contains a cycle');
    });

    it('rejects impossible calendar dates rather than only checking date shape', () => {
        const invalidClaim: KnowledgeClaim = {
            ...SPORTS_KNOWLEDGE_CLAIMS[0],
            id: 'test.invalid_date',
            reviewedOn: '2026-02-30',
        };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [invalidClaim]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.invalid_date: reviewedOn must be a valid YYYY-MM-DD calendar date');
    });

    it('represents a PubMed-indexed systematic review and its meta-analysis independently', () => {
        const reviewSource: KnowledgeSource = {
            id: 'TEST-SYSTEMATIC-REVIEW',
            title: 'Synthetic systematic review fixture',
            sourceType: 'systematic_review',
            citation: 'Synthetic review fixture for registry validation.',
            publishedOn: '2026-01-15',
            externalIds: [
                { type: 'pmid', value: '12345678' },
                { type: 'doi', value: '10.1000/test-meta' },
                { type: 'prospero', value: 'CRD420261234567' },
            ],
            synthesisMethods: ['meta_analysis'],
        };
        const claim: KnowledgeClaim = {
            ...SPORTS_KNOWLEDGE_CLAIMS[0],
            id: 'test.review_supported_claim',
            evidence: [{ sourceId: reviewSource.id, directness: 'direct' }],
        };
        expect(validateSportsKnowledgeRegistry([...SPORTS_KNOWLEDGE_SOURCES, reviewSource], [claim])).toEqual({
            valid: true,
            errors: [],
            warnings: [],
        });
    });

    it('rejects review synthesis methods on a primary study', () => {
        const invalidSource: KnowledgeSource = {
            id: 'TEST-RCT-WITH-META',
            title: 'Synthetic trial fixture',
            sourceType: 'randomized_trial',
            citation: 'Synthetic trial fixture for registry validation.',
            synthesisMethods: ['meta_analysis'],
        };
        const result = validateSportsKnowledgeRegistry([...SPORTS_KNOWLEDGE_SOURCES, invalidSource], SPORTS_KNOWLEDGE_CLAIMS);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('source TEST-RCT-WITH-META: synthesisMethods are reserved for systematic/umbrella reviews');
    });

    it('rejects duplicate stable external identifiers across source records', () => {
        const first: KnowledgeSource = {
            id: 'TEST-PUBMED-FIRST',
            title: 'First PubMed fixture',
            sourceType: 'systematic_review',
            citation: 'First fixture.',
            externalIds: [{ type: 'pmid', value: '12345678' }],
        };
        const second: KnowledgeSource = {
            id: 'TEST-PUBMED-SECOND',
            title: 'Second PubMed fixture',
            sourceType: 'systematic_review',
            citation: 'Second fixture.',
            externalIds: [{ type: 'pmid', value: '12345678' }],
        };
        const result = validateSportsKnowledgeRegistry([...SPORTS_KNOWLEDGE_SOURCES, first, second], SPORTS_KNOWLEDGE_CLAIMS);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('duplicate external source identifier: pmid:12345678');
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

    it('requires an explicit product-policy source for product heuristics', () => {
        const heuristic = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior);
        const scientificSourceId = SPORTS_KNOWLEDGE_CLAIMS[0].evidence[0].sourceId;
        const invalidClaim: KnowledgeClaim = {
            ...heuristic,
            id: 'test.heuristic_without_product_policy',
            evidence: [{ sourceId: scientificSourceId, directness: 'indirect' }],
        };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [invalidClaim]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.heuristic_without_product_policy: heuristic maturity requires an explicit product_policy source');
    });

    it('does not allow internal product policy alone to carry scientific certainty', () => {
        const scientificClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume);
        const productPolicySourceId = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior).evidence[0].sourceId;
        const invalidClaim: KnowledgeClaim = {
            ...scientificClaim,
            id: 'test.product_policy_science',
            evidence: [{ sourceId: productPolicySourceId, directness: 'direct' }],
        };
        const result = validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, [invalidClaim]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('claim test.product_policy_science: scientific certainty requires at least one non-product-policy source');
    });
});
