import { describe, expect, it } from 'vitest';
import { evaluateEnvelopes, evaluateReadinessAndSafetyEnvelope, evaluateTraining } from './rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';

function context(): UserContext {
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
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function objective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
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

function readiness(
    subjectiveOverrides: Partial<SubjectiveInput> = {},
    objectiveOverrides: Partial<EngineObjectiveInput> = {},
): DailyReadiness {
    return {
        subjective: subjective(subjectiveOverrides),
        objective: objective(objectiveOverrides),
    };
}

describe('plan-judge calibration policy guards', () => {
    it('treats isolated very high stress as modify rather than full recovery', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ stress: 9 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('modify');
        expect(result.fatigueTriggeredRecover).toBe(false);
    });

    it('forces recovery for combined high fatigue and low readiness even when objective metrics are green', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ fatigue: 8, readiness: 4 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('recover');
        expect(result.fatigueTriggeredRecover).toBe(true);
    });

    it('keeps low motivation alone from becoming a physiological safety downgrade', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ motivation: 2 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('train');
    });

    it('reacts to a strong acute RHR elevation even when the other recovery signals are green', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({}, { rhr: 56, rhr_delta: 6, rhr_delta_28d: 6 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('modify');
    });

    it('makes the sleep-score plan-envelope floor explicit at the boundary', () => {
        const below = evaluateEnvelopes(readiness({}, { sleep_score: 54 }), context());
        const at = evaluateEnvelopes(readiness({}, { sleep_score: 55 }), context());

        expect(below.plan.maxAllowableTier).toBe('Easy');
        expect(at.plan.maxAllowableTier).toBe('Hard');
    });

    it('makes the body-battery plan-envelope floor explicit at the boundary', () => {
        const below = evaluateEnvelopes(readiness({}, { body_battery_wake: 29 }), context());
        const at = evaluateEnvelopes(readiness({}, { body_battery_wake: 30 }), context());

        expect(below.plan.maxAllowableTier).toBe('Easy');
        expect(at.plan.maxAllowableTier).toBe('Hard');
    });

    it('auto-applies a template easier dose when a modify-day pick supports one', () => {
        const result = evaluateTraining(
            readiness({ stress: 9, timeAvailable: 15, preferredModalityToday: 'Mobility' }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('modify');
        expect(result.template.id).toBe('mob_01');
        expect(result.template.easierDose).toBeDefined();
        expect(result.activeDose).toEqual(result.template.easierDose);
        expect(result.adjustment).toMatchObject({
            direction: 'easier',
            tier: 1,
            originalTemplateId: 'mob_01',
        });
    });
});
