import { describe, expect, it } from 'vitest';
import { evaluateTrainingWithIntent } from './rules';
import { progressionOverrideKey } from './confirmedProgressionOverrides';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';
import { workoutForTemplate } from '../workouts/prescription';

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
        [progressionOverrideKey('aerobic_volume', 'cycling_zone2_standard_01'), 70],
    ]);

    it('materializes the confirmed duration on the selected exact workout', async () => {
        const rec = await recommend(
            { subjective: subjective(), objective: objective() },
            overrides,
        );

        expect(workoutForTemplate(rec.template.id)?.id).toBe('cycling_zone2_standard_01');
        expect(rec.activeDose).toEqual(expect.objectContaining({ durationMin: 70, durationMax: 70 }));
        expect(rec.rationale).toContain('confirmed progression');
    });

    it('keeps a smaller time-cap dose authoritative over a larger confirmed progression', async () => {
        const rec = await recommend(
            { subjective: subjective({ timeAvailable: 45 }), objective: objective() },
            overrides,
        );

        expect(workoutForTemplate(rec.template.id)?.id).toBe('cycling_zone2_standard_01');
        expect(rec.activeDose?.durationMin).not.toBe(70);
        expect(rec.activeDose?.durationMax).toBeLessThanOrEqual(45);
        expect(rec.rationale).toContain('could not be applied because today’s safety/readiness/time ceiling is lower');
    });
});
