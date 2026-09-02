import { describe, expect, it } from 'vitest';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 120,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9,
        sleepQuality: 9,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 9,
        timeAvailable: 90,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        answeredDimensions: ['readiness', 'sleepQuality', 'fatigue', 'soreness'],
        ...overrides,
    };
}

function objective(): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 90,
        sleep_duration_min: 480,
        rhr: 48,
        rhr_7d_avg: 48,
        rhr_delta: 0,
        hrv_weekly_avg: 60,
        hrv_last_night: 60,
        hrv_delta: 0,
        respiration: 13,
        body_battery_wake: 90,
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
    };
}

function evaluate(input: Partial<SubjectiveInput>) {
    const readiness: DailyReadiness = { subjective: subjective(input), objective: objective() };
    return evaluateReadinessAndSafetyEnvelope(readiness, context(), '2026-09-01');
}

describe('SEP-C2 absolute subjective safety threshold', () => {
    it('8/10 fatigue forces recovery even when other answered physical dimensions are excellent', () => {
        const result = evaluate({ fatigue: 8 });
        expect(result.mode).toBe('recover');
        expect(result.fatigueTriggeredRecover).toBe(true);
    });

    it('8/10 soreness forces recovery even when other answered physical dimensions are excellent', () => {
        const result = evaluate({ soreness: 8 });
        expect(result.mode).toBe('recover');
        expect(result.fatigueTriggeredRecover).toBe(true);
    });

    it('7/10 fatigue does not cross the absolute recovery override by itself', () => {
        const result = evaluate({ fatigue: 7 });
        expect(result.mode).not.toBe('recover');
    });
});
