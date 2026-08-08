import { describe, expect, it } from 'vitest';
import { runScenario, type ScenarioResult } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';
import { ENRICHED_TEMPLATES } from './templates';
import type { SessionTemplate } from './models';

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

        const timestamps = keyCyclingDates.map((d) => new Date(d + 'T00:00:00').getTime());
        for (let i = 1; i < timestamps.length; i++) {
            const diffHours = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60);
            expect(diffHours).toBeGreaterThanOrEqual(48);
        }
    });

    it('protects key cycling days from adjacent heavy strength sessions', async () => {
        const result = await getBuildWeekResult();
        const keyCyclingDates = new Set(actualKeyCyclingDates(result));
        const heavyStrengthCategories = new Set(['Lower-body Strength', 'Full-body Strength']);

        result.objectiveCredits.forEach((c) => {
            if (heavyStrengthCategories.has(categoryByTemplateId.get(c.templateId) ?? '')) {
                const strengthTime = new Date(c.date + 'T00:00:00').getTime();
                keyCyclingDates.forEach((cycleDate) => {
                    const cycleTime = new Date(cycleDate + 'T00:00:00').getTime();
                    const diffDays = Math.abs(strengthTime - cycleTime) / (1000 * 60 * 60 * 24);
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