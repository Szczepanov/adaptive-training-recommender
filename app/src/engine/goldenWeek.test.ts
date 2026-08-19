import { describe, expect, it } from 'vitest';
import { runScenario, type ScenarioResult } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';
import { ENRICHED_TEMPLATES } from './templates';
import type { SessionTemplate } from './models';
import { generateWeekAheadPlanWithIntentBeamSearch } from './sequenceSearch';
import { getDayDiff } from '../utils/localDate';

/**
 * Golden coaching-contract test suite asserting standard coaching principles over a
 * realistic 7-day Build-phase cycling scenario with fixed dates (2026-03-02 to 2026-05-01).
 *
 * See docs/plans/phase-0-instrumentation.md (Task 0.2).
 */

const templateById = new Map<string, SessionTemplate>(
    ENRICHED_TEMPLATES.map((t) => [t.id, t]),
);
const categoryByTemplateId = new Map<string, SessionTemplate['category']>(
    ENRICHED_TEMPLATES.map((t) => [t.id, t.category]),
);

/** Objective credits are a ledger of newly satisfied unresolved objectives, not a
 * session log. A second quality ride after threshold is already resolved is therefore a
 * real session but intentionally creates no new credit row. Combine credited key rides
 * with the simulator's realized anchor observations, both of which are modality-checked
 * against the actual selected template. */
function actualKeyCyclingDates(result: ScenarioResult): string[] {
    const keyCategories = new Set(['Hard Endurance', 'Moderate Endurance', 'Race-Specific Endurance']);
    const dates = new Set(
        result.objectiveCredits
            .filter((credit) => {
                const template = templateById.get(credit.templateId);
                return credit.modality === 'Cycling'
                    && template?.modality === 'Cycling'
                    && keyCategories.has(template.category);
            })
            .map((credit) => credit.date),
    );

    result.anchorWeeks.forEach((week) => {
        if (week.qualityAnchorHit && week.qualityAnchorDate) dates.add(week.qualityAnchorDate);
        week.eventSpecificExposureDates.forEach((date) => dates.add(date));
    });
    return Array.from(dates).sort();
}

describe('goldenWeek coaching contract: cycling_a_event_build_week', () => {
    async function getBuildWeekResult() {
        const scenario = SCENARIOS.find((s) => s.id === 'cycling_a_event_build_week');
        if (!scenario) throw new Error('cycling_a_event_build_week scenario missing');
        return runScenario(scenario);
    }

    it('key cycling quality sessions are spaced by >= 48 hours', async () => {
        const result = await getBuildWeekResult();
        const keyCyclingDates = actualKeyCyclingDates(result);

        // getDayDiff parses the YYYY-MM-DD components directly (Date.UTC), unlike
        // `new Date(d + 'T00:00:00')` which parses in the host's local timezone and could
        // silently mis-measure spacing across a DST transition inside the simulated week.
        for (let i = 1; i < keyCyclingDates.length; i++) {
            const diffDays = getDayDiff(keyCyclingDates[i], keyCyclingDates[i - 1]);
            expect(diffDays).toBeGreaterThanOrEqual(2);
        }
    });

    it('protects key cycling days from adjacent heavy strength sessions', async () => {
        const result = await getBuildWeekResult();
        const keyCyclingDates = new Set(actualKeyCyclingDates(result));
        const heavyStrengthCategories = new Set(['Lower-body Strength', 'Full-body Strength']);

        result.objectiveCredits.forEach((c) => {
            if (heavyStrengthCategories.has(categoryByTemplateId.get(c.templateId) ?? '')) {
                keyCyclingDates.forEach((cycleDate) => {
                    const diffDays = Math.abs(getDayDiff(c.date, cycleDate));
                    expect(diffDays).not.toBe(1);
                });
            }
        });
    });

    // F3 / Phase 0: Event modality frequency contract. Count actual distinct key-session
    // dates, not objective-credit rows (which stop once an objective is already resolved).
    it('delivers at least two key/race-specific Cycling sessions in the 7-day Build strip (F3)', async () => {
        const result = await getBuildWeekResult();
        expect(actualKeyCyclingDates(result).length).toBeGreaterThanOrEqual(2);
    });

    it('resolves required weekly objectives (threshold_quality and strength_maintenance)', async () => {
        const result = await getBuildWeekResult();
        const threshold = result.objectiveResolution.find((o) => o.key === 'threshold_quality');
        const strength = result.objectiveResolution.find((o) => o.key === 'strength_maintenance');

        expect(threshold).toBeDefined();
        expect(threshold!.timesResolved).toBeGreaterThanOrEqual(threshold!.timesGenerated);

        expect(strength).toBeDefined();
        expect(strength!.timesResolved).toBeGreaterThanOrEqual(strength!.timesGenerated);
    });

    it('contains at least 1 Rest or Mobility/Recovery day', async () => {
        const result = await getBuildWeekResult();
        expect(result.restOrRecoveryDayCount).toBeGreaterThanOrEqual(1);
    });
});

