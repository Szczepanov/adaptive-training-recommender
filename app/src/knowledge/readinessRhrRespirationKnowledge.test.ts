import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

describe('RHR and respiration readiness evidence boundaries', () => {
    it('keeps the aggregate registry structurally valid across domain modules', () => {
        const result = validateCanonicalSportsKnowledgeRegistry();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('treats resting HR as an individualized contextual signal, not a standalone readiness diagnosis', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring);
        expect(claim.claimType).toBe('prognostic');
        expect(claim.evidenceCertainty).toBe('moderate');
        expect(claim.recommendationStrength).toBe('conditional');
        expect(claim.statement).toContain('individual');
        expect(claim.limitations.join(' ')).toContain('+6 bpm');
        expect(claim.limitations.join(' ')).toContain('standalone');
    });

    it('records the athlete overreaching meta-analysis without converting its group effect into a universal RHR threshold', () => {
        const source = getKnowledgeSource('BOSQUET-2008-RHR-OVERREACH-META');
        expect(source.sourceType).toBe('systematic_review');
        expect(source.synthesisMethods).toContain('meta_analysis');
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '18308872' },
            { type: 'doi', value: '10.1136/bjsm.2007.042200' },
        ]));
    });

    it('uses wearable RHR evidence to support personal baselines rather than population-normal cutoffs', () => {
        const source = getKnowledgeSource('QUER-2020-RHR-LONGITUDINAL-COHORT');
        expect(source.sourceType).toBe('cohort');
        expect(source.notes).toContain('within-person');
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring);
        expect(claim.limitations.join(' ')).toContain('population');
    });

    it('treats respiration as moderate-certainty conditional anomaly evidence without granting standalone authority', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.respirationLongitudinalContext);
        expect(claim.claimType).toBe('prognostic');
        expect(claim.evidenceCertainty).toBe('moderate');
        expect(claim.recommendationStrength).toBe('conditional');
        expect(claim.statement).toContain('conservative readiness adjustment');
        expect(claim.statement).toContain('not a specific illness diagnosis');
        expect(claim.limitations.join(' ')).toContain('standalone');
        expect(claim.limitations.join(' ')).toContain('1 br/min');
        expect(claim.limitations.join(' ')).toContain('0.3');
    });

    it('records direct athlete evidence that RR can rise before other wearable signals', () => {
        const source = getKnowledgeSource('RENTERIA-2024-ATHLETE-COVID-WEARABLE');
        expect(source.sourceType).toBe('cohort');
        expect(source.notes).toContain('three days');
        expect(source.notes).toContain('14 analyzable');
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '37401442' },
            { type: 'pmcid', value: 'PMC10333556' },
            { type: 'doi', value: '10.1177/19417381231183709' },
        ]));
    });

    it('uses the systematic review as early-anomaly support rather than a universal training threshold', () => {
        const source = getKnowledgeSource('MITRATZA-2022-WEARABLE-INFECTION-REVIEW');
        expect(source.sourceType).toBe('systematic_review');
        expect(source.synthesisMethods).toContain('narrative_synthesis');
        expect(source.notes).toContain('varied widely');
        expect(source.notes).toContain('not a universal RR threshold');
    });

    it('preserves the non-specificity seen in prospective wearable infection validation', () => {
        const source = getKnowledgeSource('ESMAEILPOUR-2024-WEARABLE-INFECTION-VALIDATION');
        expect(source.sourceType).toBe('cohort');
        expect(source.notes).toContain('false-positive');
        expect(source.notes).toContain('exercise');
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '39018555' },
            { type: 'pmcid', value: 'PMC11292157' },
            { type: 'doi', value: '10.2196/53716' },
        ]));
    });
});