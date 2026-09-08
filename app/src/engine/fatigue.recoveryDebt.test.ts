import { describe, it, expect } from 'vitest';
import { computeInternalResponseStrain } from './fatigue';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput } from './models';

function neutralSubjective(): SubjectiveInput {
    return {
        readiness: 6,
        sleepQuality: 6,
        fatigue: 3,
        soreness: 2,
        stress: 3,
        motivation: 7,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };
}

function baseObjective(): EngineObjectiveInput {
    return {
        total_steps: 8000,
        steps_7d_avg: 8000,
        sleep_score: 80,
        sleep_duration_min: 480,
        sleep_score_delta_7d: 0,
        sleep_score_delta_28d: 0,
        sleep_score_stdev_28d: 5,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        rhr_delta_28d: 0,
        rhr_stdev_28d: 2,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        hrv_delta_28d: 0,
        hrv_stdev_28d: 5,
        respiration: 14,
        respiration_delta: 0,
        respiration_delta_28d: 0,
        respiration_mad_28d: 1,
        body_battery_wake: 75,
        yesterday_training: null,
        today_training: null,
        last_3_days_hard_sessions_count: 0,
    };
}

describe('computeInternalResponseStrain recovery debt calibration', () => {
    it('produces modest baseline systemic fatigue under healthy metrics', () => {
        const readiness: DailyReadiness = {
            subjective: neutralSubjective(),
            objective: baseObjective(),
        };
        const strain = computeInternalResponseStrain(readiness);
        expect(strain.systemic).toBeLessThan(0.25);
    });

    it('enforces acute recovery debt floor when body battery is critically depleted (<= 25)', () => {
        const readiness: DailyReadiness = {
            subjective: neutralSubjective(),
            objective: {
                ...baseObjective(),
                body_battery_wake: 25,
            },
        };
        const strain = computeInternalResponseStrain(readiness);
        // Under critical body battery depletion, systemic strain must reach the modify-inducing floor (>= 0.60)
        expect(strain.systemic).toBeGreaterThanOrEqual(0.60);
    });

    it('enforces acute recovery debt floor when sleep is severely deficient (duration <= 330 min and score <= 55)', () => {
        const readiness: DailyReadiness = {
            subjective: neutralSubjective(),
            objective: {
                ...baseObjective(),
                sleep_duration_min: 315, // 5.25 hours
                sleep_score: 52,
                body_battery_wake: 45,
            },
        };
        const strain = computeInternalResponseStrain(readiness);
        // Truncated sleep duration combined with poor sleep score must trigger the acute recovery debt floor
        expect(strain.systemic).toBeGreaterThanOrEqual(0.60);
    });

    it('factors in sleep duration deficit when duration is below 7 hours even with moderate score', () => {
        const goodDurationReadiness: DailyReadiness = {
            subjective: neutralSubjective(),
            objective: {
                ...baseObjective(),
                sleep_score: 65,
                sleep_duration_min: 480, // 8h
            },
        };
        const shortDurationReadiness: DailyReadiness = {
            subjective: neutralSubjective(),
            objective: {
                ...baseObjective(),
                sleep_score: 65,
                sleep_duration_min: 330, // 5.5h
            },
        };

        const goodStrain = computeInternalResponseStrain(goodDurationReadiness);
        const shortStrain = computeInternalResponseStrain(shortDurationReadiness);

        expect(shortStrain.systemic).toBeGreaterThan(goodStrain.systemic);
    });
});
