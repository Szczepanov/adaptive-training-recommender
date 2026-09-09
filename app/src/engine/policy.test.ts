import { describe, expect, it } from 'vitest';
import { isHistoricalPolicyVersion, HISTORICAL_POLICY_VERSIONS, POLICY_VERSION } from './policy';

describe('isHistoricalPolicyVersion', () => {
    it('records the exact D-LEDGER planner-admission transition once', () => {
        expect(POLICY_VERSION).toBe('2026-09-h4-d-ledger-planner-admission-v2');
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-09-h4-intraday-bundle-member-launch-v1',
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
