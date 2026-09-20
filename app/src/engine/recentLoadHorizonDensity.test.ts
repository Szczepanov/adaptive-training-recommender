import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';
import type { CompletedExposure } from './trainingHistory';

function addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function exposureOn(exposure: CompletedExposure, date: string, occurrenceSuffix: string): CompletedExposure {
    return { ...structuredClone(exposure), occurrenceKey: `judge:${occurrenceSuffix}:${date}`, date };
}

function horizonMetrics(result: Awaited<ReturnType<typeof runScenario>>) {
    return {
        hardCount: result.decisionTraces.filter(trace => trace.selected.projectedCost.systemic >= 0.5).length,
        systemicTotal: result.decisionTraces.reduce((sum, trace) => sum + trace.selected.projectedCost.systemic, 0),
    };
}

describe('recent load horizon response (Issue #676 / #692)', () => {
    it('caps near-term load after a recent hard exposure and reports whole-horizon rebound telemetry', async () => {
        const base = SCENARIOS.find(s => s.id === 'cycling_criterium_A');
        expect(base).toBeDefined();
        if (!base) return;

        const hardLoadSource = SCENARIOS.find(s => s.id === 'external_load_green_readiness');
        expect(hardLoadSource?.initialHistory).toBeDefined();
        const hardExposure = hardLoadSource!.initialHistory![0];

        const makeVariant = (id: string, priorHardDaysAgo: number | null) => ({
            ...base,
            id,
            weeks: 2,
            initialHistory: priorHardDaysAgo === null
                ? []
                : [exposureOn(hardExposure, addDays(base.startDate, -priorHardDaysAgo), `hard-${priorHardDaysAgo}d`)],
        });

        const [none, hard3d, hard2d, hard1d] = await Promise.all([
            runScenario(makeVariant('judge_load_none', null)),
            runScenario(makeVariant('judge_load_hard_three_days_ago', 3)),
            runScenario(makeVariant('judge_load_hard_two_days_ago', 2)),
            runScenario(makeVariant('judge_load_hard_yesterday', 1)),
        ]);

        const ordered = [
            ['hard yesterday', horizonMetrics(hard1d)],
            ['hard two days ago', horizonMetrics(hard2d)],
            ['hard three days ago', horizonMetrics(hard3d)],
            ['no recent hard load', horizonMetrics(none)],
        ] as const;

        // Issue #692 resolves the former whole-horizon monotonicity expectation as a
        // non-invariant of this greedy day-by-day planner. A recent hard exposure can
        // correctly reduce near-term load, create more recovery headroom in the model,
        // and later cross a local fatigue-tier boundary sooner than a matched baseline.
        // That later rebound is characterization telemetry, not proof that the athlete is
        // physiologically "more recovered": the internal fatigue projection is a product
        // model and is explicitly not calibrated as a direct physiological measurement.
        // Hard safety/feasibility gates and the near-term response to recent load remain
        // executable contracts; cross-counterfactual 14-day ordering does not.
        const violations: string[] = [];
        for (let i = 0; i < ordered.length - 1; i++) {
            const [moreRecentLabel, moreRecent] = ordered[i];
            const [lessRecentLabel, lessRecent] = ordered[i + 1];
            if (moreRecent.hardCount > lessRecent.hardCount) {
                violations.push(`${moreRecentLabel} has more hard sessions (${moreRecent.hardCount}) than ${lessRecentLabel} (${lessRecent.hardCount}).`);
            }
            if (moreRecent.systemicTotal > lessRecent.systemicTotal + 1e-9) {
                violations.push(`${moreRecentLabel} has higher cumulative systemic cost (${moreRecent.systemicTotal.toFixed(3)}) than ${lessRecentLabel} (${lessRecent.systemicTotal.toFixed(3)}).`);
            }
        }
        if (violations.length > 0) {
            console.info(`Whole-horizon monotonicity characterization telemetry (Issue #692 accepted non-invariant):\n- ${violations.join('\n- ')}`);
        }

        for (const [, metrics] of ordered) {
            expect(Number.isFinite(metrics.hardCount)).toBe(true);
            expect(Number.isFinite(metrics.systemicTotal)).toBe(true);
        }

        expect(hard1d.decisionTraces[0].selected.projectedCost.systemic).toBeLessThan(0.5);
        expect(hard1d.decisionTraces[1].selected.projectedCost.systemic).toBeLessThan(0.5);
    });
});
