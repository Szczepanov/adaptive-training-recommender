import { describe, expect, it } from 'vitest';
import type { SessionEntry, SessionStep } from './models';
import { completedPrescribedSets, completesPrescribedSet, nextHoldSide } from './workSets';

const step: SessionStep = {
    id: 'hold', kind: 'exercise', laterality: 'per_side',
    dose: { kind: 'duration', sets: 2, seconds: 30 },
};
const hold = (id: string, side?: 'left' | 'right'): SessionEntry => ({
    id, executionId: 'exec', stepId: 'hold',
    completedAt: '2026-09-01T12:00:00Z', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
    ...(side ? { side } : {}), payload: { kind: 'duration', seconds: 30 },
});

describe('per-side prescribed holds', () => {
    it('counts a right-first partial only after its left partner, including after resume', () => {
        const right = hold('r1', 'right');
        const left = hold('l1', 'left');
        expect(completedPrescribedSets(step, [right])).toBe(0);
        expect(nextHoldSide(step, [right])).toBe('left');
        expect(completesPrescribedSet(step, [right], left)).toBe(true);
        expect(completedPrescribedSets(step, [right, left])).toBe(1);
        expect(nextHoldSide(step, [right, left])).toBe('left');
    });

    it('recomputes pairs after deletion and treats legacy side-less holds as complete sets', () => {
        const left = hold('l1', 'left');
        const right = hold('r1', 'right');
        const legacy = hold('old');
        expect(completesPrescribedSet(step, [], left)).toBe(false);
        expect(completesPrescribedSet(step, [left], right)).toBe(true);
        expect(completedPrescribedSets(step, [left, right, legacy])).toBe(2);
        expect(completedPrescribedSets(step, [left, legacy])).toBe(1);
        expect(nextHoldSide(step, [left, legacy])).toBe('right');
        expect(completesPrescribedSet(step, [left, legacy], right)).toBe(true);
    });

    it('recomputes completion from a corrected side without retaining the old pair', () => {
        const left = hold('first', 'left');
        const second = hold('second', 'left');
        expect(completedPrescribedSets(step, [left, second])).toBe(0);
        expect(completedPrescribedSets(step, [left, { ...second, side: 'right' }])).toBe(1);
        expect(completedPrescribedSets(step, [left, second])).toBe(0);
    });
});
