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
            sourceType: 'scoping_review',
            synthesisMethods: ['narrative_synthesis'],
        });
        expect(source.externalIds).toContainEqual({ type: 'doi', value: '10.1007/s42978-025-00361-9' });
        expect(source.notes).toContain('strength-trained males');
        expect(source.notes).toContain('does not establish one universal protocol');
    });

    it('records the resistance trials with exact stable identifiers', () => {
        const specificTrial = getKnowledgeSource('RIBEIRO-2020-SPECIFIC-WARMUP-TRIAL');
        expect(specificTrial).toMatchObject({
            publishedOn: '2020-09-22',
            title: 'The Role of Specific Warm-up during Bench Press and Squat Exercises: A Novel Approach',
        });
        expect(specificTrial.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '32971729' },
            { type: 'pmcid', value: 'PMC7558980' },
            { type: 'doi', value: '10.3390/ijerph17186882' },
        ]));

        const nullTrial = getKnowledgeSource('RIBEIRO-2014-WARMUP-NULL-TRIAL');
        expect(nullTrial).toMatchObject({
            publishedOn: '2014-08-01',
            title: 'Effect of different warm-up procedures on the performance of resistance training exercises',
        });
        expect(nullTrial.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '25153744' },
            { type: 'doi', value: '10.2466/25.29.PMS.119c17z7' },
        ]));
    });

    it('keeps the specific-rehearsal applicability bounded to measured acute performance outcomes', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.specificRehearsal);
        expect(claim.applicability.outcomes).toEqual(['acute_performance']);
        expect(claim.applicability.outcomes).not.toContain('movement_quality');
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
