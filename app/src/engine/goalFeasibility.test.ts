import { describe, expect, it } from 'vitest';
import { assessGoalFeasibility } from './goalFeasibility';
import { resolveGoalProgress } from './goalProgress';
import type { GoalPerformanceTarget } from './performanceTargetPolicy';
import type { AthletePerformanceProfile } from '../workouts/models';

function benchTarget(targetValue = 200): GoalPerformanceTarget {
    return {
        kind: 'performance_metric',
        metricId: 'strength_1rm_kg',
        subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
        targetValue,
    };
}

function progressWithBaseline(value: number, source?: 'manual' | 'coach' | 'garmin' | 'derived') {
    const profile: AthletePerformanceProfile = {
        estimated1RmKg: { bench_press: value },
        ...(source ? { estimated1RmSources: { bench_press: { source } } } : {}),
    };
    return resolveGoalProgress(benchTarget(), { athletePerformanceProfile: profile });
}

describe('assessGoalFeasibility', () => {
    it('reports insufficient_evidence with low confidence when there is no comparable baseline', () => {
        const progress = resolveGoalProgress(benchTarget(), { athletePerformanceProfile: {} });
        const result = assessGoalFeasibility(benchTarget(), progress, { targetDate: '2026-10-31', today: '2026-09-19' });
        expect(result.plausibility).toBe('insufficient_evidence');
        expect(result.confidence.level).toBe('low');
    });

    it('reports already_achieved for a higher-is-better target already met', () => {
        const progress = progressWithBaseline(220, 'coach');
        const result = assessGoalFeasibility(benchTarget(200), progress, { targetDate: '2026-10-31', today: '2026-09-19' });
        expect(result.plausibility).toBe('already_achieved');
        expect(result.requiredChange.absolute).toBeLessThanOrEqual(0);
    });

    it('reports already_achieved for a lower-is-better target already beaten', () => {
        const target: GoalPerformanceTarget = {
            kind: 'performance_metric',
            metricId: 'sprint_elapsed_time_s',
            subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
            targetValue: 1.75,
        };
        const progress = resolveGoalProgress(target, {
            comparableObservations: [{
                observationKey: 'o1', revision: 1, metricId: 'sprint_elapsed_time_s', value: 1.70, unit: 's',
                observedAt: '2026-09-01T00:00:00.000Z', source: 'manual',
                protocolRef: { id: 'sprint-10m-standing', revision: 1 }, comparisonSeriesKey: 's1',
                comparisonCanonicalizationVersion: 'comparison-series-v1', assessmentAttemptId: 'a1',
                validity: 'valid', context: {}, createdAt: '2026-09-01T00:05:00.000Z',
            }],
        });
        const result = assessGoalFeasibility(target, progress, { targetDate: '2026-10-31', today: '2026-09-19' });
        expect(result.plausibility).toBe('already_achieved');
    });

    it('reports insufficient_evidence when there is no target date', () => {
        const progress = progressWithBaseline(100, 'coach');
        const result = assessGoalFeasibility(benchTarget(200), progress, { targetDate: null, today: '2026-09-19' });
        expect(result.plausibility).toBe('insufficient_evidence');
        expect(result.confidence.reasons).toContain('no_target_date');
    });

    it('returns null relativePct rather than a fabricated rate when the baseline is zero', () => {
        const progress = progressWithBaseline(0, 'coach');
        const result = assessGoalFeasibility(benchTarget(50), progress, { targetDate: '2026-10-31', today: '2026-09-19' });
        expect(result.requiredChange.relativePct).toBeNull();
        expect(result.requiredChange.absolute).toBe(50);
    });

    it('matches the plan\'s worked example: 100kg -> 200kg in 6 weeks at max 1 session/week is Unlikely with bounded confidence', () => {
        const progress = progressWithBaseline(100, 'coach');
        const result = assessGoalFeasibility(benchTarget(200), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 1 },
        });
        expect(result.plausibility).toBe('unlikely');
        expect(result.confidence.level).toBe('moderate');
        expect(result.confidence.reasons).toContain('target_specific_frequency_unknown');
        expect(result.requiredChange).toMatchObject({ absolute: 100, relativePct: 100 });
        expect(result.capacity.maxRelevantExposuresBeforeTarget).not.toBeNull();
        expect(result.evidenceRefs).toContain('goalFeasibility.strength.requiredChangeBands');
    });

    it('calibrates plausible/stretch/unlikely bands to the reviewed six-week strength anchor', () => {
        const progress = progressWithBaseline(100, 'coach');
        const options = { targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 2 } };

        expect(assessGoalFeasibility(benchTarget(107.5), progress, options).plausibility).toBe('plausible');
        expect(assessGoalFeasibility(benchTarget(110), progress, options).plausibility).toBe('stretch');
        expect(assessGoalFeasibility(benchTarget(115), progress, options).plausibility).toBe('unlikely');
    });

    it('does not claim high confidence while target-specific frequency is still unknown', () => {
        const progress = progressWithBaseline(100, 'coach');
        const result = assessGoalFeasibility(benchTarget(105), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 3 },
        });
        expect(result.confidence.level).toBe('moderate');
        expect(result.capacity.projectedSpecificExposuresPerWeek).toBeNull();
        expect(result.factors.some(factor => factor.code === 'target_specific_frequency_unknown')).toBe(true);
    });

    it('lowers confidence for the same target when the baseline is a stale/unsourced manual estimate', () => {
        const progress = progressWithBaseline(100);
        const result = assessGoalFeasibility(benchTarget(200), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 1 },
        });
        expect(result.plausibility).toBe('unlikely');
        expect(result.confidence.level).not.toBe('high');
    });

    it('never invents a target-specific weekly exposure count from total weekly capacity', () => {
        const progress = progressWithBaseline(100, 'coach');
        const result = assessGoalFeasibility(benchTarget(110), progress, {
            targetDate: '2027-03-01', today: '2026-09-19', capacity: { weeklyMaxSessions: 5 },
        });
        expect(result.capacity.projectedSpecificExposuresPerWeek).toBeNull();
    });

    it('gives no reviewed rate evidence for speed/power families rather than fabricating a band', () => {
        const target: GoalPerformanceTarget = {
            kind: 'performance_metric',
            metricId: 'cycling_5s_peak_power_w',
            subjectRef: { kind: 'performance_test', performanceTestId: 'cycling_5s_peak_power-r1' },
            targetValue: 1200,
        };
        const progress = resolveGoalProgress(target, {
            comparableObservations: [{
                observationKey: 'o1', revision: 1, metricId: 'cycling_5s_peak_power_w', value: 1000, unit: 'W',
                observedAt: '2026-09-01T00:00:00.000Z', source: 'manual',
                protocolRef: { id: 'cycling-5s-peak-power', revision: 1 }, comparisonSeriesKey: 's1',
                comparisonCanonicalizationVersion: 'comparison-series-v1', assessmentAttemptId: 'a1',
                validity: 'valid', context: {}, createdAt: '2026-09-01T00:05:00.000Z',
            }],
        });
        const result = assessGoalFeasibility(target, progress, { targetDate: '2026-12-01', today: '2026-09-19' });
        expect(result.plausibility).toBe('insufficient_evidence');
        expect(result.evidenceRefs).toEqual([]);
    });

    it('recomputes independently for a different target date without mutating the goal target', () => {
        const target = benchTarget(200);
        const frozen = JSON.stringify(target);
        const progress = progressWithBaseline(100, 'coach');
        const near = assessGoalFeasibility(target, progress, { targetDate: '2026-09-26', today: '2026-09-19', capacity: { weeklyMaxSessions: 3 } });
        const far = assessGoalFeasibility(target, progress, { targetDate: '2028-09-19', today: '2026-09-19', capacity: { weeklyMaxSessions: 3 } });
        expect(near.plausibility).toBe('unlikely');
        expect(far.plausibility === 'unlikely').toBe(false);
        expect(JSON.stringify(target)).toBe(frozen);
    });
});
