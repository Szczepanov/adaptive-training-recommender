import { describe, expect, it } from 'vitest';
import { WORKOUTS } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES } from './templates';
import type { SessionTemplate } from './models';
import type { PerformedExposureFact } from './performedTrainingFacts';
import {
    buildPerformedStimulusRecency,
    evaluateCandidateStimulusRecency,
    isConfidentStimulusExposure,
    STIMULUS_REPETITION_PENALTY,
    stimulusFamilyFromDomain,
    TEMPLATE_STIMULUS_FAMILY,
    WORKOUT_STIMULUS_FAMILY,
} from './stimulusRecency';

function mockTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'mock_template_01',
        title: 'Mock Template',
        description: 'Mock',
        category: 'Easy Endurance',
        modality: 'Cycling',
        durationMin: 45,
        durationMax: 60,
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0.3,
        objectiveTransferable: true,
        costProfile: {
            systemic: 0.3,
            cardiovascular: 0.3,
            lowerBody: 0.3,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0.2,
        },
        stimulusProfile: {
            aerobicEndurance: 0.5,
            thresholdPower: 0,
            vo2MaxPower: 0,
            repeatedSurges: 0,
            sprintPower: 0,
            fatigueResistance: 0.3,
            maxStrength: 0,
            hypertrophy: 0,
        },
        ...overrides,
    } as SessionTemplate;
}

function mockFact(overrides: Partial<PerformedExposureFact> = {}): PerformedExposureFact {
    return {
        performedOccurrenceId: 'occ-1',
        localDate: '2026-09-09',
        modality: 'Cycling',
        confidence: 'high',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
        ...overrides,
    };
}

