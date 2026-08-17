import { describe, expect, it } from 'vitest';
import { MAX_REPS_FOR_ESTIMATION, MAX_RIR_FOR_ESTIMATION, estimateOneRepMax } from './oneRepMax';
import type { LoggedSet } from '../engine/models';

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return { setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', ...overrides };
}

describe('estimateOneRepMax', () => {
    it('produces a plausible Epley estimate from a near-failure set of 5 at 2 RIR', () => {
        const estimate = estimateOneRepMax([set({ weightKg: 100, reps: 5, gauge: { scale: 'rir', value: 2 } })]);
        expect(estimate).toMatchObject({ estimatedOneRmKg: 116.7, formula: 'epley' }); // 100 * (1 + 5/30)
    });

    it('produces no estimate for a power-snatch session gauged by velocity loss', () => {
        const sets = [
            set({ weightKg: 80, reps: 3, gauge: { scale: 'velocity_loss', percent: 15 } }),
            set({ weightKg: 85, reps: 3, gauge: { scale: 'velocity_loss', percent: 18 } }),
        ];
        expect(estimateOneRepMax(sets)).toBeNull();
    });

    it('produces no estimate for a technical-quality gauged session, regardless of met/missed', () => {
        expect(estimateOneRepMax([set({ gauge: { scale: 'technical', met: true } })])).toBeNull();
        expect(estimateOneRepMax([set({ gauge: { scale: 'technical', met: false } })])).toBeNull();
    });

    it('never lets warm-up sets influence the result', () => {
        const withWarmup = estimateOneRepMax([
            set({ setIndex: 1, weightKg: 150, reps: 1, isWarmup: true, gauge: { scale: 'rir', value: 0 } }), // heavier but a warm-up
            set({ setIndex: 2, weightKg: 100, reps: 5, isWarmup: false, gauge: { scale: 'rir', value: 2 } }),
        ]);
        expect(withWarmup?.fromSet.setIndex).toBe(2);
    });

    it('excludes an ungauged set rather than guessing it was near failure', () => {
        expect(estimateOneRepMax([set({ gauge: undefined })])).toBeNull();
    });

    it(`excludes a set beyond MAX_RIR_FOR_ESTIMATION (${MAX_RIR_FOR_ESTIMATION}) reps in reserve`, () => {
        expect(estimateOneRepMax([set({ gauge: { scale: 'rir', value: MAX_RIR_FOR_ESTIMATION + 1 } })])).toBeNull();
        expect(estimateOneRepMax([set({ gauge: { scale: 'rir', value: MAX_RIR_FOR_ESTIMATION } })])).not.toBeNull();
    });

    it('excludes an RPE below the equivalent admissibility threshold', () => {
        const admissibleRpe = 10 - MAX_RIR_FOR_ESTIMATION;
        expect(estimateOneRepMax([set({ gauge: { scale: 'rpe_rts', value: admissibleRpe - 1 } })])).toBeNull();
        expect(estimateOneRepMax([set({ gauge: { scale: 'rpe_rts', value: admissibleRpe } })])).not.toBeNull();
    });

    it(`excludes a set beyond MAX_REPS_FOR_ESTIMATION (${MAX_REPS_FOR_ESTIMATION}) reps even if gauged near failure`, () => {
        expect(estimateOneRepMax([set({ reps: MAX_REPS_FOR_ESTIMATION + 1, gauge: { scale: 'rir', value: 1 } })])).toBeNull();
    });

    it('excludes a bodyweight set -- there is no external load to estimate a loaded max from', () => {
        expect(estimateOneRepMax([set({ weightKg: null, gauge: { scale: 'rir', value: 1 } })])).toBeNull();
    });

    it('picks the admissible set implying the highest capacity, not an average across sets', () => {
        const estimate = estimateOneRepMax([
            set({ setIndex: 1, weightKg: 90, reps: 5, gauge: { scale: 'rir', value: 1 } }), // Epley ~105
            set({ setIndex: 2, weightKg: 100, reps: 3, gauge: { scale: 'rir', value: 1 } }), // Epley 110
        ]);
        expect(estimate?.fromSet.setIndex).toBe(2);
    });

    it('returns null for an empty set list', () => {
        expect(estimateOneRepMax([])).toBeNull();
    });
});
