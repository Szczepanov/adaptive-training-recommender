import { describe, expect, it } from 'vitest';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

const coverageById = (id: string) => ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === id);

describe('taper and fueling evidence pack', () => {
    it('keeps the canonical registry structurally valid', () => {
        const result = validateCanonicalSportsKnowledgeRegistry();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('supports pre-event volume reduction with maintained intensity without validating the app exact windows', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper);
        expect(claim).toMatchObject({
            claimType: 'intervention',
            evidenceCertainty: 'moderate',
            recommendationStrength: 'conditional',
        });
        expect(claim.statement).toContain('41-60%');
        expect(claim.statement).toContain('athlete- and event-dependent');
        expect(claim.limitations.join(' ')).toContain('14 days');
        expect(claim.limitations.join(' ')).toContain('post-event');
    });

    it('records both modern and classic taper meta-analyses with stable identifiers', () => {
        const modern = getKnowledgeSource('WANG-2023-ENDURANCE-TAPER-META');
        const classic = getKnowledgeSource('BOSQUET-2007-TAPER-META');
        expect(modern.sourceType).toBe('systematic_review');
        expect(modern.synthesisMethods).toContain('meta_analysis');
        expect(modern.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '37163550' },
            { type: 'pmcid', value: 'PMC10171681' },
            { type: 'doi', value: '10.1371/journal.pone.0282838' },
        ]));
        expect(classic.externalIds).toEqual(expect.arrayContaining([
            { type: 'pmid', value: '17762369' },
            { type: 'doi', value: '10.1249/mss.0b013e31806010e0' },
        ]));
    });

    it('keeps exact taper timing, pre-event blocks and sharpening values as product heuristics', () => {
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.taperWindowsVolumePolicy)).toMatchObject({
            claimType: 'heuristic', evidenceCertainty: 'not_applicable', maturity: 'heuristic',
        });
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.preEventRestrictionsPolicy)).toMatchObject({
            claimType: 'heuristic', evidenceCertainty: 'not_applicable',
        });
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.taperSharpeningPolicy)).toMatchObject({
            claimType: 'heuristic', evidenceCertainty: 'not_applicable',
        });
    });

    it('supports carbohydrate during endurance exercise while keeping dose bands contextual', () => {
        const efficacy = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.carbohydrateDuringExercise);
        const dose = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.carbohydrateEventScaledDose);
        expect(efficacy).toMatchObject({ evidenceCertainty: 'high', recommendationStrength: 'strong' });
        expect(dose).toMatchObject({ evidenceCertainty: 'moderate', recommendationStrength: 'conditional' });
        expect(dose.statement).toContain('30-60 g/h');
        expect(dose.statement).toContain('90 g/h');
        expect(dose.statement).toContain('not mandatory universal doses');
        const meta = getKnowledgeSource('RAMOS-CAMPO-2024-CARBOHYDRATE-META');
        expect(meta.notes).toContain('136 studies');
    });

    it('treats avoidance of overdrinking as a high-safety hydration boundary', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hydrationAvoidOverdrinking);
        expect(claim).toMatchObject({
            claimType: 'safety', evidenceCertainty: 'high', recommendationStrength: 'strong', safetyImpact: 'high',
        });
        expect(claim.statement).toContain('excessive fluid');
        expect(claim.statement).toContain('hyponatremia');
        expect(claim.limitations.join(' ')).toContain('no single mL/h');
    });

    it('does not pretend fueling has live engine decision authority or that the bundled taper inventory is fully migrated', () => {
        expect(ENGINE_KNOWLEDGE_COVERAGE.some(item => item.domain === 'periodization_taper')).toBe(true);
        expect(coverageById('periodization.taper_windows_volume')).toMatchObject({ coverage: 'uncovered', researchPriority: 'p0' });
        expect(ENGINE_KNOWLEDGE_COVERAGE.some(item => item.id.includes('fuel'))).toBe(false);
    });
});
