import { describe, expect, it } from 'vitest';
import {
    computePearsonCorrelation,
    computeSignalCorrelationMatrix,
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

        it('returns null for zero variance or insufficient samples', () => {
            expect(computePearsonCorrelation([1, 2], [1, 2])).toBeNull();
            expect(computePearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
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
                        restingHr: 45 + i * 1.5, // perfectly collinear with hrv (inverse)
                        sleepScore: 80 - i * 0.2,
                        respiration: 14 + (i % 2 === 0 ? 0.2 : -0.2), // noise
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
        it('calculates variance damping of 28d chronic window vs 7d acute window', () => {
            // 50 days of synthetic data with random daily noise around 60
            const values = Array.from({ length: 60 }, (_, i) => 60 + Math.sin(i) * 10);
            const stability = evaluateBaselineWindowStability(values, 7, 28);
            expect(stability.acuteWindowDays).toBe(7);
            expect(stability.chronicWindowDays).toBe(28);
            expect(stability.chronicVariance).toBeLessThan(stability.acuteVariance);
            expect(stability.dampingEfficiencyPct).toBeGreaterThan(0);
        });
    });
});
