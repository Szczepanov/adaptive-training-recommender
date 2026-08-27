import { describe, expect, it } from 'vitest';
import { runMultisourceSimulationScenarios } from './multisourceComparison';

describe('multisourceComparison (MS16)', () => {
    it('runs all 5 canonical scenarios and passes all invariants', () => {
        const report = runMultisourceSimulationScenarios();

        expect(report.totalScenarios).toBe(5);
        expect(report.allInvariantsPassed).toBe(true);

        const scenarios = report.scenarios.map((s) => s.scenario);
        expect(scenarios).toContain('garmin_missing_overnight');
        expect(scenarios).toContain('cross_sensor_concordance');
        expect(scenarios).toContain('cross_sensor_divergence');
        expect(scenarios).toContain('stale_secondary_sensor');
        expect(scenarios).toContain('post_hard_session_recovery');

        for (const s of report.scenarios) {
            expect(s.invariantPassed).toBe(true);
        }
    });

    it('verifies missing overnight fallback promotes Eight Sleep with z=1.0', () => {
        const report = runMultisourceSimulationScenarios();
        const scenario = report.scenarios.find((s) => s.scenario === 'garmin_missing_overnight');

        expect(scenario).toBeDefined();
        expect(scenario?.effectiveSourceCandidate).toBe('eight_sleep_google_health');
        expect(scenario?.candidateResult.fusedMetrics['hrv_rmssd_ms'].fusedZScore).toBe(1.0);
    });

    it('verifies cross-sensor divergence preserves Garmin Direct with dampened confidence', () => {
        const report = runMultisourceSimulationScenarios();
        const scenario = report.scenarios.find((s) => s.scenario === 'cross_sensor_divergence');

        expect(scenario).toBeDefined();
        expect(scenario?.effectiveSourceCandidate).toBe('garmin_garmin_direct');
        expect(scenario?.confidenceMultiplierCandidate).toBe(0.85);
    });
});
