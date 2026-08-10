import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';

const scenario = SCENARIOS.find(item => item.id === 'cycling_specificity_after_hard_race_specific');
if (!scenario) throw new Error('Phase 6.3 Specificity escaped-case scenario is missing');

describe('Phase 6.3 deterministic Specificity escaped case', () => {
    it('preserves distinct weekly functions after a hard race-specific day -1', async () => {
        const result = await runScenario(scenario);
        expect(result.constraintViolations).toEqual([]);
        expect(result.totalDays).toBe(7);
        expect(result.categoryDistribution['Easy Endurance'] ?? 0).toBeGreaterThanOrEqual(1);
        // Sustained-quality coverage resolves through the cycling hard-quality family,
        // distinct from Race-Specific Endurance even when both earn overlapping adaptation.
        expect(result.categoryDistribution['Hard Endurance'] ?? 0).toBeGreaterThanOrEqual(1);
        expect(result.categoryDistribution['Race-Specific Endurance'] ?? 0).toBeGreaterThanOrEqual(1);
        expect((result.categoryDistribution.Rest ?? 0) + (result.categoryDistribution['Mobility/Recovery'] ?? 0)).toBeGreaterThanOrEqual(1);
    });
});
