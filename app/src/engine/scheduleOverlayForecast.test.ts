import { describe, expect, it } from 'vitest';
import { DECAY_HALF_LIVES_HOURS } from './fatigue';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from './rules';
import type { DailyReadiness, ScheduleOverlay, UserContext } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';

const TODAY = '2026-11-20';

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
            preferredModalities: ['Cycling', 'Strength'],
            conservativeBias: false,
        },
    };
}

function readiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 9,
            sleepQuality: 9,
            fatigue: 1,
            soreness: 1,
            stress: 1,
            motivation: 9,
            timeAvailable: 120,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 88,
            sleep_duration_min: 480,
            rhr: 48,
            rhr_7d_avg: 48,
            rhr_delta: 0,
            hrv_weekly_avg: 65,
            hrv_last_night: 68,
            hrv_delta: 3,
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
        },
    };
}

const EMPTY_HISTORY: TrainingHistorySnapshot = {
    throughDateExclusive: TODAY,
    windowDays: 7,
    completedEvents: [],
    exposures: [],
    sourceStates: {
        activities: { status: 'AVAILABLE', revision: 'fixture' },
        recommendations: { status: 'AVAILABLE', revision: 'fixture' },
        manualTraining: { status: 'MISSING' },
    },
    generatedAt: '2026-11-20T05:00:00.000Z',
    revision: 'history-fixture-empty',
    performedTrainingFacts: {
        asOfDate: TODAY,
        windowDays: 7,
        revision: 'performed-facts-fixture-empty',
        exposures: [],
        coverageCredits: [],
    },
};

describe('schedule overlay next-day projection', () => {
    it('carries an overlay ending today into tomorrow fatigue history exactly once', async () => {
        const r = readiness();
        const c = context();
        const todayRecommendation = await evaluateTrainingWithIntent(
            'u1',
            r,
            c,
            [],
            TODAY,
            undefined,
            undefined,
            EMPTY_HISTORY,
        );

        const baseline = await evaluateNextDayPlanWithIntent(
            'u1',
            [],
            r,
            c,
            TODAY,
            todayRecommendation,
            undefined,
            EMPTY_HISTORY,
        );

        const overlay: ScheduleOverlay = {
            id: 'ov-city-break-final-day',
            userId: 'u1',
            title: 'City break final day',
            category: 'high_step_walking',
            startDate: TODAY,
            endDate: TODAY,
            dailyAvailabilityMinutes: 120,
            volumeScale: 1,
            intensityScale: 1,
            expectedCost: {
                systemic: 0,
                cardiovascular: 0,
                lowerBody: 0.3,
                upperBody: 0,
                impactTissue: 1,
                neuromuscular: 0.1,
            },
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
        };

        const projected = await evaluateNextDayPlanWithIntent(
            'u1',
            [],
            r,
            c,
            TODAY,
            todayRecommendation,
            undefined,
            EMPTY_HISTORY,
            [],
            [],
            null,
            null,
            'max',
            'off',
            undefined,
            [overlay],
        );

        const baselineImpact = baseline.branches.green.recommendation.decisionTrace?.calibration?.fatigue.rawExternalLoad.impactTissue ?? 0;
        const projectedImpact = projected.branches.green.recommendation.decisionTrace?.calibration?.fatigue.rawExternalLoad.impactTissue ?? 0;
        const expectedSingleContribution = Math.pow(0.5, 24 / DECAY_HALF_LIVES_HOURS.impactTissue);

        // A 1.0 authored impact-tissue load is replayed once, then decayed for 24 hours
        // before tomorrow's fatigue is observed. An omission would produce zero delta;
        // duplicate replay would produce a larger delta after the same decay.
        expect(projectedImpact - baselineImpact).toBeCloseTo(expectedSingleContribution);
        // The overlay ends today, so tomorrow's increase can only come from the projected
        // history exposure, not from tomorrow's same-day availability reservation.
        expect(overlay.endDate).toBe(TODAY);
    });
});
