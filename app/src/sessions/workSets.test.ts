import { describe, expect, it } from 'vitest';
import type { SessionEntry, SessionStep } from './models';
import { completedPrescribedSets, completesPrescribedSet, hasUnpairedHoldSide, nextHoldSide } from './workSets';

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

describe('per-side distance carries', () => {
    const carry: SessionStep = {
        id: 'carry', kind: 'exercise', laterality: 'per_side',
        exerciseRef: { kind: 'catalog', exerciseId: 'suitcase_carry' },
        dose: { kind: 'distance', sets: 2, meters: 20 },
    };
    const leg = (id: string, side?: 'left' | 'right'): SessionEntry => ({
        id, executionId: 'exec', stepId: 'carry',
        completedAt: '2026-09-01T12:00:00Z', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
        // Real entries record the active step's exercise (logEntry).
        exerciseRef: { kind: 'catalog', exerciseId: 'suitcase_carry' },
        ...(side ? { side } : {}), payload: { kind: 'distance', meters: 20, loadKg: 24 },
    });

    it('treats a left/right carry pair as one set, so rest starts only after the second side', () => {
        const left = leg('l1', 'left');
        expect(completesPrescribedSet(carry, [], left)).toBe(false);
        expect(nextHoldSide(carry, [left])).toBe('right');
        expect(hasUnpairedHoldSide(carry, [left])).toBe(true);
        expect(completesPrescribedSet(carry, [left], leg('r1', 'right'))).toBe(true);
    });

    it('leaves a two-hand (bilateral) carry counting every entry as a set', () => {
        const bilateral: SessionStep = { ...carry, laterality: 'bilateral' };
        expect(completesPrescribedSet(bilateral, [], leg('b1'))).toBe(true);
        expect(hasUnpairedHoldSide(bilateral, [leg('b1')])).toBe(false);
    });
});

describe('pairing follows the logged entries, not the step dose', () => {
    const at = '2026-09-01T12:00:00Z';
    const sided = (id: string, kind: 'duration' | 'distance', side: 'left' | 'right'): SessionEntry => ({
        id, executionId: 'exec', stepId: 'row', completedAt: at, createdAt: at, updatedAt: at, side,
        payload: kind === 'duration' ? { kind: 'duration', seconds: 30 } : { kind: 'distance', meters: 20 },
    });
    // The pinned step is a rep exercise; the athlete swapped to a per-side carry mid-session.
    const pinnedRow: SessionStep = { id: 'row', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 8 } };

    it('pairs left/right carries logged under a rep step after a swap', () => {
        expect(completedPrescribedSets(pinnedRow, [sided('l', 'distance', 'left'), sided('r', 'distance', 'right')])).toBe(1);
    });

    it('pairs holds and carries under one step separately, whatever the order', () => {
        const entries = [sided('h1', 'duration', 'left'), sided('c1', 'distance', 'left'), sided('h2', 'duration', 'right'), sided('c2', 'distance', 'right')];
        expect(completedPrescribedSets(step, entries.map(e => ({ ...e, stepId: 'hold' })))).toBe(2);
        expect(completedPrescribedSets(pinnedRow, entries)).toBe(2);
    });
});

describe('pairing is per exercise', () => {
    const at = '2026-09-01T12:00:00Z';
    const carry = (id: string, exerciseId: string, side: 'left' | 'right'): SessionEntry => ({
        id, executionId: 'exec', stepId: 'carry', completedAt: at, createdAt: at, updatedAt: at, side,
        exerciseRef: { kind: 'catalog', exerciseId }, payload: { kind: 'distance', meters: 20 },
    });
    const carryStep = (exerciseId: string): SessionStep => ({
        id: 'carry', kind: 'exercise', laterality: 'per_side',
        exerciseRef: { kind: 'catalog', exerciseId }, dose: { kind: 'distance', sets: 2, meters: 20 },
    });

    it('does not complete a set from the left of carry A and the right of carry B', () => {
        const entries = [carry('a', 'suitcase_carry', 'left'), carry('b', 'farmer_carry', 'right')];
        expect(completedPrescribedSets(carryStep('farmer_carry'), entries)).toBe(0);
    });

    it('cues the side due for the current exercise after a swap mid-pair', () => {
        const entries = [carry('a', 'suitcase_carry', 'left')];
        expect(nextHoldSide(carryStep('suitcase_carry'), entries)).toBe('right');
        expect(nextHoldSide(carryStep('farmer_carry'), entries)).toBe('left');
        expect(hasUnpairedHoldSide(carryStep('farmer_carry'), entries)).toBe(false);
    });
});

describe('entries without a recorded exercise', () => {
    const at = '2026-09-01T12:00:00Z';
    // Entries lack an exercise only when their step had none (logEntry records the active one).
    const unnamedStep: SessionStep = {
        id: 'carry', kind: 'exercise', laterality: 'per_side', dose: { kind: 'distance', sets: 2, meters: 20 },
    };
    const swappedStep: SessionStep = { ...unnamedStep, exerciseRef: { kind: 'catalog', exerciseId: 'farmer_carry' } };
    const unnamedLeft: SessionEntry = {
        id: 'l', executionId: 'exec', stepId: 'carry', completedAt: at, createdAt: at, updatedAt: at, side: 'left',
        payload: { kind: 'distance', meters: 20 },
    };
    const unnamedRight: SessionEntry = { ...unnamedLeft, id: 'r', side: 'right' };
    const farmerRight: SessionEntry = { ...unnamedRight, id: 'fr', exerciseRef: { kind: 'catalog', exerciseId: 'farmer_carry' } };

    it('pair with each other', () => {
        expect(completedPrescribedSets(unnamedStep, [unnamedLeft, unnamedRight])).toBe(1);
        expect(nextHoldSide(unnamedStep, [unnamedLeft])).toBe('right');
    });

    it('never pair with a swapped-in exercise, so the runner (swapped step) and ledger (pinned step) agree', () => {
        const entries = [unnamedLeft, farmerRight];
        expect(completedPrescribedSets(swappedStep, entries)).toBe(0);
        expect(completedPrescribedSets(unnamedStep, entries)).toBe(0);
        expect(completesPrescribedSet(swappedStep, [unnamedLeft], farmerRight)).toBe(false);
        // The runner cues the swapped exercise from its own sides only.
        expect(nextHoldSide(swappedStep, [unnamedLeft])).toBe('left');
        expect(hasUnpairedHoldSide(swappedStep, [unnamedLeft])).toBe(false);
    });
});
