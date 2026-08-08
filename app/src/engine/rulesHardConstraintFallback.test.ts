import { describe, expect, it, vi } from 'vitest';
import type { EngineObjectiveInput, SubjectiveInput, UserContext } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';

vi.mock('./optimizer', async () => {
    const actual = await vi.importActual<typeof import('./optimizer')>('./optimizer');
    return {
        ...actual,
        rankCandidates: vi.fn((candidates: import('./models').SessionTemplate[]) => {
            const rejected = candidates.map(template => ({
                template,
                benefitScore: 0,
                costPenalty: 0,
                utilityScore: 0,
                rationale: 'Excluded by hard constraint(s): QUALITY_SPACING_VIOLATION.',
                excludedReasons: ['QUALITY_SPACING_VIOLATION'],
            }));
            return { accepted: [], rejected, all: rejected };
        }),
    };
});

import { evaluateTrainingWithIntent } from './rules';

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
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

function subjective(): SubjectiveInput {
    return {
        readiness: 9,
        sleepQuality: 9,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 9,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };
}

function objective(): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 90,
        sleep_duration_min: 480,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 90,
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

const emptyHistoryProvider: TrainingHistoryProvider = {
    reconstruct: async () => [],
};

describe('evaluateTrainingWithIntent hard-constraint fallback', () => {
    it('fails closed to recovery when every ranked candidate is rejected by a hard recovery constraint', async () => {
        const recommendation = await evaluateTrainingWithIntent(
            'review-user',
            { subjective: subjective(), objective: objective() },
            context(),
            [],
            '2026-03-02',
            undefined,
            emptyHistoryProvider,
        );

        expect(recommendation.mode).toBe('recover');
        expect(['Rest', 'Mobility/Recovery']).toContain(recommendation.template.category);
        expect(recommendation.rationale).toContain('No candidate survived the active hard constraints');
        expect(recommendation.decisionTrace?.candidateScores.length).toBeGreaterThan(0);
        expect(recommendation.decisionTrace?.candidateScores.every(candidate =>
            candidate.excludedReasons.includes('QUALITY_SPACING_VIOLATION')
        )).toBe(true);
    });
});
