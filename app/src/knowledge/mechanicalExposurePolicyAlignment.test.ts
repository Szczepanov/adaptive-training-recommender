import { describe, expect, it } from 'vitest';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from '../engine/evergreenStrategy';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { DailySubjectiveCheckin } from '../engine/models';
import {
    evaluateMechanicalGuardrails,
    evaluateMechanicalProgression,
    MECHANICAL_CONTINUITY_WINDOW_DAYS,
    type CheckinRecord,
} from '../engine/mechanicalProgression';
import {
    EVERGREEN_MECHANICAL_DEFAULT_TARGET_STAGE_CEILING,
    evergreenMechanicalTargetStage,
    resolveEvergreenMechanicalProgression,
} from '../engine/evergreenPlanning';
import { mechanicalEvidenceRequired } from '../engine/trainingIntent';
import { resolvePlanningContext } from '../engine/planningMode';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import type { TrainingIntentProfile } from '../engine/models';
import {
    grantsMechanicalExposureCredit,
    MECHANICAL_QUALIFYING_IDENTITIES,
    MECHANICAL_QUALIFYING_WORKOUT_IDS,
    MECHANICAL_MAINTENANCE_WORKOUT_IDS,
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
        expect(evidence.limitations.some(limitation => limitation.includes('no-consecutive-day') || limitation.includes('14-day'))).toBe(true);

        const policy = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.mechanicalExposurePolicy);
        expect(policy).toMatchObject({
            claimType: 'heuristic',
            maturity: 'heuristic',
            evidenceCertainty: 'not_applicable',
            version: 3,
            safetyImpact: 'high',
        });
        expect(policy.statement).toContain('4 discrete stages');
        expect(policy.statement).toContain('fails closed');
        expect(policy.statement).toContain('highest stage performed with an explicit normal next-day follow-up');
        expect(policy.statement).toContain('otherwise the latest performed stage is retained for continuity');
        expect(policy.statement).toContain('explicit #805 capability-maintenance opt-in');
        expect(policy.statement).toContain('dedicated 28-day mechanical evidence stream');
        expect(policy.statement).toContain('date-scoped candidate gate');
        expect(policy.statement).toContain('full 14-day continuity window');
        expect(policy.statement).toContain('default target stage is Stage 2');
        expect(policy.statement).toContain('requires an explicit higher target');
        expect(policy.statement).toContain('already-performed Stage 3/4 is preserved');
        expect(policy.limitations.some(limitation => limitation.includes('does not establish that this policy prevents sports injury'))).toBe(true);

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
            evidence: { knowledgeClaimId: KNOWLEDGE_CLAIM_IDS.mechanicalExposurePolicy, knowledgeClaimVersion: 3 },
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

        expect(MECHANICAL_MAINTENANCE_WORKOUT_IDS).toContain('running_walk_run_01');
        expect(MECHANICAL_MAINTENANCE_WORKOUT_IDS).not.toContain('running_long_run_01');

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

        // Two explicit tolerated Stage-1 exposures permit advancement to Stage 2.
        const advanceVerdict = evaluateMechanicalProgression({
            asOfDate: '2026-09-20',
            exposureHistory: [
                { date: '2026-09-15', workoutId: 'running_walk_run_01', stage: 1 },
                { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
            ],
            checkinHistory: [
                { date: '2026-09-16', checkin: checkin({ tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } } }) },
                { date: '2026-09-18', checkin: checkin({ tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } } }) },
            ],
            targetStage: 2,
        });
        expect(advanceVerdict.stage).toBe(2);
        expect(advanceVerdict.tissueResponse.verdict).toBe('normal');
        expect(advanceVerdict.eligibleWorkoutIds).toContain('strength_reactive_power_01');
        expect(advanceVerdict.eligibleWorkoutIds).not.toContain('running_easy_continuous_01');

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

    it('keeps the continuity window and the evergreen default target aligned with the policy claim', () => {
        expect(MECHANICAL_CONTINUITY_WINDOW_DAYS).toBe(14);
        expect(EVERGREEN_MECHANICAL_DEFAULT_TARGET_STAGE_CEILING).toBe(2);
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.mechanical_exposure');
        expect(coverage?.codeRefs).toEqual(expect.arrayContaining([
            'engine/mechanicalProgression.ts:MECHANICAL_CONTINUITY_WINDOW_DAYS',
            'engine/evergreenPlanning.ts:EVERGREEN_MECHANICAL_DEFAULT_TARGET_STAGE_CEILING',
            'engine/evergreenPlanning.ts:resolveEvergreenMechanicalProgression',
        ]));

        // Cold start asks for Stage 2; a latest performed Stage 3 is kept, not demoted; an
        // explicit opt-in target (issue #805) can raise the request but never lower it.
        const stageThree = [{ date: '2026-09-17', workoutId: 'field_acceleration_braking_01', stage: 3 as const }];
        expect(evergreenMechanicalTargetStage([], '2026-09-20')).toBe(2);
        expect(evergreenMechanicalTargetStage(stageThree, '2026-09-20')).toBe(3);
        expect(evergreenMechanicalTargetStage(stageThree, '2026-09-20', 2)).toBe(3);
        expect(evergreenMechanicalTargetStage(
            [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }], '2026-09-20', 4,
        )).toBe(4);
    });

    it('lets evergreen climb the linear ladder but keeps Stage 3/4 behind explicit opt-in', () => {
        const tolerated = (date: string): CheckinRecord => ({
            date,
            checkin: checkin({ date, tissueResponses: { achilles: { region: 'achilles', morningState: 'normal', nextMorningReaction: 'normal' } } }),
        });
        const stageTwo = (date: string): CompletedExposure => ({
            ...exposures[0], occurrenceKey: `reactive-${date}`, date, workoutId: 'strength_reactive_power_01',
        });
        const history = [stageTwo('2026-09-15'), stageTwo('2026-09-17')];
        const checkins = [tolerated('2026-09-16'), tolerated('2026-09-18')];

        const walkRuns = history.map(item => ({ ...item, workoutId: 'running_walk_run_01' }));
        expect(resolveEvergreenMechanicalProgression('2026-09-20', walkRuns, checkins, new Set()).stage).toBe(2);
        expect(resolveEvergreenMechanicalProgression('2026-09-20', walkRuns, [], new Set()).stage).toBe(1);

        const evergreenDefault = resolveEvergreenMechanicalProgression('2026-09-20', history, checkins, new Set());
        expect(evergreenDefault.stage).toBe(2);
        expect(evergreenDefault.eligibleWorkoutIds).not.toContain('field_acceleration_braking_01');

        const optedIn = resolveEvergreenMechanicalProgression('2026-09-20', history, checkins, new Set(), 3);
        expect(optedIn.stage).toBe(3);
        expect(optedIn.eligibleWorkoutIds).toContain('field_acceleration_braking_01');
        expect(optedIn.eligibleWorkoutIds).not.toContain('field_controlled_maintenance_01');
    });

    it('sources wide mechanical evidence exactly for priorities that can emit the requirement', () => {
        const state = inferAthleteTrainingState(exposures, 28);
        const priorityCombos: TrainingIntentProfile['priorities'][] = [
            ['health'], ['strength_muscle'], ['balanced_performance'], ['health', 'strength_muscle'],
            ['strength_muscle', 'balanced_performance'], ['endurance'], ['endurance', 'strength_muscle'],
            ['endurance', 'health'], ['endurance', 'balanced_performance'],
            ['speed_power'], ['sport_readiness'],
        ];
        const emitting: string[] = [];
        for (const priorities of priorityCombos) {
            const emitsMechanical = resolveEvidenceBackedStrategy({ priorities }, state).requirements
                .some(requirement => requirement.adaptation === 'mechanical_exposure');
            const profile: TrainingIntentProfile = {
                userId: 'athlete', planningMode: 'evergreen', priorities,
                weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
                organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const planningContext = resolvePlanningContext(profile, evaluatePeriodizationPhase([], '2026-09-20'), '2026-09-20');
            expect(mechanicalEvidenceRequired(planningContext), priorities.join('+')).toBe(emitsMechanical);
            if (emitsMechanical) emitting.push(priorities.join('+'));
        }
        expect(emitting).toEqual(expect.arrayContaining([
            'endurance+strength_muscle',
            'endurance+health',
            'endurance+balanced_performance',
            'speed_power',
            'sport_readiness',
        ]));
        expect(emitting).not.toContain('endurance');
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
