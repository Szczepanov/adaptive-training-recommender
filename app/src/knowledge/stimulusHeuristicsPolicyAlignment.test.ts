import { describe, expect, it } from 'vitest';
import type {
    DailyReadiness,
    DimensionalFatigue,
    EngineObjectiveInput,
    SubjectiveInput,
    UserContext,
} from '../engine/models';
import type { CompletedExposure } from '../engine/microcycleHistory';
import {
    CONFIDENCE_CREDIT_WEIGHT,
    deriveObjectiveCreditFromProfile,
} from '../engine/stimulus';
import {
    LEGACY_KEYWORD_COMPATIBILITY_CREDIT,
    STIMULUS_CREDIT_COVERAGE_THRESHOLD,
} from '../engine/microcycle';
import {
    combineFatigue,
    estimateActivitySteps,
} from '../engine/fatigue';
import {
    DEFAULT_TRAINING_INTENT_PROFILE,
    inferAthleteTrainingState,
} from '../engine/evergreenStrategy';
import { LEGACY_SESSION_COUNT_TIE_BREAKER } from '../engine/weeklyDosePacking';
import {
    evaluateEnvelopes,
    evaluateReadinessAndSafetyEnvelope,
} from '../engine/rules';
import {
    getActiveKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

function baseContext(overrides: Partial<UserContext['preferences']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
            ...overrides,
        },
    };
}

function greenSubjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9,
        sleepQuality: 9,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 9,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function quietObjective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 85,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5,
        rhr_stdev_28d: 3.5,
        sleep_score_stdev_28d: 7.8,
        ...overrides,
    };
}

function greenReadiness(
    subjectiveOverrides: Partial<SubjectiveInput> = {},
    objectiveOverrides: Partial<EngineObjectiveInput> = {},
): DailyReadiness {
    return {
        subjective: greenSubjective(subjectiveOverrides),
        objective: quietObjective(objectiveOverrides),
    };
}

