import { describe, expect, it } from 'vitest';
import { addDaysToLocalDateString } from '../../../utils/localDate';
import { runScenario, type ScenarioResult } from '../../simulation/analyze';
import { SCENARIOS, type AthleteScenario } from '../../simulation/scenarios';

const ADVERSARIAL_IDS = {
    pain: 'adversarial_pain_with_high_readiness',
    delayedFatigue: 'adversarial_delayed_fatigue_masked_sleep',
    injuryVsRace: 'adversarial_injury_vs_a_priority_race',
    crossSportGuardrail: 'adversarial_cross_sport_football_strength',
} as const;

const resultCache = new Map<string, ScenarioResult>();

function scenarioById(id: string): AthleteScenario {
    const scenario = SCENARIOS.find(item => item.id === id);
    if (!scenario) throw new Error(`Missing adversarial scenario: ${id}`);
    return scenario;
}

async function resultFor(id: string): Promise<ScenarioResult> {
    const cached = resultCache.get(id);
    if (cached) return cached;
    const result = await runScenario(scenarioById(id));
    resultCache.set(id, result);
    return result;
}

function weekStartTraces(result: ScenarioResult, scenario: AthleteScenario) {
    const starts = new Set(
        Array.from({ length: scenario.weeks }, (_, weekIndex) =>
            addDaysToLocalDateString(scenario.startDate, weekIndex * 7)),
    );
    return result.decisionTraces.filter(trace => starts.has(trace.date));
}

describe('multi-week adversarial scenario contracts', () => {
    it('high objective readiness never overrides a reported pain gate on directly evaluated week starts', async () => {
        const scenario = scenarioById(ADVERSARIAL_IDS.pain);
        const result = await resultFor(ADVERSARIAL_IDS.pain);
        const traces = weekStartTraces(result, scenario);

        expect(traces).toHaveLength(scenario.weeks);
        expect(traces.every(trace => trace.mode === 'recover')).toBe(true);
        expect(traces.every(trace =>
            trace.selected.category === 'Rest' || trace.selected.category === 'Mobility/Recovery')).toBe(true);
        expect(result.modalityDistribution.Running ?? 0).toBe(0);
        expect(result.constraintViolations).toEqual([]);
    });

    it('recent hard-session density plus high subjective fatigue does not produce hard-endurance escalation', async () => {
        const scenario = scenarioById(ADVERSARIAL_IDS.delayedFatigue);
        const result = await resultFor(ADVERSARIAL_IDS.delayedFatigue);
        const firstWeekStart = weekStartTraces(result, scenario).find(trace => trace.weekIndex === 0);

        expect(firstWeekStart).toBeDefined();
        expect(firstWeekStart!.selected.category).not.toBe('Hard Endurance');
        expect(result.weekSummaries[0].restOrRecoveryDayCount).toBeGreaterThan(0);
        expect(result.constraintViolations).toEqual([]);
    });

    it('an A-priority running event cannot re-enable Running while an explicit injury restriction is active', async () => {
        const scenario = scenarioById(ADVERSARIAL_IDS.injuryVsRace);
        const result = await resultFor(ADVERSARIAL_IDS.injuryVsRace);

        expect(scenario.event).toMatchObject({ category: 'running_race', priority: 'A' });
        expect(scenario.context.constraints.restrictedModalities).toContain('Running');
        expect(result.decisionTraces.every(trace => trace.selected.modality !== 'Running')).toBe(true);
        expect(result.modalityDistribution.Running ?? 0).toBe(0);
        expect(result.constraintViolations).toEqual([]);
    });

    it('avoid_heavy_lower_body excludes lower-body and full-body strength across the full simulated horizon', async () => {
        const scenario = scenarioById(ADVERSARIAL_IDS.crossSportGuardrail);
        const result = await resultFor(ADVERSARIAL_IDS.crossSportGuardrail);
        const forbiddenCategories = new Set(['Lower-body Strength', 'Full-body Strength']);

        expect(scenario.context.trainingSettings?.guardrails.avoid_heavy_lower_body).toBe(true);
        expect(result.decisionTraces.filter(trace => forbiddenCategories.has(trace.selected.category))).toEqual([]);
        expect(result.constraintViolations).toEqual([]);
    });
});