describe('stimulusRecency', () => {
    describe('completeness & authored mapping', () => {
        it('maps every catalog workout dynamically without undefined entries', () => {
            for (const workout of WORKOUTS) {
                expect(workout.id in WORKOUT_STIMULUS_FAMILY, `Missing mapping for workout ${workout.id}`).toBe(true);
                expect(WORKOUT_STIMULUS_FAMILY[workout.id]).not.toBeUndefined();
            }
        });

        it('aligns quality candidate families with their materialized catalog workout', () => {
            for (const template of ENRICHED_TEMPLATES) {
                const family = TEMPLATE_STIMULUS_FAMILY[template.id];
                if (!['tempo', 'threshold', 'vo2', 'race'].includes(family ?? '')) continue;
                const workout = workoutForTemplate(template.id);
                expect(workout, template.id).toBeDefined();
                expect.soft(WORKOUT_STIMULUS_FAMILY[workout!.id], template.id).toBe(family);
            }
        });

        it('maps every enriched template dynamically without undefined entries', () => {
            for (const template of ENRICHED_TEMPLATES) {
                expect(template.id in TEMPLATE_STIMULUS_FAMILY, `Missing mapping for template ${template.id}`).toBe(true);
                expect(TEMPLATE_STIMULUS_FAMILY[template.id]).not.toBeUndefined();
            }
        });

        it('resolves key deliberate workout and template classifications', () => {
            expect(WORKOUT_STIMULUS_FAMILY.end_hard_01).toBeUndefined(); // end_hard_01 is a template, not a catalog workout
            expect(TEMPLATE_STIMULUS_FAMILY.end_hard_01).toBe('vo2');
            expect(WORKOUT_STIMULUS_FAMILY.running_vo2_4x4_01).toBe('vo2');

            expect(WORKOUT_STIMULUS_FAMILY.cycling_tempo_surges_01).toBe('tempo');
            expect(TEMPLATE_STIMULUS_FAMILY.end_mod_02).toBe('tempo');

            expect(WORKOUT_STIMULUS_FAMILY.running_tempo_01).toBe('tempo');
            expect(TEMPLATE_STIMULUS_FAMILY.end_mod_01).toBe('tempo');

            expect(WORKOUT_STIMULUS_FAMILY.swimming_easy_aerobic_01).toBe('endurance');
            expect(TEMPLATE_STIMULUS_FAMILY.swim_easy_01).toBe('endurance');

            expect(WORKOUT_STIMULUS_FAMILY.swimming_threshold_intervals_01).toBe('threshold');
            expect(TEMPLATE_STIMULUS_FAMILY.swim_threshold_01).toBe('threshold');

            // Technical skill and power maintenance explicitly map to null
            expect(WORKOUT_STIMULUS_FAMILY.swimming_technique_01).toBeNull();
            expect(WORKOUT_STIMULUS_FAMILY.field_sprint_mechanics_foundation_01).toBeNull();
            expect(WORKOUT_STIMULUS_FAMILY.strength_compact_power_01).toBeNull();
            expect(TEMPLATE_STIMULUS_FAMILY.str_power_01).toBeNull();
            expect(TEMPLATE_STIMULUS_FAMILY.swim_technique_01).toBeNull();
        });
    });

    describe('domain to stimulus family mapping', () => {
        it('consolidates provider domains correctly', () => {
            expect(stimulusFamilyFromDomain('endurance')).toBe('endurance');
            expect(stimulusFamilyFromDomain('tempo')).toBe('tempo');
            expect(stimulusFamilyFromDomain('threshold')).toBe('threshold');
            expect(stimulusFamilyFromDomain('vo2')).toBe('vo2');
            expect(stimulusFamilyFromDomain('anaerobic')).toBe('race');
            expect(stimulusFamilyFromDomain('mixed')).toBe('race');
            expect(stimulusFamilyFromDomain('race')).toBe('race');
            expect(stimulusFamilyFromDomain('strength')).toBe('strength');
            expect(stimulusFamilyFromDomain('recovery')).toBe('recovery');
            expect(stimulusFamilyFromDomain('unknown')).toBeNull();
            expect(stimulusFamilyFromDomain(undefined)).toBeNull();
            expect(stimulusFamilyFromDomain(null)).toBeNull();
        });
    });

    describe('isConfidentStimulusExposure', () => {
        it('treats structured executions as confident', () => {
            const exp = mockFact({ sourceKinds: ['structured_execution'], stimulusDomain: 'tempo' });
            expect(isConfidentStimulusExposure(exp)).toBe(true);
        });

        it('treats version >= 2 provider activities with known domain as confident', () => {
            const exp = mockFact({
                sourceKinds: ['provider_activity'],
                intensityClassificationVersion: 2,
                stimulusDomain: 'tempo',
            });
            expect(isConfidentStimulusExposure(exp)).toBe(true);
        });

        it('rejects version < 2 provider activities', () => {
            const exp = mockFact({
                sourceKinds: ['provider_activity'],
                intensityClassificationVersion: 1,
                stimulusDomain: 'tempo',
            });
            expect(isConfidentStimulusExposure(exp)).toBe(false);
        });

        it('rejects provider activities with unknown or missing domain', () => {
            const expUnknown = mockFact({
                sourceKinds: ['provider_activity'],
                intensityClassificationVersion: 2,
                stimulusDomain: 'unknown',
            });
            expect(isConfidentStimulusExposure(expUnknown)).toBe(false);

            const expMissing = mockFact({
                sourceKinds: ['provider_activity'],
                intensityClassificationVersion: 2,
                stimulusDomain: undefined,
            });
            expect(isConfidentStimulusExposure(expMissing)).toBe(false);
        });

        it('rejects plain StrengthExposureLike entries lacking sourceKinds', () => {
            expect(isConfidentStimulusExposure({ localDate: '2026-09-09', modality: 'Cycling' })).toBe(false);
        });
    });

    describe('evaluation & anti-repetition penalty', () => {
        const targetDate = '2026-09-10';
        const dMinus1 = '2026-09-09';
        const dMinus2 = '2026-09-08';

        it('penalizes same quality family from D-1 by 0.2', () => {
            const exposures = [
                mockFact({
                    localDate: dMinus1,
                    sourceKinds: ['provider_activity'],
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'tempo',
                }),
            ];
            const recency = buildPerformedStimulusRecency(exposures, targetDate);
            expect(recency.yesterdayQualityFamilies.has('tempo')).toBe(true);

            const tempoCandidate = mockTemplate({ id: 'end_mod_02' }); // tempo
            const result = evaluateCandidateStimulusRecency(tempoCandidate, recency, false);

            expect(result.stimulusMultiplier).toBe(STIMULUS_REPETITION_PENALTY);
            expect(result.trace.penaltyApplied).toBe(true);
            expect(result.trace.isQualityRepetition).toBe(true);
            expect(result.rationaleNote).toContain('Quality family \'tempo\' repetition from D-1');
        });

        it('does NOT penalize different quality families (e.g. tempo yesterday vs threshold today)', () => {
            const exposures = [
                mockFact({
                    localDate: dMinus1,
                    sourceKinds: ['provider_activity'],
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'tempo',
                }),
            ];
            const recency = buildPerformedStimulusRecency(exposures, targetDate);
            const thresholdCandidate = mockTemplate({ id: 'swim_threshold_01' }); // threshold
            const result = evaluateCandidateStimulusRecency(thresholdCandidate, recency, false);

            expect(result.stimulusMultiplier).toBe(1.0);
            expect(result.trace.penaltyApplied).toBe(false);
            expect(result.trace.isQualityRepetition).toBe(false);
        });

        it('does NOT penalize quality performed on D-2 (lookback is strictly D-1)', () => {
            const exposures = [
                mockFact({
                    localDate: dMinus2,
                    sourceKinds: ['provider_activity'],
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'tempo',
                }),
            ];
            const recency = buildPerformedStimulusRecency(exposures, targetDate);
            const tempoCandidate = mockTemplate({ id: 'end_mod_02' });
            const result = evaluateCandidateStimulusRecency(tempoCandidate, recency, false);

            expect(result.stimulusMultiplier).toBe(1.0);
            expect(result.trace.penaltyApplied).toBe(false);
        });

        it('waives quality repetition penalty when fulfilsNominatedAnchor is true', () => {
            const exposures = [
                mockFact({
                    localDate: dMinus1,
                    sourceKinds: ['provider_activity'],
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'vo2',
                }),
            ];
            const recency = buildPerformedStimulusRecency(exposures, targetDate);
            const vo2Candidate = mockTemplate({ id: 'end_hard_01' }); // vo2
            const result = evaluateCandidateStimulusRecency(vo2Candidate, recency, true);

            expect(result.stimulusMultiplier).toBe(1.0);
            expect(result.trace.penaltyApplied).toBe(false);
            expect(result.trace.anchorWaived).toBe(true);
            expect(result.rationaleNote).toContain('repetition waived: candidate fulfils nominated anchor');
        });

        it('exempts consecutive Zone 2 aerobic endurance from repetition penalty', () => {
            const exposures = [
                mockFact({
                    localDate: dMinus1,
                    sourceKinds: ['provider_activity'],
                    intensityClassificationVersion: 2,
                    stimulusDomain: 'endurance',
                }),
            ];
            const recency = buildPerformedStimulusRecency(exposures, targetDate);
            expect(recency.hasConfidentEnduranceYesterday).toBe(true);

            const enduranceCandidate = mockTemplate({ id: 'end_easy_01' });
            const result = evaluateCandidateStimulusRecency(enduranceCandidate, recency, false);

            expect(result.stimulusMultiplier).toBe(1.0);
            expect(result.trace.enduranceExemptionApplied).toBe(true);
            expect(result.rationaleNote).toContain('Consecutive Zone 2 endurance admitted');
        });
    });
});
