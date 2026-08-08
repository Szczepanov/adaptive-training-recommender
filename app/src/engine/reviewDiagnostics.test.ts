import { describe, expect, it } from 'vitest';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from './rules';
import { generateWeekAheadPlanWithIntent, resolveWeeklyAnchors } from './planner';
import { runScenario } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';
import type { TrainingHistoryProvider } from './trainingHistory';

const ids = [
    'cycling_criterium_A',
    'cycling_criterium_stressed_A',
    'cycling_a_event_build_week',
    'strength_meet_powerlifting_B',
] as const;

describe('temporary Phase 3 review diagnostics', () => {
    it('prints the scenario and first-week state needed to calibrate reviewed behavior', async () => {
        for (const id of ids) {
            const scenario = SCENARIOS.find(item => item.id === id)!;
            const result = await runScenario(scenario);
            console.log(`REVIEW_SCENARIO ${id} ${JSON.stringify({
                categoryDistribution: result.categoryDistribution,
                modalityDistribution: result.modalityDistribution,
                restOrRecoveryDayCount: result.restOrRecoveryDayCount,
                fatigueTierDayCounts: result.fatigueTierDayCounts,
                anchorWeeks: result.anchorWeeks,
                objectiveResolution: result.objectiveResolution,
            })}`);

            const events = scenario.event ? [scenario.event] : [];
            const historyProvider: TrainingHistoryProvider = { reconstruct: async () => [] };
            const readiness = scenario.readinessForWeek(0);
            const todayRec = await evaluateTrainingWithIntent(
                'diag-user', readiness, scenario.context, events, scenario.startDate,
                undefined, historyProvider,
            );
            const nextDay = await evaluateNextDayPlanWithIntent(
                'diag-user', events, readiness, scenario.context, scenario.startDate,
                todayRec, historyProvider,
            );
            const tomorrowRec = nextDay.branches.yellow.recommendation;
            const plan = await generateWeekAheadPlanWithIntent(
                'diag-user', readiness, scenario.context, null, events, scenario.startDate,
                todayRec, tomorrowRec, { days: 7 }, historyProvider,
            );
            const anchors = resolveWeeklyAnchors(
                scenario.startDate, 7, events, [], scenario.context,
                tomorrowRec.template.category, tomorrowRec.template.modality,
            );
            console.log(`REVIEW_WEEK ${id} ${JSON.stringify({
                today: { date: scenario.startDate, id: todayRec.template.id, category: todayRec.template.category, modality: todayRec.template.modality, mode: todayRec.mode },
                tomorrow: { id: tomorrowRec.template.id, category: tomorrowRec.template.category, modality: tomorrowRec.template.modality, mode: tomorrowRec.mode },
                anchors,
                days: plan.days.map(day => ({
                    date: day.date,
                    id: day.template.id,
                    category: day.template.category,
                    modality: day.template.modality,
                    peakFatigue: day.diagnostics?.peakFatigue ?? null,
                    fatigueTier: day.diagnostics?.fatigueTier ?? null,
                })),
                objectives: plan.microcycleObjectives.map(objective => ({ key: objective.key, completed: objective.completedExposures, target: objective.targetExposures })),
            })}`);
        }
        expect(true).toBe(true);
    });
});
