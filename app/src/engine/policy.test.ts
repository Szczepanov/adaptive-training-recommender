import { describe, expect, it } from 'vitest';
import { isHistoricalPolicyVersion, HISTORICAL_POLICY_VERSIONS, POLICY_VERSION } from './policy';

describe('isHistoricalPolicyVersion', () => {
    it('records the current transition and the previous live policies exactly once', () => {
        expect(POLICY_VERSION).toBe('2026-09-rolling-load-budget-v2');
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-rolling-load-budget-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-hard-endurance-event-priority-c-merge-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-hard-endurance-ceiling-v1',
            ),
        ).toHaveLength(1);
        expect(HISTORICAL_POLICY_VERSIONS.filter(
            (version) => version === '2026-09-effective-dose-ranking-consistency-v1',
        )).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-gran-fondo-durability-anchor-spacing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-hard-load-density-race-week-sequencing-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-indexed-lookup-parity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-overlay-fallback-conservative-monotonicity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-symptom-compatible-strength-safety-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-modality-intensity-v2',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-health-adherence-modality-intensity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-triathlon-taper-recovery-reentry-capacity-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-performance-goal-demand-projection-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-catalog-session-note-dedup-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-progression-confirmed-selection-coverage-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-bolt-workout-for-template-cache-v1',
            ),
        ).toHaveLength(1);
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-o1-rest-template-lookup-v1',
            ),
        ).toHaveLength(1);
    });

    it('returns true for all known historical versions', () => {
        for (const version of HISTORICAL_POLICY_VERSIONS) {
            expect(isHistoricalPolicyVersion(version)).toBe(true);
        }
    });

    it('returns false for the current policy version', () => {
        expect(isHistoricalPolicyVersion(POLICY_VERSION)).toBe(false);
    });

    it('returns false for unknown arbitrary versions', () => {
        expect(isHistoricalPolicyVersion('1999-01-unknown-version-v1')).toBe(false);
        expect(isHistoricalPolicyVersion('')).toBe(false);
    });
});
