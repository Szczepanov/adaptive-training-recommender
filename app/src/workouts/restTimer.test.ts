import { describe, expect, it } from 'vitest';
import { deriveRestIntervals, deriveRestSecondsBetweenSets, elapsedSeconds, formatElapsed } from './restTimer';
import type { LoggedSet } from '../engine/models';

function loggedSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return { setIndex: 1, weightKg: 80, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', ...overrides };
}

describe('elapsedSeconds', () => {
    it('computes whole seconds between two instants', () => {
        expect(elapsedSeconds('2026-08-17T18:00:00Z', '2026-08-17T18:02:14Z')).toBe(134);
    });

    it('floors partial seconds rather than rounding', () => {
        expect(elapsedSeconds('2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.999Z')).toBe(0);
    });

    it('never returns a negative value for a stale "now"', () => {
        expect(elapsedSeconds('2026-08-17T18:00:05Z', '2026-08-17T18:00:00Z')).toBe(0);
    });

    it('returns 0 for an unparseable instant rather than NaN', () => {
        expect(elapsedSeconds('not-a-date', '2026-08-17T18:00:00Z')).toBe(0);
    });
});

describe('formatElapsed', () => {
    it('formats seconds as M:SS with a zero-padded seconds field', () => {
        expect(formatElapsed(65)).toBe('1:05');
        expect(formatElapsed(9)).toBe('0:09');
    });

    it('does not wrap minutes past 59 -- a session can run long', () => {
        expect(formatElapsed(3661)).toBe('61:01');
    });
});

describe('deriveRestSecondsBetweenSets', () => {
    it('derives rest from the two sets\' own completedAt timestamps, not a stored field', () => {
        const first = loggedSet({ setIndex: 1, completedAt: '2026-08-17T18:00:00Z' });
        const second = loggedSet({ setIndex: 2, completedAt: '2026-08-17T18:02:30Z' });
        expect(deriveRestSecondsBetweenSets(first, second)).toBe(150);
    });
});

describe('deriveRestIntervals', () => {
    it('has no rest interval before the first set', () => {
        const sets = [loggedSet({ setIndex: 1, completedAt: '2026-08-17T18:00:00Z' })];
        expect(deriveRestIntervals(sets)).toEqual([null]);
    });

    it('derives one interval per subsequent set', () => {
        const sets = [
            loggedSet({ setIndex: 1, completedAt: '2026-08-17T18:00:00Z' }),
            loggedSet({ setIndex: 2, completedAt: '2026-08-17T18:01:30Z' }),
            loggedSet({ setIndex: 3, completedAt: '2026-08-17T18:04:30Z' }),
        ];
        expect(deriveRestIntervals(sets)).toEqual([null, 90, 180]);
    });

    it('distinguishes the same prescribed sets taken at different rest lengths', () => {
        const shortRest = [
            loggedSet({ setIndex: 1, reps: 5, weightKg: 100, completedAt: '2026-08-17T18:00:00Z' }),
            loggedSet({ setIndex: 2, reps: 5, weightKg: 100, completedAt: '2026-08-17T18:01:30Z' }),
        ];
        const longRest = [
            loggedSet({ setIndex: 1, reps: 5, weightKg: 100, completedAt: '2026-08-17T18:00:00Z' }),
            loggedSet({ setIndex: 2, reps: 5, weightKg: 100, completedAt: '2026-08-17T18:04:00Z' }),
        ];
        expect(deriveRestIntervals(shortRest)).not.toEqual(deriveRestIntervals(longRest));
    });

    it('returns an empty list for no sets', () => {
        expect(deriveRestIntervals([])).toEqual([]);
    });
});
