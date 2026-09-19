import { describe, expect, it } from 'vitest';
import {
    validatePerformanceTarget,
    validatePerformanceTargetForDomain,
} from './performanceTargetValidation';
import type { GoalPerformanceTarget } from './performanceTargetPolicy';

function target(overrides: Partial<GoalPerformanceTarget> = {}): GoalPerformanceTarget {
    return {
        kind: 'performance_metric',
        metricId: 'strength_1rm_kg',
        subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
        targetValue: 220,
        ...overrides,
    };
}

describe('performance target validation', () => {
    it('accepts a valid strength exercise target', () => {
        const result = validatePerformanceTarget(target());
        expect(result.isValid).toBe(true);
        if (result.isValid) {
            expect(result.family).toBe('strength');
            expect(result.metric.unit).toBe('kg');
        }
    });

    it('accepts a valid speed performance-test target', () => {
        const result = validatePerformanceTarget(target({
            metricId: 'sprint_elapsed_time_s',
            subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
            targetValue: 1.75,
        }));
        expect(result).toMatchObject({ isValid: true, family: 'speed' });
    });

    it('accepts a valid power performance-test target', () => {
        const result = validatePerformanceTarget(target({
            metricId: 'cycling_5s_peak_power_w',
            subjectRef: { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
            targetValue: 1200,
        }));
        expect(result).toMatchObject({ isValid: true, family: 'power' });
    });

    it('rejects a mismatched subject kind', () => {
        const result = validatePerformanceTarget(target({
            subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
        }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'wrong_subject_kind' });
    });

    it('fails closed for an unknown exercise id rather than throwing', () => {
        const result = validatePerformanceTarget(target({ subjectRef: { kind: 'exercise', exerciseId: 'unknown_lift' } }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'unknown_exercise' });
    });

    it('rejects an exercise that exists in the catalog but is not policy-eligible for the metric', () => {
        const result = validatePerformanceTarget(target({ subjectRef: { kind: 'exercise', exerciseId: 'hang_power_clean' } }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'exercise_not_eligible_for_metric' });
    });

    it('fails closed for an unknown performance test id rather than throwing', () => {
        const result = validatePerformanceTarget(target({
            metricId: 'sprint_elapsed_time_s',
            subjectRef: { kind: 'performance_test', performanceTestId: 'unknown-test' },
            targetValue: 1.75,
        }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'unknown_performance_test' });
    });

    it('rejects a performance test whose protocol does not declare the target metric', () => {
        const result = validatePerformanceTarget(target({
            metricId: 'sprint_elapsed_time_s',
            subjectRef: { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
            targetValue: 1.75,
        }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'test_protocol_does_not_declare_metric' });
    });

    it('fails closed for an unknown metric', () => {
        const result = validatePerformanceTarget(target({ metricId: 'cycling_magic_fitness_score' }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'unknown_metric' });
    });

    it('rejects a registered metric that has no target-eligibility policy', () => {
        const result = validatePerformanceTarget(target({
            metricId: 'cycling_tt_20m_mean_power_w',
            subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
        }));
        expect(result).toMatchObject({ isValid: false, reasonCode: 'metric_not_target_eligible' });
    });

    it('rejects a non-finite target value', () => {
        expect(validatePerformanceTarget(target({ targetValue: Number.NaN })))
            .toMatchObject({ isValid: false, reasonCode: 'target_value_not_finite' });
        expect(validatePerformanceTarget(target({ targetValue: Number.POSITIVE_INFINITY })))
            .toMatchObject({ isValid: false, reasonCode: 'target_value_not_finite' });
    });

    it('rejects a structurally implausible target value', () => {
        expect(validatePerformanceTarget(target({ targetValue: 5000 })))
            .toMatchObject({ isValid: false, reasonCode: 'target_value_out_of_range' });
    });

    it('accepts a valid target whose domain matches the target family', () => {
        expect(validatePerformanceTargetForDomain(target(), 'strength')).toMatchObject({ isValid: true, family: 'strength' });
    });

    it('rejects a valid target whose domain does not match the target family', () => {
        expect(validatePerformanceTargetForDomain(target(), 'endurance'))
            .toMatchObject({ isValid: false, reasonCode: 'domain_family_mismatch' });
    });

    it('surfaces the underlying semantic failure rather than a domain error when the target itself is invalid', () => {
        const result = validatePerformanceTargetForDomain(target({ subjectRef: { kind: 'exercise', exerciseId: 'unknown_lift' } }), 'strength');
        expect(result).toMatchObject({ isValid: false, reasonCode: 'unknown_exercise' });
    });
});
