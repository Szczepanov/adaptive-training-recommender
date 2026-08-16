import { describe, expect, it } from 'vitest';
import {
    runSubjectiveDriftMechanicsComparison,
    SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS,
} from './subjectiveDriftComparison';
import { SUBJECTIVE_PROFILE_KINDS } from './subjectiveProfiles';

const REPORT = runSubjectiveDriftMechanicsComparison();

function summary(profile: string, configId: string) {
    const found = REPORT.summaries.find(item => item.profile === profile && item.configId === configId);
    if (!found) throw new Error(`Missing summary ${profile}/${configId}`);
    return found;
}

describe('runSubjectiveDriftMechanicsComparison', () => {
    it('runs every Phase 9.5 profile across every declared sensitivity configuration with mature prior history', () => {
        const evaluatedDaysPerProfile = REPORT.totalDays - REPORT.warmupDays;
        expect(REPORT.scope).toBe('readiness-mechanics-only');
        expect(REPORT.days).toHaveLength(
            SUBJECTIVE_PROFILE_KINDS.length * SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS.length * evaluatedDaysPerProfile,
        );
        expect(REPORT.summaries).toHaveLength(SUBJECTIVE_PROFILE_KINDS.length * SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS.length);
        expect(REPORT.days.every(row => row.baselineAvailable && row.evidence !== null)).toBe(true);
    });

    it('preserves the tighten-only invariant in every synthetic comparison row', () => {
        const rank = { train: 0, modify: 1, recover: 2 } as const;
        for (const row of REPORT.days) {
            if (!row.evidence) continue;
            expect(rank[row.evidence.modeWithDrift]).toBeGreaterThanOrEqual(rank[row.evidence.modeWithoutDrift]);
            expect(row.evidence.contribution).toBeGreaterThanOrEqual(0);
        }
    });

    it('shows expected monotonic sensitivity to variability floor and equal weight scaling without duplicating estimator arithmetic', () => {
        for (const profile of SUBJECTIVE_PROFILE_KINDS) {
            const lowFloor = summary(profile, 'reference-floor-0.5');
            const highFloor = summary(profile, 'reference-floor-1.5');
            expect(lowFloor.meanContribution + 1e-12).toBeGreaterThanOrEqual(highFloor.meanContribution);

            const reference = summary(profile, 'reference-7-28-equal');
            const half = summary(profile, 'reference-half-weights');
            expect(half.meanContribution).toBeCloseTo(reference.meanContribution * 0.5, 10);
            expect(half.maxContribution).toBeCloseTo(reference.maxContribution * 0.5, 10);

            const narrow = summary(profile, 'reference-fatigue-soreness-only');
            expect(narrow.meanContribution).toBeLessThanOrEqual(reference.meanContribution + 1e-12);
        }
    });

    it('exercises the slow-drifter signal while keeping the report explicitly non-clinical/non-shipping', () => {
        const slow = summary('slow_drifter', 'reference-7-28-equal');
        expect(slow.meanContribution).toBeGreaterThan(0);
        expect(slow.maxContribution).toBeGreaterThan(0);
        expect(REPORT.limitations.some(item => item.includes('do not establish real-world predictive usefulness'))).toBe(true);
        expect(REPORT.limitations.some(item => item.includes('Production remains'))).toBe(true);
    });

    it('rejects a warmup shorter than the longest tested reference window', () => {
        expect(() => runSubjectiveDriftMechanicsComparison({ warmupDays: 10 })).toThrow(/longest baseline/);
    });
});
