import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import {
    DailyLedgerAggregateService,
    buildInitialReservations,
    hasSeededAggregate,
    findAggregateDrift,
    MAX_RECOVERY_GENERATION,
    type DailyLedgerAggregate,
} from './dailyLedgerAggregateService';
import type { OccurrenceLedgerInput } from '../engine/intradayLedgerInputs';

const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };

function occInput(overrides: Partial<OccurrenceLedgerInput> = {}): OccurrenceLedgerInput {
    return {
        occurrenceId: 'occ-1', occurrenceState: 'scheduled',
        estimatedMinutes: 60, estimatedSystemicCost: 0.4, revision: 1,
        ...overrides,
    };
}

function aggregate(overrides: Partial<DailyLedgerAggregate> = {}): DailyLedgerAggregate {
    return {
        userId: 'u1', date: '2026-08-18', revision: 1, ceilings,
        reservations: {}, seededAt: '2026-08-18T05:00:00Z',
        createdAt: '2026-08-18T05:00:00Z', updatedAt: '2026-08-18T05:00:00Z',
        ...overrides,
    };
}

describe('hasSeededAggregate', () => {
    it('is false for a missing aggregate', () => {
        expect(hasSeededAggregate(null)).toBe(false);
        expect(hasSeededAggregate(undefined)).toBe(false);
    });

    it('is false for a document missing seededAt (partial write, must fail closed)', () => {
        const partial = aggregate();
        // @ts-expect-error -- intentionally malformed to exercise the fail-closed path
        delete partial.seededAt;
        expect(hasSeededAggregate(partial)).toBe(false);
    });

    it('is true once seededAt is present', () => {
        expect(hasSeededAggregate(aggregate())).toBe(true);
    });
});

describe('buildInitialReservations', () => {
    it('reuses step 6\'s mapping verbatim -- a scheduled occurrence seeds a reserved row', () => {
        const reservations = buildInitialReservations([occInput()]);
        expect(reservations['occ-1']).toEqual({ minutes: 60, systemicCost: 0.4, state: 'reserved' });
    });

    it('drops superseded/skipped occurrences from the seed entirely', () => {
        const reservations = buildInitialReservations([
            occInput({ occurrenceId: 'occ-superseded', occurrenceState: 'superseded' }),
            occInput({ occurrenceId: 'occ-skipped', occurrenceState: 'skipped' }),
            occInput({ occurrenceId: 'occ-live', occurrenceState: 'scheduled' }),
        ]);
        expect(Object.keys(reservations)).toEqual(['occ-live']);
    });

    it('includes a pre-existing abandoned execution with its bounded actual minutes (the exact regression the plan calls out)', () => {
        const reservations = buildInitialReservations([
            occInput({
                occurrenceId: 'occ-abandoned', occurrenceState: 'active',
                execution: { state: 'abandoned', startedAt: '2026-08-18T06:00:00Z', completedAt: '2026-08-18T06:15:00Z' },
            }),
        ]);
        expect(reservations['occ-abandoned']).toEqual({
            minutes: 60, systemicCost: 0.4, state: 'abandoned', actualMinutes: 15,
        });
    });
});

describe('findAggregateDrift', () => {
    it('reports no drift when the aggregate matches a freshly recomputed seed', () => {
        const inputs = [occInput()];
        const agg = aggregate({ reservations: buildInitialReservations(inputs) });
        expect(findAggregateDrift(agg, inputs)).toEqual([]);
    });

    it('flags an occurrence whose persisted row disagrees with the recomputed one', () => {
        const inputs = [occInput({ estimatedMinutes: 45 })];
        const agg = aggregate({ reservations: { 'occ-1': { minutes: 60, systemicCost: 0.4, state: 'reserved' } } });
        expect(findAggregateDrift(agg, inputs)).toEqual(['occ-1']);
    });

    it('flags a reservation with no corresponding current occurrence', () => {
        const agg = aggregate({ reservations: { 'occ-ghost': { minutes: 30, systemicCost: 0.2, state: 'reserved' } } });
        expect(findAggregateDrift(agg, [])).toEqual(['occ-ghost']);
    });
});

