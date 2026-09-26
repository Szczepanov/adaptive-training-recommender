import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from './trainingHistory';
import { hasCurrentClinicalSymptoms, inferAthleteTrainingState, isFreshSubjectiveWithAdverseWearables, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import { DEFAULT_BASE_DEMAND } from './periodization';

const exposure = (duration: number): CompletedExposure => ({
    date: '2026-08-01', trainingRecordLike: { type: 'Cycling endurance', duration_min: duration, training_effect: 0, intensity_tag: '' },
    costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
});

describe('evergreen evidence-backed strategy', () => {
    it('recognizes discordant fresh subjective readiness with multiple adverse wearable signals', () => {
        expect(isFreshSubjectiveWithAdverseWearables({
            subjective: { readiness: 8, fatigue: 2, soreness: 2 },
            objective: { hrv_delta: -14, rhr_delta: 7, sleep_score: 50, body_battery_wake: 24 },
        } as never)).toBe(true);
        expect(isFreshSubjectiveWithAdverseWearables({
            subjective: { readiness: 4, fatigue: 7, soreness: 4 },
            objective: { hrv_delta: -14, rhr_delta: 7 },
        } as never)).toBe(false);
        expect(isFreshSubjectiveWithAdverseWearables({
            subjective: { readiness: 8, fatigue: 2, soreness: 2, painFlag: true },
            objective: { hrv_delta: -14, rhr_delta: 7 },
        } as never)).toBe(false);
        expect(isFreshSubjectiveWithAdverseWearables({
            subjective: { readiness: 8, fatigue: 2, soreness: 2, clinicalEnvelopeSources: ['red_flag'] },
            objective: { hrv_delta: -14, rhr_delta: 7 },
        } as never)).toBe(false);
        expect(isFreshSubjectiveWithAdverseWearables({
            subjective: { readiness: 8, fatigue: 2, soreness: 2, clinicalEnvelopeSources: ['non_allergy_illness'] },
            objective: { hrv_delta: -14, rhr_delta: 7 },
        } as never)).toBe(false);
    });

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
        // aerobic + strength + conditional high intensity + embedded power (#802)
        expect(strategy.requirements).toHaveLength(4);
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

    it('keeps the WHO aerobic requirement intact while quality allocation remains a packing concern', () => {
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

    it('uses event periodization only to suppress the generic quality prior in post-event recovery', () => {
        const established = inferAthleteTrainingState(Array.from({ length: 12 }, () => exposure(60)), 28);
        for (const phaseName of ['Base', 'Build', 'Specificity'] as const) {
            const strategy = resolveEvidenceBackedStrategy({
                priorities: ['endurance'],
                phase: { phaseName, targetDemandVector: DEFAULT_BASE_DEMAND, volumeScale: 1, intensityScale: 1, taperActive: false },
            }, established);
            expect(strategy.hardSessionCap).toBe(2);
            expect(strategy.requirements.find(r => r.adaptation === 'high_intensity')?.target.maximum).toBe(2);
        }

        const taperStrategy = resolveEvidenceBackedStrategy({
            priorities: ['endurance'],
            phase: { phaseName: 'Peak/Taper', targetDemandVector: DEFAULT_BASE_DEMAND, volumeScale: 0.7, intensityScale: 1, taperActive: true },
        }, established);
        expect(taperStrategy.hardSessionCap).toBe(2);

        const recoveryStrategy = resolveEvidenceBackedStrategy({
            priorities: ['endurance'],
            phase: { phaseName: 'Post-Event Recovery', targetDemandVector: DEFAULT_BASE_DEMAND, volumeScale: 0.5, intensityScale: 0.5, taperActive: false },
        }, established);
        expect(recoveryStrategy.requirements.some(r => r.adaptation === 'high_intensity')).toBe(false);
        expect(recoveryStrategy.hardSessionCap).toBeUndefined();
        expect(recoveryStrategy.warnings).toContainEqual(expect.objectContaining({
            code: 'conditional_prior_withheld',
            message: expect.stringContaining('post-event recovery'),
        }));
    });

    it('withholds the conditional quality prior while clinical symptoms are reported (#758)', () => {
        const established = inferAthleteTrainingState(Array.from({ length: 12 }, () => exposure(60)), 28);
        const symptomatic = resolveEvidenceBackedStrategy({ priorities: ['endurance'], hasCurrentClinicalSymptoms: true }, established);
        expect(symptomatic.requirements.some(r => r.adaptation === 'high_intensity')).toBe(false);
        expect(symptomatic.hardSessionCap).toBeUndefined();
        expect(symptomatic.requirements.some(r => r.adaptation === 'aerobic_endurance')).toBe(true);
        expect(symptomatic.warnings).toContainEqual(expect.objectContaining({
            code: 'conditional_prior_withheld',
            message: expect.stringContaining('pain, injury, illness or red-flag'),
        }));
        const clear = resolveEvidenceBackedStrategy({ priorities: ['endurance'], hasCurrentClinicalSymptoms: false }, established);
        expect(clear.requirements.some(r => r.adaptation === 'high_intensity')).toBe(true);
    });

    it('detects current clinical symptoms from the check-in', () => {
        const subjective = { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null };
        const objective = {} as never;
        expect(hasCurrentClinicalSymptoms(null)).toBe(false);
        expect(hasCurrentClinicalSymptoms({ subjective, objective } as never)).toBe(false);
        expect(hasCurrentClinicalSymptoms({ subjective: { ...subjective, painFlag: true }, objective } as never)).toBe(true);
        expect(hasCurrentClinicalSymptoms({ subjective: { ...subjective, clinicalEnvelopeSources: ['non_allergy_illness'] }, objective } as never)).toBe(true);
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
