import { describe, expect, it } from 'vitest';
import { isHistoricalPolicyVersion, HISTORICAL_POLICY_VERSIONS, POLICY_VERSION } from './policy';

describe('isHistoricalPolicyVersion', () => {
    it('records the current transition and the previous live policies exactly once', () => {
        expect(POLICY_VERSION).toBe('2026-09-health-adherence-modality-intensity-v1');
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
