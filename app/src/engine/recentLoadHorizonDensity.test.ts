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
    return {
        ...structuredClone(exposure),
        occurrenceKey: `judge:${occurrenceSuffix}:${date}`,
        date,
    };
}

describe('recent load whole-horizon density (Issue #676)', () => {
    it('enforces whole-horizon load sensitivity: recent hard training does not exceed no-load baseline density', async () => {
        const base = SCENARIOS.find(s => s.id === 'cycling_criterium_A');
        expect(base).toBeDefined();
        if (!base) return;

        const hardLoadSource = SCENARIOS.find(s => s.id === 'external_load_green_readiness');
        expect(hardLoadSource?.initialHistory).toBeDefined();
        const hardExposure = hardLoadSource!.initialHistory![0];

        const makeVariant = (id: string, initialHistory: CompletedExposure[]) => ({
            ...base,
            id,
            weeks: 2,
            initialHistory,
        });

        const none = await runScenario(makeVariant('judge_load_none', []));
        const hardYday = await runScenario(makeVariant('judge_load_hard_yesterday', [
            exposureOn(hardExposure, addDays(base.startDate, -1), 'hard-yesterday'),
        ]));

        const hardCountNone = none.decisionTraces.filter(t => t.selected.projectedCost.systemic >= 0.5).length;
        const totalSystemicNone = none.decisionTraces.reduce((acc, t) => acc + t.selected.projectedCost.systemic, 0);

        const hardCountYday = hardYday.decisionTraces.filter(t => t.selected.projectedCost.systemic >= 0.5).length;
        const totalSystemicYday = hardYday.decisionTraces.reduce((acc, t) => acc + t.selected.projectedCost.systemic, 0);

        // Whole-horizon load sensitivity: prior hard training must not result in MORE hard sessions
        // or MORE cumulative systemic cost than the no-load baseline over 14 days
        expect(hardCountYday).toBeLessThanOrEqual(hardCountNone);
        expect(totalSystemicYday).toBeLessThanOrEqual(totalSystemicNone);

        // Immediate response remains safe: Days 1 and 2 are easy before the first surge
        expect(hardYday.decisionTraces[0].selected.projectedCost.systemic).toBeLessThan(0.5);
        expect(hardYday.decisionTraces[1].selected.projectedCost.systemic).toBeLessThan(0.5);

        // No dense strength clustering for endurance event: at least 3 days between strength sessions
        const strengthDayIndices = hardYday.decisionTraces
            .map((t, idx) => (t.selected.modality === 'Strength' ? idx : null))
            .filter((idx): idx is number => idx !== null);

        for (let i = 1; i < strengthDayIndices.length; i++) {
            const gap = strengthDayIndices[i] - strengthDayIndices[i - 1];
            expect(gap).toBeGreaterThanOrEqual(3);
        }
    });
});
