import { describe, expect, it } from 'vitest';

import type { DailyReadiness, TrainingIntentProfile } from './models';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolveTrainingIntent } from './trainingIntent';

const ZERO_COST = {
    systemic: 0.25,
    cardiovascular: 0.35,
    lowerBody: 0.2,
    upperBody: 0,
    impactTissue: 0.15,
    neuromuscular: 0.1,
};

function exposure(date: string, index: number): CompletedExposure {
    return {
        occurrenceKey: `established-running-${index}`,
        date,
        costProfile: ZERO_COST,
        modality: 'Running',
        category: 'Easy Endurance',
        trainingRecordLike: {
            type: 'Running aerobic endurance',
            duration_min: 60,
            training_effect: 2,
            intensity_tag: 'easy',
        },
    };
}

function snapshot(throughDateExclusive: string, windowDays: number, exposures: CompletedExposure[]): TrainingHistorySnapshot {
    return {
        throughDateExclusive,
        windowDays,
        completedEvents: [],
        exposures,
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: `activities-${windowDays}` },
            recommendations: { status: 'AVAILABLE', revision: `recommendations-${windowDays}` },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: '2026-08-31T00:00:00.000Z',
        revision: `test-history-${windowDays}`,
    };
}

const READINESS: DailyReadiness = {
    subjective: {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        stress: 3,
        motivation: 9,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: 'Running',
    },
    objective: {
        total_steps: 8000,
        sleep_score: 82,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 55,
        hrv_last_night: 55,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 80,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8,
        rhr_stdev_28d: 3,
        sleep_score_stdev_28d: 7,
    },
};

const PROFILE: TrainingIntentProfile = {
    userId: 'established-athlete',
    planningMode: 'evergreen',
    priorities: ['endurance'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    organizationPreference: 'auto',
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

describe('evergreen established-history evidence', () => {
    it('keeps operational history at 7 days while using 28 days for athlete-state inference', async () => {
        const dates = [
            '2026-08-04', '2026-08-06', '2026-08-08', '2026-08-10',
            '2026-08-12', '2026-08-14', '2026-08-16', '2026-08-18',
            '2026-08-20', '2026-08-22', '2026-08-24', '2026-08-26',
        ];
        const allExposures = dates.map(exposure);
        const requestedWindows: number[] = [];
        const provider: TrainingHistoryProvider = {
            reconstruct: async (_userId, throughDateExclusive, windowDays) => {
                const start = windowDays === 7 ? '2026-08-24' : '2026-08-03';
                return allExposures.filter(item => item.date >= start && item.date < throughDateExclusive);
            },
            getSnapshot: async (_userId, throughDateExclusive, windowDays) => {
                requestedWindows.push(windowDays);
                const start = windowDays === 7 ? '2026-08-24' : '2026-08-03';
                return snapshot(
                    throughDateExclusive,
                    windowDays,
                    allExposures.filter(item => item.date >= start && item.date < throughDateExclusive),
                );
            },
        };

        const intent = await resolveTrainingIntent(
            'established-athlete',
            [],
            '2026-08-31',
            READINESS,
            7,
            provider,
            undefined,
            [],
            PROFILE,
        );

        expect(requestedWindows).toEqual([7, 28]);
        expect(intent.history).toHaveLength(2);
        expect(intent.history.every(item => item.date >= '2026-08-24')).toBe(true);
        expect(intent.historySnapshot?.windowDays).toBe(7);
        expect(intent.historySnapshot?.athleteStateEvidence?.observedWindowDays).toBe(28);
        expect(intent.historySnapshot?.athleteStateEvidence?.exposures).toHaveLength(12);

        const athleteState = inferAthleteTrainingState(
            intent.historySnapshot?.athleteStateEvidence?.exposures ?? [],
            intent.historySnapshot?.athleteStateEvidence?.observedWindowDays ?? 0,
        );
        expect(athleteState.inference.dataQuality).toBe('high');
        expect(athleteState.trainingAgeProxy).toBe('established');

        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, athleteState);
        expect(strategy.hardSessionCap).toBe(2);
        expect(strategy.requirements.some(requirement => requirement.adaptation === 'high_intensity')).toBe(true);
        expect(strategy.warnings.some(warning => warning.code === 'conditional_prior_withheld')).toBe(false);
    });
});
