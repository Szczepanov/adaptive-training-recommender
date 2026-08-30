import { describe, expect, it } from 'vitest';
import { ENGINE_KNOWLEDGE_COVERAGE, summarizeKnowledgeCoverage } from './knowledgeCoverage';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

const coverageById = (id: string) => ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === id);

describe('strength and concurrent training evidence pack', () => {
    it('keeps the canonical cross-domain registry valid', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('supports supplemental strength for endurance performance without turning it into a VO2max or universal-dose claim', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.enduranceStrengthPerformanceSupport);
        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'moderate',
            recommendationStrength: 'conditional',
        });
        expect(claim.statement).toContain('economy or efficiency');
        expect(claim.statement).toContain('without reliably increasing VO2max');
        expect(claim.limitations.join(' ')).toContain('two or three strength sessions');
        expect(claim.limitations.join(' ')).toContain('universal progression');
    });

    it('records direct running and cycling meta-analytic evidence with stable identities', () => {
        const running = getKnowledgeSource('LLANOS-LAGOS-2024-RUNNING-STRENGTH-META');
        const cycling = getKnowledgeSource('LLANOS-LAGOS-2026-CYCLING-STRENGTH-META');
        expect(running.sourceType).toBe('systematic_review');
        expect(running.synthesisMethods).toContain('meta_analysis');
        expect(running.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '38627351' },
            { type: 'doi', value: '10.1007/s40279-024-02018-z' },
        ]));
        expect(cycling.notes).toContain('GRADE certainty was low');
        expect(cycling.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '40632222' },
            { type: 'doi', value: '10.1007/s00421-025-05883-2' },
        ]));
    });

    it('uses the 2026 concurrent umbrella review without manufacturing a universal sequence rule', () => {
        const source = getKnowledgeSource('HELD-2026-CONCURRENT-TRAINING-UMBRELLA');
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.concurrentSequenceGoalPriority);
        expect(source.sourceType).toBe('umbrella_review');
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '41762427' },
            { type: 'doi', value: '10.1007/s40279-026-02401-y' },
            { type: 'prospero', value: 'CRD42025646460' },
        ]));
        expect(claim).toMatchObject({ evidenceCertainty: 'moderate', recommendationStrength: 'conditional' });
        expect(claim.statement).toContain('athlete priority');
        expect(claim.statement).toContain('does not establish a universal sequence advantage');
        expect(claim.limitations.join(' ')).toContain('0-1-day');
    });

    it('does not launder strength effect sizes into existing product calibration', () => {
        expect(coverageById('evergreen.strength_default_upper_target')).toMatchObject({
            classification: 'product_heuristic',
            coverage: 'covered',
        });
        expect(coverageById('spacing.strength_key_cycling_adjacency')).toMatchObject({
            classification: 'product_heuristic',
            coverage: 'covered',
        });
        expect(coverageById('spacing.hard_lower_body_recovery')).toMatchObject({
            coverage: 'partial',
            researchPriority: 'p1',
        });
        expect(coverageById('optimizer.stimulus_benefit_weights')).toMatchObject({
            coverage: 'uncovered',
            researchPriority: 'p2',
        });
    });

    it('leaves coverage totals unchanged because this pack deepens an already-covered boundary', () => {
        expect(summarizeKnowledgeCoverage()).toMatchObject({
            total: 47,
            byCoverage: { covered: 15, partial: 1, uncovered: 26, not_applicable: 5 },
            highImpactUncovered: 13,
            highSafetyUncovered: 4,
        });
    });
});
