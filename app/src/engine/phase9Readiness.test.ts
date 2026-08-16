import { describe, expect, it } from 'vitest';
import type { DailyReadiness, UserContext } from './models';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import { computeSubjectiveBaseline, REFERENCE_SUBJECTIVE_BASELINE_POLICY, type SubjectiveCheckinForBaseline } from './subjectiveBaseline';
import { addDaysToLocalDateString } from '../utils/localDate';

const DATE = '2026-08-16';

function history(): SubjectiveCheckinForBaseline[] {
    return Array.from({ length: 28 }, (_, index) => {
        const date = addDaysToLocalDateString(DATE, -(28 - index));
        const recent = date >= addDaysToLocalDateString(DATE, -7);
        return {
            date,
            readiness: recent ? 6 : 8,
            sleepQuality: recent ? 6 : 8,
            fatigue: recent ? 4 : 2,
            soreness: recent ? 4 : 2,
            mentalStress: recent ? 4 : 2,
            motivation: recent ? 6 : 8,
        };
    });
}

const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: {
        hasCableMachine: true, hasFreeWeights: true, hasTreadmill: true, hasIndoorBike: true,
        maxTimeMinutes: 90,
    },
    preferences: {
        avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false,
    },
};

const objective: DailyReadiness['objective'] = {
    total_steps: null, sleep_score: null, sleep_duration_min: null,
    rhr: null, rhr_7d_avg: null, rhr_delta: null,
    hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null,
    respiration: null, body_battery_wake: null,
    last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
    sleep_score_delta_7d: null, rhr_delta_28d: null, hrv_delta_28d: null,
    sleep_score_delta_28d: null, hrv_stdev_28d: null, rhr_stdev_28d: null,
    sleep_score_stdev_28d: null,
};

const subjective: DailyReadiness['subjective'] = {
    readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
    timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
};

describe('Phase 9.4 composed baseline reaches the pure readiness evaluator', () => {
    it('is inert under production-default off but changes the measured candidate when explicitly enabled', () => {
        const baseline = computeSubjectiveBaseline(history(), DATE, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(baseline).not.toBeNull();
        expect(baseline?.historyThroughDateExclusive).toBe(DATE);

        const readiness: DailyReadiness = { subjective, objective, subjectiveBaseline: baseline };
        const withoutBaseline = evaluateReadinessAndSafetyEnvelope({ subjective, objective }, context);
        const productionDefault = evaluateReadinessAndSafetyEnvelope(readiness, context);
        const measuredCandidate = evaluateReadinessAndSafetyEnvelope(readiness, context, undefined, undefined, 'drift');

        expect(productionDefault).toEqual(withoutBaseline);
        expect(['modify', 'recover']).toContain(measuredCandidate.mode);
        expect(measuredCandidate.mode).not.toBe('train');
    });
});
