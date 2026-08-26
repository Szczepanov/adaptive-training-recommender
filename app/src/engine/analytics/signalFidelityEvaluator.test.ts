import { describe, expect, it } from 'vitest';
import {
    computePearsonCorrelation,
    computeSignalCorrelationMatrix,
    estimateNormalizedMutualInformation,
    evaluateBaselineWindowStability,
    evaluateSignalVariances,
    type SignalObservationRow,
} from './signalFidelityEvaluator';

describe('signalFidelityEvaluator', () => {
    describe('computePearsonCorrelation', () => {
        it('calculates perfect positive correlation', () => {
            const xs = [1, 2, 3, 4, 5];
            const ys = [2, 4, 6, 8, 10];
            const r = computePearsonCorrelation(xs, ys);
            expect(r).toBe(1);
        });

        it('calculates perfect negative correlation', () => {
            const xs = [1, 2, 3, 4, 5];
            const ys = [10, 8, 6, 4, 2];
            const r = computePearsonCorrelation(xs, ys);
            expect(r).toBe(-1);
        });

        it('returns null for zero variance, non-finite values, or insufficient samples', () => {
            expect(computePearsonCorrelation([1, 2], [1, 2])).toBeNull();
            expect(computePearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
            expect(computePearsonCorrelation([1, 2, Number.NaN], [1, 2, 3])).toBeNull();
        });
    });

    describe('estimateNormalizedMutualInformation', () => {
        it('detects nonlinear dependence that Pearson correlation misses', () => {
            const xs = Array.from({ length: 21 }, (_, i) => i - 10);
            const ys = xs.map(x => x ** 2);

            expect(computePearsonCorrelation(xs, ys)).toBeCloseTo(0, 10);
            expect(estimateNormalizedMutualInformation(xs, ys, 4)).toBeGreaterThan(0.4);
        });

        it('returns null when entropy or sample count is insufficient', () => {
            expect(estimateNormalizedMutualInformation([1, 2, 3], [1, 4, 9])).toBeNull();
            expect(estimateNormalizedMutualInformation(Array(20).fill(1), Array.from({ length: 20 }, (_, i) => i))).toBeNull();
        });

        it('rejects invalid bin counts before taking the insufficient-sample path', () => {
            expect(() => estimateNormalizedMutualInformation([1], [1], 1)).toThrow('binCount');
            expect(() => estimateNormalizedMutualInformation([1], [1], 2.5)).toThrow('binCount');
            expect(() => estimateNormalizedMutualInformation([1], [1], Number.POSITIVE_INFINITY)).toThrow('binCount');
        });
    });

    describe('computeSignalCorrelationMatrix', () => {
        it('identifies collinear signal pairs (|r| >= 0.70)', () => {
            const rows: SignalObservationRow[] = [];
            for (let i = 0; i < 20; i++) {
                rows.push({
                    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
                    signals: {
                        hrv: 60 - i * 1.5,
                        restingHr: 45 + i * 1.5,
                        sleepScore: 80 - i * 0.2,
                        respiration: 14 + (i % 2 === 0 ? 0.2 : -0.2),
                        trainingLoad: 100 + i * 10,
                        soreness: 1 + (i % 3),
                        readiness: 80 - i * 1.2,
                    },
                });
            }

            const matrix = computeSignalCorrelationMatrix(rows, 0.70);
            expect(matrix.evaluatedDays).toBe(20);
            const hrvRhrPair = matrix.collinearPairs.find(
                p => (p.signalA === 'hrv' && p.signalB === 'restingHr')
                    || (p.signalA === 'restingHr' && p.signalB === 'hrv'),
            );
            expect(hrvRhrPair).toBeDefined();
            expect(hrvRhrPair?.r).toBeLessThan(-0.95);
        });

        it('uses unrounded Pearson r for the collinearity threshold', () => {
            const ys = [
                7.762, 4.229, 0.674, 8.667, -2.732, -3.496, 14.857, 3.253, 14.8, 4.265,
                18.472, 4.003, 21.025, 15.586, 16.9, 21.764, 7.826, 25.071, 19.155, 19.656,
            ];
            const rows: SignalObservationRow[] = ys.map((value, i) => ({
                date: `2026-08-${String(i + 1).padStart(2, '0')}`,
                signals: {
                    hrv: i,
                    restingHr: value,
                    sleepScore: null,
                    respiration: null,
                    trainingLoad: null,
                    soreness: null,
                    readiness: null,
                },
            }));

            const matrix = computeSignalCorrelationMatrix(rows, 0.70);
            const pair = matrix.correlations.find(p => p.signalA === 'hrv' && p.signalB === 'restingHr');
            expect(pair?.pearsonR).toBe(0.7);
            expect(pair?.isCollinear).toBe(false);
        });
    });

    describe('evaluateSignalVariances', () => {
        it('computes mean and standard deviation per signal', () => {
            const rows: SignalObservationRow[] = [
                {
                    date: '2026-08-01',
                    signals: { hrv: 50, restingHr: 50, sleepScore: null, respiration: null, trainingLoad: null, soreness: null, readiness: null },
                },
                {
                    date: '2026-08-02',
                    signals: { hrv: 70, restingHr: 60, sleepScore: null, respiration: null, trainingLoad: null, soreness: null, readiness: null },
                },
            ];
            const profiles = evaluateSignalVariances(rows);
            expect(profiles.hrv.mean).toBe(60);
            expect(profiles.hrv.stdDev).toBeCloseTo(14.14, 1);
            expect(profiles.sleepScore.validSamples).toBe(0);
        });
    });

    describe('evaluateBaselineWindowStability', () => {
        it('compares 28d and 7d windows on identical endpoint dates', () => {
            const values = Array.from({ length: 60 }, (_, i) => 60 + Math.sin(i) * 10);
            const stability = evaluateBaselineWindowStability(values, 7, 28);
            expect(stability.acuteWindowDays).toBe(7);
            expect(stability.chronicWindowDays).toBe(28);
            expect(stability.comparisonPoints).toBe(33);
            expect(stability.sufficientData).toBe(true);
            expect(stability.chronicVariance).toBeLessThan(stability.acuteVariance);
            expect(stability.dampingEfficiencyPct).toBeGreaterThan(0);
        });

        it('marks too-short histories as insufficient instead of implying measured damping', () => {
            const stability = evaluateBaselineWindowStability(Array.from({ length: 28 }, (_, i) => i), 7, 28);
            expect(stability.sufficientData).toBe(false);
            expect(stability.comparisonPoints).toBe(1);
        });

        it('rejects invalid window definitions and non-finite values', () => {
            expect(() => evaluateBaselineWindowStability([1, 2, 3], 7, 7)).toThrow('acuteWindowDays < chronicWindowDays');
            expect(() => evaluateBaselineWindowStability([1, 2, Number.NaN], 1, 2)).toThrow('finite numbers');
        });

        it('reports an unbounded ratio without claiming perfect damping', () => {
            const stability = evaluateBaselineWindowStability([0, 1, 2, 1], 2, 3);
            expect(stability.acuteVariance).toBe(0);
            expect(stability.chronicVariance).toBeGreaterThan(0);
            expect(stability.varianceReductionRatio).toBeNull();
            expect(stability.dampingEfficiencyPct).toBe(0);
        });
    });
});
