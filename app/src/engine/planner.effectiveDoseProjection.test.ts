import { describe, expect, it } from 'vitest';
import type { DailyReadiness, Recommendation, SubjectiveInput, EngineObjectiveInput, UserContext } from './models';
import { effectiveTemplateForProjection, generateWeekAheadPlan, prepareWeekAheadPlanSeed } from './planner';
import { ENRICHED_TEMPLATES } from './templates';

function contextFixture(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

function readinessFixture(): DailyReadiness {
    const subjective: SubjectiveInput = {
        readiness: 6,
        sleepQuality: 6,
        fatigue: 4,
        soreness: 4,
        stress: 4,
        motivation: 6,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };
    const objective: EngineObjectiveInput = {
        total_steps: 8000,
        sleep_score: 82,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 82,
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
    return { subjective, objective };
}

function doseFixture() {
    const template = ENRICHED_TEMPLATES.find(candidate =>
        !!candidate.easierDose && !!candidate.costProfile && !!candidate.stimulusProfile && candidate.systemicCost >= 0.4
    );
    expect(template, 'expected at least one enriched non-trivial template with an easier dose').toBeDefined();
    return { template: template!, easierDose: template!.easierDose! };
}

describe('week-ahead effective-dose projection', () => {
    it('scales duration, systemic cost, dimensional cost, and stimulus together', () => {
        const { template, easierDose } = doseFixture();
        const effective = effectiveTemplateForProjection(template, easierDose);

        expect(effective.durationMin).toBe(easierDose.durationMin);
        expect(effective.durationMax).toBe(easierDose.durationMax);
        expect(effective.systemicCost).toBeCloseTo(template.systemicCost * easierDose.doseRatio, 8);
        expect(effective.costProfile!.systemic).toBeCloseTo(template.costProfile!.systemic * easierDose.doseRatio, 8);
        expect(effective.costProfile!.lowerBody).toBeCloseTo(template.costProfile!.lowerBody * easierDose.doseRatio, 8);
        expect(effective.stimulusProfile!.aerobicEndurance).toBeCloseTo(template.stimulusProfile!.aerobicEndurance * easierDose.doseRatio, 8);
        expect(effective.stimulusProfile!.thresholdPower).toBeCloseTo(template.stimulusProfile!.thresholdPower * easierDose.doseRatio, 8);
    });

    it('projects less next-day external fatigue when today uses an easier active dose', () => {
        const date = '2026-08-07';
        const readiness = readinessFixture();
        const context = contextFixture();
        const { template, easierDose } = doseFixture();
        const fullRecommendation = {
            mode: 'train',
            template,
            rationale: 'Full-dose projection fixture.',
        } as Recommendation;
        const reducedRecommendation = {
            ...fullRecommendation,
            activeDose: easierDose,
        } as Recommendation;

        const fullPlan = generateWeekAheadPlan(
            readiness,
            context,
            null,
            date,
            fullRecommendation,
            null,
            prepareWeekAheadPlanSeed(readiness, [], date, []),
            { days: 1 },
        );
        const reducedPlan = generateWeekAheadPlan(
            readiness,
            context,
            null,
            date,
            reducedRecommendation,
            null,
            prepareWeekAheadPlanSeed(readiness, [], date, []),
            { days: 1 },
        );

        const fullExternalSystemic = fullPlan.days[0].diagnostics?.fatigue?.externalLoadFatigue.systemic;
        const reducedExternalSystemic = reducedPlan.days[0].diagnostics?.fatigue?.externalLoadFatigue.systemic;

        expect(fullExternalSystemic).toBeTypeOf('number');
        expect(reducedExternalSystemic).toBeTypeOf('number');
        expect(reducedExternalSystemic!).toBeLessThan(fullExternalSystemic!);
    });
});
