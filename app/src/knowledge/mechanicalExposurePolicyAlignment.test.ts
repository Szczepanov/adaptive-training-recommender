import { describe, expect, it } from 'vitest';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from '../engine/evergreenStrategy';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { DailySubjectiveCheckin } from '../engine/models';
import {
    evaluateMechanicalGuardrails,
    evaluateMechanicalProgression,
} from '../engine/mechanicalProgression';
import {
    grantsMechanicalExposureCredit,
    MECHANICAL_QUALIFYING_IDENTITIES,
    MECHANICAL_QUALIFYING_WORKOUT_IDS,
} from '../workouts/mechanicalExposure';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

const exposures: CompletedExposure[] = Array.from({ length: 12 }, (_, index) => ({
    occurrenceKey: `run-${index}`,
    date: `2026-08-${String(4 + index * 2).padStart(2, '0')}`,
    modality: 'Running',
    category: 'Easy Endurance',
    costProfile: { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.1 },
    trainingRecordLike: { type: 'Running aerobic endurance', duration_min: 60, training_effect: 2, intensity_tag: 'easy' },
}));

const checkin = (overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin => ({
    userId: 'athlete',
    date: '2026-09-20',
    readiness: 8,
    soreness: 2,
    fatigue: 2,
    mentalStress: 2,
    motivation: 8,
    sleepQuality: 8,
    painOrInjury: false,
    illnessSymptoms: false,
    unusuallyLimitedTime: false,
    alreadyTrainedToday: false,
    availability: {
        timeAvailableMin: 60,
        preferredModalityToday: 'Running',
        indoorOnly: false,
    },
    notes: null,
    submittedAt: '2026-09-20T07:00:00.000Z',
    createdAt: '2026-09-20T07:00:00.000Z',
    updatedAt: '2026-09-20T07:00:00.000Z',
    dataQuality: {
        isComplete: true,
        missingFields: [],
    },
    schemaVersion: 1,
    ...overrides,
});

describe('mechanical exposure policy alignment (ADR-0033, issue #804)', () => {
    it('registers an evidence claim with explicit limitations and a separate product-policy claim', () => {
        const evidence = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.progressiveMechanicalLoading);
        expect(evidence).toMatchObject({
            claimType: 'causal',
            evidenceCertainty: 'moderate',
            recommendationStrength: 'conditional',
            safetyImpact: 'moderate',
        });
        expect(evidence.limitations.some(limitation => limitation.includes('saturation') || limitation.includes('microdamage'))).toBe(true);

        const policy = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.mechanicalExposurePolicy);
        expect(policy).toMatchObject({
            claimType: 'heuristic',
            maturity: 'heuristic',
            evidenceCertainty: 'not_applicable',
            version: 1,
            safetyImpact: 'high',
        });
        expect(policy.statement).toContain('4 discrete stages');
        expect(policy.statement).toContain('fails closed');

        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.mechanical_exposure');
        expect(coverage).toMatchObject({
            classification: 'product_heuristic',
            coverage: 'covered',
            decisionImpact: 'high',
            safetyImpact: 'high',
            researchPriority: 'none',
            knowledgeRefs: [policy.id, evidence.id],
        });
    });

    it('keeps the implemented target, ceiling and delivery aligned with the policy claim', () => {
        const state = inferAthleteTrainingState(exposures, 28);
        expect(state.trainingAgeProxy).toBe('established');
        const mechanical = resolveEvidenceBackedStrategy({ priorities: ['sport_readiness'] }, state).requirements
            .find(requirement => requirement.adaptation === 'mechanical_exposure');

        expect(mechanical).toMatchObject({
            floor: null,
            delivery: 'embedded',
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            evidence: { knowledgeClaimId: KNOWLEDGE_CLAIM_IDS.mechanicalExposurePolicy, knowledgeClaimVersion: 1 },
        });
        expect(mechanical?.substitutionPolicy.permittedModalities).toEqual(['Running', 'Field', 'Strength']);
    });

    it('keeps qualifying identities mapped to the 4 stages and exact dose variants', () => {
        expect(MECHANICAL_QUALIFYING_IDENTITIES.length).toBeGreaterThanOrEqual(10);
        expect(MECHANICAL_QUALIFYING_WORKOUT_IDS).toEqual(MECHANICAL_QUALIFYING_IDENTITIES.map(i => i.workoutId));

        // Stage 1 covers walk-run and landing
        const stage1 = MECHANICAL_QUALIFYING_IDENTITIES.filter(i => i.stage === 1);
        expect(stage1.some(i => i.workoutId === 'running_walk_run_01')).toBe(true);

        // Stage 2 covers linear running and bilateral plyometrics
        const stage2 = MECHANICAL_QUALIFYING_IDENTITIES.filter(i => i.stage === 2);
        expect(stage2.some(i => i.workoutId === 'running_easy_continuous_01')).toBe(true);
        expect(stage2.some(i => i.workoutId === 'strength_reactive_power_01')).toBe(true);

        // Stage 3 covers deceleration/braking mechanics
        const stage3 = MECHANICAL_QUALIFYING_IDENTITIES.filter(i => i.stage === 3);
        expect(stage3.some(i => i.workoutId === 'field_acceleration_braking_01')).toBe(true);

        // Stage 4 covers multidirectional COD
        const stage4 = MECHANICAL_QUALIFYING_IDENTITIES.filter(i => i.stage === 4);
        expect(stage4.some(i => i.workoutId === 'field_controlled_maintenance_01')).toBe(true);

        // Readiness-modified doses never earn credit
        expect(grantsMechanicalExposureCredit({ workoutId: 'running_easy_continuous_01', isReadinessModifiedDose: true })).toBe(false);
        // Full doses earn credit
        expect(grantsMechanicalExposureCredit({ workoutId: 'running_easy_continuous_01', variant: 'full' })).toBe(true);
    });

    it('enforces response-gated progression, fail-closed missing evidence, and symptom regression', () => {
        // Missing follow-up evidence fails closed: cannot advance from Stage 1 to Stage 2
        const missingVerdict = evaluateMechanicalProgression({
            asOfDate: '2026-09-20',
            exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
            checkinHistory: [],
            targetStage: 2,
        });
        expect(missingVerdict.stage).toBe(1);
        expect(missingVerdict.tissueResponse.verdict).toBe('missing');
        expect(missingVerdict.eligibleWorkoutIds).toContain('running_walk_run_01');
        expect(missingVerdict.eligibleWorkoutIds).not.toContain('running_easy_continuous_01');

        // Positive normal response permits advancement to Stage 2
        const advanceVerdict = evaluateMechanicalProgression({
            asOfDate: '2026-09-20',
            exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
            checkinHistory: [
                {
                    date: '2026-09-18',
                    checkin: checkin({
                        tissueResponses: {
                            knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' },
                        },
                    }),
                },
            ],
            targetStage: 2,
        });
        expect(advanceVerdict.stage).toBe(2);
        expect(advanceVerdict.tissueResponse.verdict).toBe('normal');
        expect(advanceVerdict.eligibleWorkoutIds).toContain('running_easy_continuous_01');

        // Adverse symptoms cause regression to Stage 1
        const regressedVerdict = evaluateMechanicalProgression({
            asOfDate: '2026-09-20',
            exposureHistory: [{ date: '2026-09-17', workoutId: 'running_easy_continuous_01', stage: 2 }],
            checkinHistory: [
                {
                    date: '2026-09-18',
                    checkin: checkin({
                        tissueResponses: {
                            achilles: { region: 'achilles', morningState: 'mild' },
                        },
                    }),
                },
            ],
            targetStage: 2,
        });
        expect(regressedVerdict.stage).toBe(1);
        expect(regressedVerdict.status).toBe('regressed');
        expect(regressedVerdict.tissueResponse.verdict).toBe('adverse');

        // Gap >= 14 days causes re-entry at Stage 1
        const gapVerdict = evaluateMechanicalProgression({
            asOfDate: '2026-09-20',
            exposureHistory: [{ date: '2026-09-01', workoutId: 'field_acceleration_braking_01', stage: 3 }],
            checkinHistory: [{ date: '2026-09-20', checkin: checkin() }],
            targetStage: 3,
        });
        expect(gapVerdict.stage).toBe(1);
        expect(gapVerdict.tissueResponse.verdict).toBe('none_recent');
    });

    it('blocks mechanical targets immediately under guardrails while preserving typed reasons', () => {
        expect(evaluateMechanicalGuardrails({ avoid_high_impact: true })).toMatchObject({
            blocked: true,
            reasons: ['avoid_high_impact_active'],
        });
        expect(evaluateMechanicalGuardrails({ knee_swelling: true })).toMatchObject({
            blocked: true,
            reasons: ['knee_swelling_reported'],
        });
        expect(evaluateMechanicalGuardrails({ acute_pain: true })).toMatchObject({
            blocked: true,
            reasons: ['acute_pain_reported'],
        });
        expect(evaluateMechanicalGuardrails({})).toMatchObject({
            blocked: false,
            reasons: [],
        });
    });
});
