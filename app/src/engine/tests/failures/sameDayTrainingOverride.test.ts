import { describe, it, expect } from 'vitest';
import { evaluateReadinessAndSafetyEnvelope } from '../../rules';
import type { DailyReadiness, UserContext } from '../../models';

describe('Same-day completed-training safety override', () => {
    it('recovers when both wearable training and already-trained check-in evidence are present', () => {
        const readiness: DailyReadiness = {
            subjective: {
                readiness: 8,
                fatigue: 3,
                soreness: 2,
                stress: 3,
                sleepQuality: 8,
                motivation: 8,
                timeAvailable: 60,
                painFlag: false,
                alreadyTrainedToday: true, // Athlete completed session
                preferredModalityToday: null,
            },
            objective: {
                total_steps: 8000,
                sleep_score: 85,
                sleep_duration_min: 480,
                rhr: 48,
                rhr_7d_avg: 48,
                rhr_delta: 0,
                hrv_weekly_avg: 65,
                hrv_last_night: 65,
                hrv_delta: 0,
                hrv_delta_28d: 0,
                hrv_stdev_28d: 5.0,
                rhr_delta_28d: 0,
                rhr_stdev_28d: 2.0,
                sleep_score_delta_7d: 0,
                sleep_score_delta_28d: 0,
                sleep_score_stdev_28d: 5.0,
                respiration: 14,
                body_battery_wake: 85,
                last_3_days_hard_sessions_count: 0,
                yesterday_training: null,
                today_training: {
                    type: 'strength_training',
                    duration_min: 60,
                    training_effect: 2.5,
                    intensity_tag: 'moderate',
                },
            },
        };

        const context: UserContext = {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            constraints: {
                maxTimeMinutes: 60,
                hasCableMachine: false,
                hasFreeWeights: true,
                hasTreadmill: false,
                hasIndoorBike: false,
                restrictedModalities: [],
            },
            preferences: {
                preferredModalities: ['Running'],
                avoidedModalities: [],
                deprioritizedModalities: [],
                conservativeBias: false,
            },
        };

        const result = evaluateReadinessAndSafetyEnvelope(readiness, context, '2026-08-26');
        expect(result.alreadyTrainedOverride).toBe(true);
        expect(result.mode).toBe('recover');
    });
});
