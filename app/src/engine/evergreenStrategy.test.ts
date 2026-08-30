import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from './trainingHistory';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledge';

const exposure = (duration: number): CompletedExposure => ({
    date: '2026-08-01', trainingRecordLike: { type: 'Cycling endurance', duration_min: duration, training_effect: 0, intensity_tag: '' },
    costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
});

describe('evergreen evidence-backed strategy', () => {
    it('keeps sparse history unknown and withholds conditional intensity', () => {
        const state = inferAthleteTrainingState([], 7);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, state);
        expect(state.trainingAgeProxy).toBe('unknown');
        expect(state.inference).toMatchObject({ dataQuality: 'insufficient', diagnostics: [{ code: 'insufficient_history' }] });
        expect(strategy.requirements.map(requirement => requirement.adaptation)).not.toContain('high_intensity');
        expect(strategy.warnings).toEqual([{ code: 'conditional_prior_withheld', message: expect.any(String) }]);
    });

    it('carries active claim-level provenance on every resolved requirement', () => {
        const state = inferAthleteTrainingState(Array.from({ length: 12 }, () => exposure(60)), 28);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['health', 'endurance'] }, state);
        expect(state.trainingAgeProxy).toBe('established');
        expect(strategy.requirements).toHaveLength(3);
        strategy.requirements.forEach(requirement => {
            expect(requirement.knowledgeRefs.length).toBeGreaterThan(0);
            requirement.knowledgeRefs.forEach(claimId => expect(() => getActiveKnowledgeClaim(claimId)).not.toThrow());
            expect(requirement.evidence).toMatchObject({
                knowledgeClaimId: expect.any(String),
                knowledgeClaimVersion: expect.any(Number),
                sourceId: expect.any(String),
                sourceIds: expect.any(Array),
                population: expect.any(String),
                outcome: expect.any(String),
                policyVersion: expect.any(String),
                reviewedOn: expect.any(String),
                status: 'active',
            });
            expect(requirement.knowledgeRefs).toContain(requirement.evidence.knowledgeClaimId);
        });
    });

    it('keeps the WHO strength floor separate from the product-only upper target', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['health'] }, inferAthleteTrainingState([], 7));
        const strength = strategy.requirements.find(requirement => requirement.adaptation === 'strength');
        expect(strength?.knowledgeRefs).toEqual([
            KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency,
            KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget,
        ]);
        expect(strength?.evidence).toMatchObject({
            knowledgeClaimId: KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency,
            confidence: 'high',
            evidenceCertainty: 'moderate',
            authority: 'guideline_target',
        });
    });

    it('preserves Evergreen dose values while migrating provenance', () => {
        const established = inferAthleteTrainingState(Array.from({ length: 12 }, () => exposure(60)), 28);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['health', 'endurance'] }, established);
        const aerobic = strategy.requirements.find(requirement => requirement.adaptation === 'aerobic_endurance');
        const strength = strategy.requirements.find(requirement => requirement.adaptation === 'strength');
        const highIntensity = strategy.requirements.find(requirement => requirement.adaptation === 'high_intensity');

        expect(aerobic).toMatchObject({
            floor: { dose: { unit: 'minutes', value: 150 } },
            target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
        });
        expect(strength).toMatchObject({
            floor: { dose: { unit: 'sessions', value: 2 } },
            target: { unit: 'sessions', minimum: 2, target: 2, maximum: 3 },
        });
        expect(highIntensity).toMatchObject({
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            evidence: {
                knowledgeClaimId: KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior,
                confidence: 'low',
                evidenceCertainty: 'not_applicable',
                maturity: 'heuristic',
            },
        });
        expect(strategy.hardSessionCap).toBe(2);
    });

    it('does not manufacture strength development for an endurance-only priority', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, inferAthleteTrainingState([], 7));
        expect(strategy.requirements.map(requirement => requirement.adaptation)).not.toContain('strength');
    });

    it('treats an explicitly chosen endurance priority as required, not a droppable target', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, inferAthleteTrainingState([], 7));
        const aerobic = strategy.requirements.find(requirement => requirement.adaptation === 'aerobic_endurance');
        expect(aerobic?.priority).toBe('required');
    });

    it('keeps both WHO-backed health adaptations required instead of making strength opportunistic', () => {
        for (const broadPriority of ['health', 'balanced_performance'] as const) {
            const strategy = resolveEvidenceBackedStrategy({ priorities: [broadPriority] }, inferAthleteTrainingState([], 7));
            const aerobic = strategy.requirements.find(requirement => requirement.adaptation === 'aerobic_endurance');
            const strength = strategy.requirements.find(requirement => requirement.adaptation === 'strength');
            expect(aerobic?.priority).toBe('required');
            expect(strength?.priority).toBe('required');
            expect(strength?.floor).toMatchObject({ dose: { unit: 'sessions', value: 2 } });
        }
    });

    it('does not let health or balanced_performance demote an explicit strength_muscle priority', () => {
        for (const broadPriority of ['health', 'balanced_performance'] as const) {
            const strategy = resolveEvidenceBackedStrategy({ priorities: [broadPriority, 'strength_muscle'] }, inferAthleteTrainingState([], 7));
            const strength = strategy.requirements.find(requirement => requirement.adaptation === 'strength');
            expect(strength?.priority).toBe('required');
            expect(strength?.floor).toMatchObject({ dose: { unit: 'sessions', value: 2 } });
        }
    });

    it('keeps endurance and strength_muscle both required when chosen together, so neither starves the other', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance', 'strength_muscle'] }, inferAthleteTrainingState([], 7));
        const aerobic = strategy.requirements.find(requirement => requirement.adaptation === 'aerobic_endurance');
        const strength = strategy.requirements.find(requirement => requirement.adaptation === 'strength');
        expect(aerobic?.priority).toBe('required');
        expect(strength?.priority).toBe('required');
    });

    it('treats conflicting structured modality and recorded session type as conservative evidence', () => {
        const conflicting: CompletedExposure = {
            ...exposure(60), modality: 'Cycling', trainingRecordLike: { type: 'Strength session', duration_min: 60, training_effect: 0, intensity_tag: '' },
        };
        const state = inferAthleteTrainingState(Array.from({ length: 12 }, () => conflicting), 28);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, state);
        expect(state).toMatchObject({ trainingAgeProxy: 'unknown', inference: { dataQuality: 'conflicting', diagnostics: [{ code: 'conflicting_history' }] } });
        expect(strategy.requirements.map(requirement => requirement.adaptation)).not.toContain('high_intensity');
    });
});
