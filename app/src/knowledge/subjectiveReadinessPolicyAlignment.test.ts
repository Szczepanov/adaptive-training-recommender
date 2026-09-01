import { describe, expect, it } from 'vitest';
import { mapCheckinToSubjectiveInput } from '../engine/adapters';
import type { DailyReadiness, DailySubjectiveCheckin, EngineObjectiveInput, SubjectiveInput, UserContext } from '../engine/models';
import { evaluateReadinessAndSafetyEnvelope } from '../engine/rules';
import { canGenerateNormalRecommendation, getMinimumSafetyCheckinStatus } from '../engine/safetyCheckin';
import { SUBJECTIVE_READINESS_POLICY_DESCRIPTOR } from './subjectiveReadinessKnowledge';

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: false, restrictedModalities: [], maxTimeMinutes: 90 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9, sleepQuality: 9, fatigue: 2, soreness: 2, stress: 3, motivation: 9,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function objective(): EngineObjectiveInput {
    return {
        total_steps: null, sleep_score: null, sleep_duration_min: null, rhr: null, rhr_7d_avg: null, rhr_delta: null,
        hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null, respiration: null, body_battery_wake: null,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: null,
        rhr_delta_28d: null, hrv_delta_28d: null, sleep_score_delta_28d: null, hrv_stdev_28d: null,
        rhr_stdev_28d: null, sleep_score_stdev_28d: null,
    };
}

function mode(overrides: Partial<SubjectiveInput>): string {
    const readiness: DailyReadiness = { subjective: subjective(overrides), objective: objective() };
    return evaluateReadinessAndSafetyEnvelope(readiness, context()).mode;
}

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete', date: '2026-09-01', readiness: null, sleepQuality: null, fatigue: 6, soreness: null,
        mentalStress: null, motivation: null, painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false,
        alreadyTrainedToday: false, availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: '2026-09-01T06:00:00.000Z', dataQuality: { isComplete: false, missingFields: [] },
        schemaVersion: 1, createdAt: '2026-09-01T06:00:00.000Z', updatedAt: '2026-09-01T06:00:00.000Z', ...overrides,
    };
}

describe('subjective readiness policy alignment', () => {
    it('pins five equal-weight dimensions, inversions, and strict composite thresholds', () => {
        expect(SUBJECTIVE_READINESS_POLICY_DESCRIPTOR.composite).toEqual({
            denominator: 5,
            dimensions: { fatigue: 'direct', soreness: 'direct', readiness: 'inverted', sleepQuality: 'inverted', motivation: 'inverted' },
            modifyWhen: '> 5', recoverWhen: '> 7',
        });
        // Exactly 5 remains train; the smallest integer movement above 5 modifies.
        expect(mode({ readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, motivation: 5 })).toBe('train');
        expect(mode({ readiness: 4, sleepQuality: 5, fatigue: 5, soreness: 5, motivation: 5 })).toBe('modify');
        // Exactly 7 does not recover; the smallest integer movement above 7 does.
        expect(mode({ readiness: 3, sleepQuality: 3, fatigue: 7, soreness: 7, motivation: 3 })).toBe('modify');
        expect(mode({ readiness: 2, sleepQuality: 3, fatigue: 7, soreness: 7, motivation: 3 })).toBe('recover');
    });

    it('pins independent strict trigger boundaries on both sides', () => {
        expect(mode({ soreness: 6 })).toBe('train');
        expect(mode({ soreness: 7 })).toBe('modify');
        expect(mode({ soreness: 8 })).toBe('modify');
        expect(mode({ soreness: 9 })).toBe('recover');
        expect(mode({ fatigue: 8 })).toBe('modify');
        expect(mode({ fatigue: 9 })).toBe('recover');
        expect(mode({ readiness: 4 })).toBe('train');
        expect(mode({ readiness: 3 })).toBe('modify');
        expect(mode({ stress: 8 })).toBe('train');
        expect(mode({ stress: 9 })).toBe('modify');
    });

    it('isolates every severe-distress recover conjunction at its inclusive boundaries', () => {
        // fatigue >= 8 && readiness <= 4
        expect(mode({ fatigue: 8, readiness: 4 })).toBe('recover');
        expect(mode({ fatigue: 7, readiness: 4 })).toBe('modify');
        expect(mode({ fatigue: 8, readiness: 5 })).toBe('modify');

        // readiness <= 3 && stress >= 8
        expect(mode({ readiness: 3, stress: 8 })).toBe('recover');
        expect(mode({ readiness: 4, stress: 8 })).toBe('train');
        expect(mode({ readiness: 3, stress: 7 })).toBe('modify');

        // fatigue >= 8 && stress >= 8
        expect(mode({ fatigue: 8, stress: 8 })).toBe('recover');
        expect(mode({ fatigue: 7, stress: 8 })).toBe('train');
        expect(mode({ fatigue: 8, stress: 7 })).toBe('modify');
    });

    it('isolates the readiness/fatigue acute-modify conjunction at both inclusive boundaries', () => {
        expect(mode({ readiness: 4, fatigue: 6 })).toBe('modify');
        expect(mode({ readiness: 5, fatigue: 6 })).toBe('train');
        expect(mode({ readiness: 4, fatigue: 5 })).toBe('train');
    });

    it('documents a complete minimum-safety partial check-in as neutral-default classifier participation', () => {
        const partial = checkin();
        expect(getMinimumSafetyCheckinStatus(partial)).toBe('complete');
        expect(canGenerateNormalRecommendation(getMinimumSafetyCheckinStatus(partial))).toBe(true);
        expect(mapCheckinToSubjectiveInput(partial)).toMatchObject({
            fatigue: 6, soreness: 5, readiness: 5, sleepQuality: 5, stress: 5, motivation: 5,
        });
        expect(mode(mapCheckinToSubjectiveInput(partial))).toBe('modify');
    });

    it('keeps nearby pain/illness behavior conservative without claiming it as SEP-A threshold authority', () => {
        expect(SUBJECTIVE_READINESS_POLICY_DESCRIPTOR.excludedFromThisPolicySurface).toEqual([
            'painFlag', 'illnessSymptoms', 'subjectiveDrift',
        ]);
        expect(mode({ painFlag: true })).toBe('recover');
        const illnessInput = mapCheckinToSubjectiveInput(checkin({ illnessSymptoms: true }));
        expect(illnessInput.painFlag).toBe(true);
        expect(mode(illnessInput)).toBe('recover');
    });

    it('keeps the already-trained terminal override separate from the subjective threshold table', () => {
        expect(mode({ alreadyTrainedToday: false })).toBe('train');
        expect(mode({ alreadyTrainedToday: true })).toBe('recover');
    });
});