import { describe, expect, it, vi } from 'vitest';
import { progressionOverrideKey } from './confirmedProgressionOverrides';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';
import { workoutForTemplate } from '../workouts/prescription';

const PROGRESSED_WORKOUT_ID = 'cycling_zone2_standard_01';

vi.mock('./optimizer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./optimizer')>();
    const { workoutForTemplate: resolveWorkout } = await import('../workouts/prescription');

    return {
        ...actual,
        rankCandidates: (...args: Parameters<typeof actual.rankCandidates>) => {
            const result = actual.rankCandidates(...args);
            const accepted = [...result.accepted];
            const targetIndex = accepted.findIndex(
                candidate => resolveWorkout(candidate.template.id)?.id === PROGRESSED_WORKOUT_ID,
            );
            if (targetIndex <= 0) return result;

            const [target] = accepted.splice(targetIndex, 1);
            return { ...result, accepted: [target, ...accepted] };
        },
    };
});

import { evaluateTrainingWithIntent } from './rules';

const EMPTY_HISTORY: TrainingHistoryProvider = {
    reconstruct: async () => [],
};

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: false,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Cycling'],
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
        preferredModalityToday: 'Cycling',
        ...overrides,
    };
}

function objective(): EngineObjectiveInput {
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
    };
}

async function recommend(
    readiness: DailyReadiness,
    overrides: ReadonlyMap<string, number>,
) {
    return evaluateTrainingWithIntent(
        'progression-execution-test',
        readiness,
        context(),
        [],
        '2026-09-10',
        undefined,
        EMPTY_HISTORY,
        null,
        [],
        [],
        null,
        null,
        undefined,
        null,
        undefined,
        undefined,
        null,
        false,
        [],
        overrides,
    );
}

describe('confirmed progression execution authority', () => {
    const overrides = new Map([
        [progressionOverrideKey('aerobic_volume', PROGRESSED_WORKOUT_ID), 70],
    ]);

    it('materializes the confirmed duration once the exact progressed workout is selected', async () => {
        const rec = await recommend(
            { subjective: subjective(), objective: objective() },
            overrides,
        );

        expect(workoutForTemplate(rec.template.id)?.id).toBe(PROGRESSED_WORKOUT_ID);
        expect(rec.activeDose).toEqual(expect.objectContaining({ durationMin: 70, durationMax: 70 }));
        expect(rec.rationale).toContain('Use the confirmed 70-minute progression dose');
    });

    it('keeps a smaller time-cap dose authoritative over a selected confirmed progression', async () => {
        const rec = await recommend(
            { subjective: subjective({ timeAvailable: 45 }), objective: objective() },
            overrides,
        );

        expect(workoutForTemplate(rec.template.id)?.id).toBe(PROGRESSED_WORKOUT_ID);
        expect(rec.activeDose?.durationMin).not.toBe(70);
        expect(rec.activeDose?.durationMax).toBeLessThanOrEqual(45);
        expect(rec.rationale).toContain('The confirmed progression remains the authored target');
        expect(rec.rationale).toContain('today’s readiness/time ceiling is lower');
    });
});
