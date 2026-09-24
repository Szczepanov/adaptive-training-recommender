import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

describe('performance-goal workout training evidence pack', () => {
    it('keeps the canonical cross-domain registry valid', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('supports strength-oriented loading without claiming one universal deadlift prescription', () => {
        const source = getKnowledgeSource('CURRIER-2023-RT-PRESCRIPTION-NMA');
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strengthHighLoadStrengthGain);

        expect(source).toMatchObject({
            sourceType: 'systematic_review',
            synthesisMethods: ['network_meta_analysis'],
        });
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '37414459' },
            { type: 'doi', value: '10.1136/bjsports-2023-106807' },
        ]));
        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'moderate',
            recommendationStrength: 'conditional',
        });
        expect(claim.statement).toContain('higher-load');
        expect(claim.limitations.join(' ')).toContain('does not validate the catalog deadlift session');
        expect(claim.limitations.join(' ')).toContain('Aspirational goal 1RM');
    });

    it('supports short sprint training while preserving protocol-level uncertainty', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.cyclingShortSprintAnaerobicPerformance);
        const sourceIds = claim.evidence.map(link => link.sourceId);

        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'low',
            recommendationStrength: 'conditional',
        });
        expect(sourceIds).toEqual(expect.arrayContaining([
            'HALL-2023-SIT-PERFORMANCE-META',
            'BOULLOSA-2022-SHORT-SIT-META',
            'HAZELL-2010-SHORT-CYCLING-SIT',
        ]));
        expect(getKnowledgeSource('BOULLOSA-2022-SHORT-SIT-META').externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '35090181' },
            { type: 'doi', value: '10.1111/sms.14133' },
        ]));
        expect(claim.limitations.join(' ')).toContain('five 8-second sprints with 240-second recovery');
    });

    it('keeps exact catalog scalars as explicit product heuristics rather than scientific certainty', () => {
        const deadlift = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.deadliftDirectPracticePolicy);
        const cycling = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.cyclingSprintPowerPolicy);

        for (const claim of [deadlift, cycling]) {
            expect(claim).toMatchObject({
                claimType: 'heuristic',
                maturity: 'heuristic',
                evidenceCertainty: 'not_applicable',
                recommendationStrength: 'conditional',
            });
            expect(claim.evidence).toEqual([
                { sourceId: 'PRODUCT-PG6-WORKOUT-COVERAGE-V1', directness: 'direct' },
            ]);
        }
        expect(deadlift.statement).toContain('three work sets of three repetitions');
        expect(deadlift.limitations.join(' ')).toContain('not a scientifically proven universal optimum');
        expect(cycling.statement).toContain('five 8-second maximal cycling sprints');
        expect(cycling.limitations.join(' ')).toContain('goal wattage');
    });
});