// Phase 5.1: the same golden-week coaching contract, run through the beam-search
// prototype (sequenceSearch.ts) instead of the production greedy planner. This is the
// permanent form of "benchmarked against greedy on the Phase-0 invariants and semantic
// harness" -- see docs/adr/0015-sequence-planning-and-session-role-model.md for the full
// recorded comparison and adoption decision (greedy retained as the live default; this
// suite guards the prototype against regressing below what made that decision
// defensible in the first place).
describe('goldenWeek coaching contract via the Phase 5.1 beam-search prototype', () => {
    // Memoized at suite scope -- the beam search evaluates rankCandidates for every branch
    // and day, so it costs far more than the greedy run, and each of the 6 tests below
    // would otherwise re-run the full scenario from scratch.
    let cached: Promise<ScenarioResult> | null = null;
    function getBuildWeekResultBeamSearch(): Promise<ScenarioResult> {
        if (!cached) {
            const scenario = SCENARIOS.find((s) => s.id === 'cycling_a_event_build_week');
            if (!scenario) throw new Error('cycling_a_event_build_week scenario missing');
            cached = runScenario(scenario, generateWeekAheadPlanWithIntentBeamSearch);
        }
        return cached;
    }

    it('key cycling quality sessions are spaced by >= 48 hours', async () => {
        const result = await getBuildWeekResultBeamSearch();
        const keyCyclingDates = actualKeyCyclingDates(result);

        for (let i = 1; i < keyCyclingDates.length; i++) {
            const diffDays = getDayDiff(keyCyclingDates[i], keyCyclingDates[i - 1]);
            expect(diffDays).toBeGreaterThanOrEqual(2);
        }
    });

    it('protects key cycling days from adjacent heavy strength sessions', async () => {
        const result = await getBuildWeekResultBeamSearch();
        const keyCyclingDates = new Set(actualKeyCyclingDates(result));
        const heavyStrengthCategories = new Set(['Lower-body Strength', 'Full-body Strength']);

        result.objectiveCredits.forEach((c) => {
            if (heavyStrengthCategories.has(categoryByTemplateId.get(c.templateId) ?? '')) {
                keyCyclingDates.forEach((cycleDate) => {
                    const diffDays = Math.abs(getDayDiff(c.date, cycleDate));
                    expect(diffDays).not.toBe(1);
                });
            }
        });
    });

    it('delivers at least two key/race-specific Cycling sessions in the 7-day Build strip (F3)', async () => {
        const result = await getBuildWeekResultBeamSearch();
        expect(actualKeyCyclingDates(result).length).toBeGreaterThanOrEqual(2);
    });

    it('resolves required weekly objectives (threshold_quality and strength_maintenance)', async () => {
        const result = await getBuildWeekResultBeamSearch();
        const threshold = result.objectiveResolution.find((o) => o.key === 'threshold_quality');
        const strength = result.objectiveResolution.find((o) => o.key === 'strength_maintenance');

        expect(threshold).toBeDefined();
        expect(threshold!.timesResolved).toBeGreaterThanOrEqual(threshold!.timesGenerated);

        expect(strength).toBeDefined();
        expect(strength!.timesResolved).toBeGreaterThanOrEqual(strength!.timesGenerated);
    });

    it('contains at least 1 Rest or Mobility/Recovery day', async () => {
        const result = await getBuildWeekResultBeamSearch();
        expect(result.restOrRecoveryDayCount).toBeGreaterThanOrEqual(1);
    });

    it('produces zero hard constraint violations, matching the greedy planner', async () => {
        const result = await getBuildWeekResultBeamSearch();
        expect(result.constraintViolations).toEqual([]);
    });
});
