import { describe, expect, it } from 'vitest';
import { computeInternalResponseStrain } from '../engine/fatigue';
import { evaluateReadinessAndSafetyEnvelope } from '../engine/rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from '../engine/models';

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
            avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false,
        },
    };
}

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9, sleepQuality: 9, fatigue: 2, soreness: 2, stress: 3, motivation: 9,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
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

function readiness(objectiveOverrides: Partial<EngineObjectiveInput> = {}, subjectiveOverrides: Partial<SubjectiveInput> = {}): DailyReadiness {
    return { subjective: subjective(subjectiveOverrides), objective: objective(objectiveOverrides) };
}

describe('readiness evidence pack aligns with current decision policy', () => {
    it('does not treat a modest isolated HRV dip inside personal variability as a hard stop', () => {
        const state = evaluateReadinessAndSafetyEnvelope(readiness({ hrv_delta: -6, hrv_delta_28d: -6 }), context());
        expect(state.mode).toBe('train');
        expect(state.telemetry.metricStrain.acuteDeviation).toBeLessThan(1);
    });

    it('pins the current RHR and HRV acute modify floors as product policy', () => {
        const elevatedRhr = evaluateReadinessAndSafetyEnvelope(readiness({ rhr_delta: 6, rhr_delta_28d: 6, rhr_stdev_28d: 3 }), context());
        expect(elevatedRhr.telemetry.metricStrain.acuteDeviation).toBe(0.6);
        expect(elevatedRhr.mode).toBe('modify');

        const depressedHrv = evaluateReadinessAndSafetyEnvelope(readiness({ hrv_delta: -15, hrv_delta_28d: -15, hrv_stdev_28d: 7.5 }), context());
        expect(depressedHrv.telemetry.metricStrain.acuteDeviation).toBe(1);
        expect(depressedHrv.mode).toBe('modify');
    });

    it('pins the absolute sleep-score penalty boundary without claiming it is a clinical threshold', () => {
        const below = evaluateReadinessAndSafetyEnvelope(readiness({ sleep_score: 49 }), context());
        const at = evaluateReadinessAndSafetyEnvelope(readiness({ sleep_score: 50 }), context());
        expect(below.telemetry.contextPenalties.sleepFloorPenalty).toBe(0.5);
        expect(at.telemetry.contextPenalties.sleepFloorPenalty).toBe(0);
    });

    it('pins the current Body Battery hard recover threshold', () => {
        const atThreshold = evaluateReadinessAndSafetyEnvelope(readiness({ body_battery_wake: 20 }), context());
        const justAbove = evaluateReadinessAndSafetyEnvelope(readiness({ body_battery_wake: 21 }), context());
        expect(atThreshold.mode).toBe('recover');
        expect(justAbove.mode).toBe('train');
    });

    it('pins the internal-response normalization and fusion coefficients', () => {
        const strain = computeInternalResponseStrain(readiness(
            { hrv_delta: -15, rhr_delta: 10, sleep_score: 25 },
            { fatigue: 10, soreness: 1, motivation: 10 },
        ));
        expect(strain).toEqual({
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 0,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0.5,
        });
    });
});
