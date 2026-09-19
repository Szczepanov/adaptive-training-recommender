import { describe, expect, it } from 'vitest';
import {
    getPerformanceTargetPolicy,
    isPerformanceTargetEligibleMetric,
} from './performanceTargetPolicy';

describe('performance target policy', () => {
    it('exposes the policy/eligibility lookups used by validation', () => {
        expect(isPerformanceTargetEligibleMetric('strength_1rm_kg')).toBe(true);
        expect(isPerformanceTargetEligibleMetric('cycling_submax_rpe')).toBe(false);
        expect(getPerformanceTargetPolicy('sprint_elapsed_time_s')?.family).toBe('speed');
        expect(getPerformanceTargetPolicy('unknown')).toBeNull();
    });
});