describe('DailyLedgerAggregateService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'users/u1/daily_ledgers/2026-08-18' });
    });

    describe('seedIfAbsent', () => {
        it('seeds a fresh aggregate when none exists', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const result = service.seedIfAbsent(
                mockTx as never, 'u1', '2026-08-18', null, ceilings, [occInput()], '2026-08-18T05:00:00Z',
            );
            expect(result.revision).toBe(1);
            expect(result.reservations['occ-1']).toEqual({ minutes: 60, systemicCost: 0.4, state: 'reserved' });
            expect(mockTx.set).toHaveBeenCalledTimes(1);
        });

        it('is a no-op returning the existing aggregate unchanged when already seeded', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const existing = aggregate({ revision: 3, reservations: { 'occ-existing': { minutes: 10, systemicCost: 0.1, state: 'reserved' } } });
            const result = service.seedIfAbsent(mockTx as never, 'u1', '2026-08-18', existing, ceilings, [occInput()]);
            expect(result).toBe(existing);
            expect(mockTx.set).not.toHaveBeenCalled();
        });
    });

    describe('applyReservation', () => {
        it('adds a reservation and bumps revision by exactly one', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({ revision: 1, reservations: {} });
            const result = service.applyReservation(
                mockTx as never, 'u1', '2026-08-18', current, 'occ-new',
                { minutes: 45, systemicCost: 0.3, state: 'reserved' },
                '2026-08-18T06:00:00Z',
            );
            expect(result.revision).toBe(2);
            expect(result.reservations['occ-new']).toEqual({ minutes: 45, systemicCost: 0.3, state: 'reserved' });
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ revision: 2 }),
            );
        });

        it('removes a reservation when passed null (reject / re-import supersede)', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({ revision: 2, reservations: { 'occ-rejected': { minutes: 45, systemicCost: 0.3, state: 'reserved' } } });
            const result = service.applyReservation(mockTx as never, 'u1', '2026-08-18', current, 'occ-rejected', null);
            expect(result.revision).toBe(3);
            expect(result.reservations).not.toHaveProperty('occ-rejected');
        });

        it('never mutates a reservation for a different occurrence', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({ reservations: { 'occ-other': { minutes: 20, systemicCost: 0.1, state: 'reserved' } } });
            const result = service.applyReservation(
                mockTx as never, 'u1', '2026-08-18', current, 'occ-new',
                { minutes: 45, systemicCost: 0.3, state: 'reserved' },
            );
            expect(result.reservations['occ-other']).toEqual({ minutes: 20, systemicCost: 0.1, state: 'reserved' });
        });
    });

    describe('currentGeneration and rejectReservationAndIncrementGeneration (H4 #434 PR 3 step 8, item 2a)', () => {
        it('defaults to generation 0 for a session that has never been rejected', () => {
            const service = new DailyLedgerAggregateService();
            expect(service.currentGeneration(aggregate(), 'session-am')).toBe(0);
        });

        it('drops the reservation and bumps the generation in one combined write', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({
                revision: 2,
                reservations: { 'occ-rejected': { minutes: 45, systemicCost: 0.3, state: 'reserved' } },
            });
            const { aggregate: result, generation } = service.rejectReservationAndIncrementGeneration(
                mockTx as never, 'u1', '2026-08-18', current, 'occ-rejected', 'session-am',
            );
            expect(generation).toBe(1);
            expect(result.revision).toBe(3);
            expect(result.reservations).not.toHaveProperty('occ-rejected');
            expect(result.generations).toEqual({ 'session-am': 1 });
            expect(mockTx.set).toHaveBeenCalledTimes(1);
        });

        it('increments an existing generation rather than resetting it', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({ generations: { 'session-am': 2 } });
            const { generation } = service.rejectReservationAndIncrementGeneration(
                mockTx as never, 'u1', '2026-08-18', current, 'occ-rejected-again', 'session-am',
            );
            expect(generation).toBe(3);
        });

        it('never touches another session\'s generation', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const current = aggregate({ generations: { 'session-pm': 1 } });
            const { aggregate: result } = service.rejectReservationAndIncrementGeneration(
                mockTx as never, 'u1', '2026-08-18', current, 'occ-am', 'session-am',
            );
            expect(result.generations).toEqual({ 'session-pm': 1, 'session-am': 1 });
        });

        it('fails closed when a persisted generation is malformed instead of coercing it to generation 0', () => {
            const service = new DailyLedgerAggregateService();
            const malformed = aggregate({
                generations: {
                    'neg': -1,
                    'str': '1' as unknown as number,
                    'float': 1.5,
                    'nan': Number.NaN,
                },
            });

            expect(() => service.currentGeneration(malformed, 'neg')).toThrow(TypeError);
            expect(() => service.currentGeneration(malformed, 'str')).toThrow(TypeError);
            expect(() => service.currentGeneration(malformed, 'float')).toThrow(TypeError);
            expect(() => service.currentGeneration(malformed, 'nan')).toThrow(TypeError);
        });

        it('does not write when a corrupted persisted generation would make recovery identity ambiguous', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const corrupted = aggregate({ generations: { 'session-am': -5 } });

            expect(() => service.rejectReservationAndIncrementGeneration(
                mockTx as never, 'u1', '2026-08-18', corrupted, 'occ-1', 'session-am',
            )).toThrow(TypeError);
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('accepts the maximum as current identity state but refuses another reject rather than saturating and reusing it', () => {
            const service = new DailyLedgerAggregateService();
            const mockTx = { set: vi.fn() };
            const atMax = aggregate({ generations: { 'session-am': MAX_RECOVERY_GENERATION } });

            expect(service.currentGeneration(atMax, 'session-am')).toBe(MAX_RECOVERY_GENERATION);
            expect(() => service.rejectReservationAndIncrementGeneration(
                mockTx as never, 'u1', '2026-08-18', atMax, 'occ-1', 'session-am',
            )).toThrow(RangeError);
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('fails closed on above-max or unsafe persisted generations', () => {
            const service = new DailyLedgerAggregateService();
            const malformed = aggregate({
                generations: {
                    'above-max': MAX_RECOVERY_GENERATION + 1,
                    'unsafe': Number.MAX_SAFE_INTEGER,
                },
            });

            expect(() => service.currentGeneration(malformed, 'above-max')).toThrow(TypeError);
            expect(() => service.currentGeneration(malformed, 'unsafe')).toThrow(TypeError);
        });
    });
});