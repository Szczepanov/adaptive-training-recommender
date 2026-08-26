import { describe, expect, it } from 'vitest';
import { validateSubjectiveInputContract, validateObservationEnvelopesContract } from './observationEngineContract';
import { evaluateEnvelopes } from '../engine/rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from '../engine/models';

describe('ObservationEngineContract', () => {
    const baseSubjective: SubjectiveInput = {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 3,
        soreness: 2,
        stress: 2,
        motivation: 8,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };

    const baseObjective: EngineObjectiveInput = {
        sleep_score: 85,
        sleep_duration_min: 480,
        rhr: 48,
        rhr_7d_avg: 49,
        rhr_delta: -1,
        hrv_weekly_avg: 65,
        hrv_last_night: 68,
        hrv_delta: 3,
        hrv_stdev_28d: null,
        rhr_stdev_28d: null,
        sleep_score_stdev_28d: null,
        respiration: 14.2,
        respiration_delta: 0,
        respiration_delta_28d: 0,
        respiration_mad_28d: null,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 2,
        rhr_delta_28d: -2,
        hrv_delta_28d: 4,
        sleep_score_delta_28d: 3,
        total_steps: 8000,
        steps_7d_avg: 8500,
        steps_28d_avg: 8400,
        steps_delta_7d: -500,
        steps_delta_28d: -400,
    };

    const baseContext: UserContext = {
        preferences: {
            preferredModalities: ['Running', 'Cycling'],
            deprioritizedModalities: [],
            avoidedModalities: [],
            conservativeBias: false,
        },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: false,
            hasTreadmill: false,
            hasIndoorBike: false,
            maxTimeMinutes: 60,
            restrictedModalities: [],
            restrictedCategories: [],
            impliedGuardrails: [],
        },
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
    };

    it('enforces subjective checkin score bounds [1, 10]', () => {
        expect(validateSubjectiveInputContract(baseSubjective).valid).toBe(true);

        const invalid = { ...baseSubjective, fatigue: 15 };
        const res = validateSubjectiveInputContract(invalid);
        expect(res.valid).toBe(false);
        expect(res.errors[0]).toContain('fatigue must be an integer between 1 and 10');
    });

    it('enforces safety envelope contracts for active painFlag', () => {
        const painReadiness: DailyReadiness = {
            subjective: { ...baseSubjective, painFlag: true },
            objective: baseObjective,
        };
        const envelopes = evaluateEnvelopes(painReadiness, baseContext);
        const contractCheck = validateObservationEnvelopesContract(painReadiness, envelopes.safety, envelopes.plan);
        expect(contractCheck.valid).toBe(true);
        expect(envelopes.safety.clinicalFlagActive).toBe(true);
        expect(envelopes.safety.restrictedModalities).toContain('Running');
        expect(envelopes.plan.maxAllowableTier).toBe('Mobility');
    });

    it('enforces safety envelope contracts for alreadyTrainedToday', () => {
        const trainedReadiness: DailyReadiness = {
            subjective: { ...baseSubjective, alreadyTrainedToday: true },
            objective: baseObjective,
        };
        const envelopes = evaluateEnvelopes(trainedReadiness, baseContext);
        const contractCheck = validateObservationEnvelopesContract(trainedReadiness, envelopes.safety, envelopes.plan);
        expect(contractCheck.valid).toBe(true);
        expect(envelopes.plan.maxAllowableTier).toBe('Rest');
    });

    it('enforces plan tier cap for severe recovery depression (sleep score < 55)', () => {
        const depressedReadiness: DailyReadiness = {
            subjective: baseSubjective,
            objective: { ...baseObjective, sleep_score: 45, body_battery_wake: 25 },
        };
        const envelopes = evaluateEnvelopes(depressedReadiness, baseContext);
        const contractCheck = validateObservationEnvelopesContract(depressedReadiness, envelopes.safety, envelopes.plan);
        expect(contractCheck.valid).toBe(true);
        expect(envelopes.plan.maxAllowableTier).toBe('Easy');
    });
});