describe('stimulus credit & heuristics product-claim alignment (SKR3 W2b)', () => {
    it('passes canonical sports knowledge registry validation with all stimulus heuristics claims included', () => {
        const result = validateCanonicalSportsKnowledgeRegistry();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('pins the stimulus confidence credit weights to production CONFIDENCE_CREDIT_WEIGHT', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.objectiveCreditConfidencePolicy);
        expect(claim.status).toBe('active');
        expect(claim.evidenceCertainty).toBe('not_applicable');
        expect(claim.statement).toContain('exact evidence earns 1.0 weight, inferred evidence earns 0.75 weight, and unknown evidence earns 0.40 weight');

        expect(CONFIDENCE_CREDIT_WEIGHT.exact).toBe(1.0);
        expect(CONFIDENCE_CREDIT_WEIGHT.inferred).toBe(0.75);
        expect(CONFIDENCE_CREDIT_WEIGHT.unknown).toBe(0.4);
    });

    it('pins the race-specific stimulus credit formula to deriveObjectiveCreditFromProfile', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.raceSpecificCreditFormulaPolicy);
        expect(claim.status).toBe('active');
        expect(claim.statement).toContain('max(fatigueResistance, 0.5*aerobicEndurance + 0.5*repeatedSurges)');

        const objective = {
            id: 'race-spec-obj',
            key: 'race_specific_endurance' as const,
            title: 'Race Specific',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: {},
        };

        const profileA = {
            aerobicEndurance: 0.4,
            repeatedSurges: 0.4,
            fatigueResistance: 0.7,
            thresholdPower: 0,
            vo2MaxPower: 0,
            sprintPower: 0,
            maxStrength: 0,
            hypertrophy: 0,
            neuromuscular: 0,
        };
        const creditA = deriveObjectiveCreditFromProfile(objective, profileA, { plannedDurationMin: 60, completedDurationMin: 60 });
        expect(creditA.earnedCredit).toBeCloseTo(0.7, 5);

        const profileB = {
            aerobicEndurance: 0.8,
            repeatedSurges: 0.6,
            fatigueResistance: 0.5,
            thresholdPower: 0,
            vo2MaxPower: 0,
            sprintPower: 0,
            maxStrength: 0,
            hypertrophy: 0,
            neuromuscular: 0,
        };
        const creditB = deriveObjectiveCreditFromProfile(objective, profileB, { plannedDurationMin: 60, completedDurationMin: 60 });
        expect(creditB.earnedCredit).toBeCloseTo(0.7, 5);
    });

    it('pins the stimulus coverage threshold and legacy keyword credit to production constants', () => {
        const threshClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.coverageThresholdPolicy);
        expect(threshClaim.statement).toContain('0.60');
        expect(STIMULUS_CREDIT_COVERAGE_THRESHOLD).toBe(0.6);

        const keywordClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.legacyKeywordCreditPolicy);
        expect(keywordClaim.statement).toContain('0.50');
        expect(LEGACY_KEYWORD_COMPATIBILITY_CREDIT).toBe(0.5);
    });

    it('pins the fatigue max fusion and ambient step surge policies to production functions', () => {
        const fusionClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.maxFusionPolicy);
        expect(fusionClaim.statement).toContain('dimensional maximum across all six dimensions');

        const external: DimensionalFatigue = { systemic: 0.6, cardiovascular: 0.2, lowerBody: 0.5, upperBody: 0.1, impactTissue: 0.7, neuromuscular: 0.3 };
        const internal: DimensionalFatigue = { systemic: 0.4, cardiovascular: 0.5, lowerBody: 0.3, upperBody: 0.4, impactTissue: 0.6, neuromuscular: 0.5 };
        const combined = combineFatigue(external, internal);
        expect(combined).toEqual({
            systemic: 0.6,
            cardiovascular: 0.5,
            lowerBody: 0.5,
            upperBody: 0.4,
            impactTissue: 0.7,
            neuromuscular: 0.5,
        });

        const stepClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.ambientStepSurgePolicy);
        expect(stepClaim.statement).toContain('1.8x the 7-day average baseline with >=6000 excess ambient steps');
        expect(stepClaim.statement).toContain('155 and 110 steps per minute');

        expect(estimateActivitySteps({ type: 'running', duration_min: 30 })).toBe(30 * 155);
        expect(estimateActivitySteps({ type: 'walking', duration_min: 40 })).toBe(40 * 110);
    });

    it('pins the evergreen training history qualification and commitment profile to production rules', () => {
        const historyClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.trainingHistoryQualificationPolicy);
        expect(historyClaim.statement).toContain('>=14 observed days');
        expect(historyClaim.statement).toContain('<28 days is classified as limited');
        expect(historyClaim.statement).toContain('>=28 observed days, >=12 completed sessions, and >=720 total training minutes');

        const exposures: CompletedExposure[] = Array.from({ length: 12 }, (_, i) => ({
            id: `exp-${i}`,
            date: '2026-08-01',
            modality: 'Cycling',
            category: 'Easy Endurance',
            intensityClass: 'easy',
            trainingRecordLike: {
                id: `rec-${i}`,
                date: '2026-08-01',
                type: 'cycling',
                duration_min: 60,
            },
        } as unknown as CompletedExposure));

        expect(inferAthleteTrainingState([], 10).inference.dataQuality).toBe('insufficient');
        expect(inferAthleteTrainingState(exposures, 20).inference.dataQuality).toBe('limited');
        const establishedState = inferAthleteTrainingState(exposures, 28);
        expect(establishedState.inference.dataQuality).toBe('high');
        expect(establishedState.trainingAgeProxy).toBe('established');

        const commitmentClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.defaultWeeklyCommitmentPolicy);
        expect(commitmentClaim.statement).toContain('min 2, target 3, and max 4');
        expect(DEFAULT_TRAINING_INTENT_PROFILE.weeklyCommitment).toEqual({
            minSessions: 2,
            targetSessions: 3,
            maxSessions: 4,
        });
    });

    it('pins the legacy session spacing tie breaker to production values including the 7+ clamp', () => {
        const tiebreakClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.legacySessionSpacingTiebreakPolicy);
        expect(tiebreakClaim.statement).toContain('1 day for 4-6+ sessions/week');

        expect(LEGACY_SESSION_COUNT_TIE_BREAKER[2].preferredSpacingDays).toBe(3);
        expect(LEGACY_SESSION_COUNT_TIE_BREAKER[3].preferredSpacingDays).toBe(2);
        expect(LEGACY_SESSION_COUNT_TIE_BREAKER[4].preferredSpacingDays).toBe(1);
        expect(LEGACY_SESSION_COUNT_TIE_BREAKER[5].preferredSpacingDays).toBe(1);
        expect(LEGACY_SESSION_COUNT_TIE_BREAKER[6].preferredSpacingDays).toBe(1);
    });

    it('exercises production readiness tier routing and post-recover hysteresis', () => {
        const ceilingsClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.planTierCostCeilingsPolicy);
        expect(ceilingsClaim.status).toBe('active');
        expect(ceilingsClaim.statement).toContain('Rest caps at 0, Mobility caps at 0.15, Easy caps at 0.50 (matching the modify mode ceiling), Moderate caps at 0.80, and Hard allows uncapped systemic cost');

        const context = baseContext();
        expect(evaluateEnvelopes(greenReadiness(), context).plan.maxAllowableTier).toBe('Hard');
        expect(evaluateEnvelopes(greenReadiness({}, { body_battery_wake: 25 }), context).plan.maxAllowableTier).toBe('Easy');
        expect(evaluateEnvelopes(greenReadiness({ painFlag: true }), context).plan.maxAllowableTier).toBe('Mobility');
        expect(evaluateEnvelopes(greenReadiness({ alreadyTrainedToday: true }), context).plan.maxAllowableTier).toBe('Rest');

        const bufferClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.postRecoverBufferPolicy);
        expect(bufferClaim.status).toBe('active');
        expect(bufferClaim.statement).toContain("a day that evaluates to train is downgraded to modify when the previous day's resolved mode was recover");

        const withoutPreviousRecover = evaluateReadinessAndSafetyEnvelope(greenReadiness(), context, '2026-09-10', 'train');
        expect(withoutPreviousRecover.mode).toBe('train');
        expect(withoutPreviousRecover.postRecoverBufferApplied).toBe(false);

        const afterRecover = evaluateReadinessAndSafetyEnvelope(greenReadiness(), context, '2026-09-10', 'recover');
        expect(afterRecover.mode).toBe('modify');
        expect(afterRecover.postRecoverBufferApplied).toBe(true);
    });
});
