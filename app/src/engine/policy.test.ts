import { describe, expect, it } from 'vitest';
import { isHistoricalPolicyVersion, HISTORICAL_POLICY_VERSIONS, POLICY_VERSION } from './policy';

describe('isHistoricalPolicyVersion', () => {
    it('retains the policy superseded by the H4 dependent-member launch contract', () => {
        expect(HISTORICAL_POLICY_VERSIONS).toContain('2026-09-simulation-sequence-occupational-context-v2');
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
