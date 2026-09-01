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

    it('supports supplemental strength for endurance performance without overstating certainty or turning it into a VO2max or universal-dose claim', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.enduranceStrengthPerformanceSupport);
        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'low',
            recommendationStrength: 'conditional',
        });
        expect(claim.statement).toContain('economy or efficiency');
        expect(claim.statement).toContain('without reliably increasing VO2max');
        expect(claim.limitations.join(' ')).toContain('cross-sport claim is therefore intentionally low-certainty');
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

    it('uses current concurrent evidence without manufacturing a universal sequence or spacing rule', () => {
        const source = getKnowledgeSource('HELD-2026-CONCURRENT-TRAINING-UMBRELLA');
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.concurrentSequenceGoalPriority);
        expect(source.sourceType).toBe('umbrella_review');
        expect(source.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '41762427' },
            { type: 'doi', value: '10.1007/s40279-026-02401-y' },
            { type: 'prospero', value: 'CRD42025646460' },
        ]));
        expect(source.notes).toContain('simultaneous, same day or different day');
        expect(claim).toMatchObject({
            evidenceCertainty: 'moderate',
            recommendationStrength: 'conditional',
            applicability: { horizon: 'chronic' },
        });
        expect(claim.statement).toContain('resistance-before-endurance');
        expect(claim.statement).toContain('less important for aerobic development');
        expect(claim.statement).toContain('does not establish one universal order');
        expect(claim.applicability.outcomes).not.toContain('session_quality');
        expect(claim.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceId: 'BANGSBO-2025-ELITE-ATHLETE-CONSENSUS', directness: 'partially_direct' }),
        ]));
        expect(claim.limitations.join(' ')).toContain('Acute residual fatigue');
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

    it('preserves this pack’s coverage state while later migrations update the global inventory', () => {
        expect(summarizeKnowledgeCoverage()).toMatchObject({
            total: 53,
            byCoverage: { covered: 17, partial: 8, uncovered: 22, not_applicable: 6 },
            highImpactUncovered: 9,
            highSafetyUncovered: 0,
        });
    });
});
