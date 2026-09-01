import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

describe('structured strength warm-up evidence', () => {
    it('keeps the canonical registry valid after adding current resistance-specific evidence', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('records the 2026 resistance warm-up scoping review with stable provenance', () => {
        const source = getKnowledgeSource('NEVES-2026-RESISTANCE-WARMUP-SCOPING');
        expect(source).toMatchObject({
            sourceType: 'systematic_review',
            synthesisMethods: ['narrative_synthesis'],
        });
        expect(source.externalIds).toContainEqual({ type: 'doi', value: '10.1007/s42978-025-00361-9' });
        expect(source.notes).toContain('strength-trained males');
        expect(source.notes).toContain('does not establish one universal protocol');
    });

    it('keeps both warm-up claims conditional, low-certainty, and explicitly non-preventive', () => {
        for (const claimId of [KNOWLEDGE_CLAIM_IDS.contextualPreparation, KNOWLEDGE_CLAIM_IDS.specificRehearsal]) {
            const claim = getActiveKnowledgeClaim(claimId);
            expect(claim).toMatchObject({
                claimType: 'intervention',
                evidenceCertainty: 'low',
                recommendationStrength: 'conditional',
                safetyImpact: 'low',
            });
            expect(claim.evidence).toEqual(expect.arrayContaining([
                expect.objectContaining({ sourceId: 'NEVES-2026-RESISTANCE-WARMUP-SCOPING', directness: 'direct' }),
            ]));
            expect(claim.limitations.join(' ').toLowerCase()).toContain('injury-prevention');
        }
    });
});
