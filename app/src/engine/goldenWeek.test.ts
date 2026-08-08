import { describe, expect, it } from 'vitest';
import { runScenario } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';

/**
 * Golden coaching-contract test suite asserting standard coaching principles over a
 * realistic 7-day Build-phase cycling scenario with fixed dates (2026-03-02 to 2026-05-01).
 *
 * See docs/plans/phase-0-instrumentation.md (Task 0.2).
 */
describe('goldenWeek coaching contract: cycling_a_event_build_week', () => {
    async function getBuildWeekResult() {
        const scenario = SCENARIOS.find((s) => s.id === 'cycling_a_event_build_week');
        if (!scenario) throw new Error('cycling_a_event_build_week scenario missing');
        return runScenario(scenario);
    }

    it('key cycling quality sessions are spaced by >= 48 hours', async () => {
        const result = await getBuildWeekResult();
        const keyCategories = new Set(['Hard Endurance', 'Moderate Endurance', 'Race-Specific Endurance']);
        
        // Find distinct dates of key cycling quality sessions across the scenario
        const keyCyclingDates = Array.from(new Set(
            result.objectiveCredits
                .filter((credit) => credit.modality === 'Cycling' && keyCategories.has(credit.objectiveTitle))
                .map((credit) => credit.date),
        )).sort();

        // Parse dates into timestamps and check spacing between consecutive key quality days
        const timestamps = keyCyclingDates.map((d) => new Date(d + 'T00:00:00').getTime());
        for (let i = 1; i < timestamps.length; i++) {
            const diffHours = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60);
            expect(diffHours).toBeGreaterThanOrEqual(48);
        }
    });

    it('protects key cycling days from adjacent heavy strength sessions', async () => {
        const result = await getBuildWeekResult();
        const keyCyclingDates = new Set(
            result.objectiveCredits
                .filter((c) => c.modality === 'Cycling')
                .map((c) => c.date),
        );

        const heavyStrengthCategories = new Set(['Lower-body Strength', 'Full-body Strength']);

        // Assert no heavy strength day is placed on day before or after key cycling day
        result.objectiveCredits.forEach((c) => {
            if (heavyStrengthCategories.has(c.objectiveTitle)) {
                const strengthTime = new Date(c.date + 'T00:00:00').getTime();
                keyCyclingDates.forEach((cycleDate) => {
                    const cycleTime = new Date(cycleDate + 'T00:00:00').getTime();
                    const diffDays = Math.abs(strengthTime - cycleTime) / (1000 * 60 * 60 * 24);
                    expect(diffDays).not.toBe(1);
                });
            }
        });
    });

    // F3 / Phase 0: Event modality frequency contract.
    // In a 7-day Build week for a Cycling A-event, the athlete should get >= 2 key/race-specific Cycling quality sessions.
    // TODAY THIS FAILS because of F3 (0.21x event-modality suppression in current engine produces 0 race-specific/hard cycling sessions).
    // Marked expected-failing with it.fails() per Task 0.2 design in docs/plans/phase-0-instrumentation.md.
    it.fails('contains >= 2 key/race-specific Cycling sessions in the 7-day Build strip (F3 contract gate)', async () => {
        const result = await getBuildWeekResult();
        const keyCyclingCount = (result.categoryDistribution['Moderate Endurance'] ?? 0)
            + (result.categoryDistribution['Hard Endurance'] ?? 0)
            + (result.categoryDistribution['Race-Specific Endurance'] ?? 0);
        expect(keyCyclingCount).toBeGreaterThanOrEqual(2);
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
