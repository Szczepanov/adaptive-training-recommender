import { describe, expect, it } from 'vitest';
import { buildLedgerEntries, toLedgerEntry, type OccurrenceLedgerInput } from './intradayLedgerInputs';
import { computeDailyLedger } from './dailyLedger';

function input(overrides: Partial<OccurrenceLedgerInput> = {}): OccurrenceLedgerInput {
    return {
        occurrenceId: 'occ-1',
        occurrenceState: 'scheduled',
        estimatedMinutes: 60,
        estimatedSystemicCost: 0.4,
        revision: 1,
        ...overrides,
    };
}

describe('toLedgerEntry', () => {
    it('maps a scheduled occurrence with no execution to a reserved entry', () => {
        const entry = toLedgerEntry(input());
        expect(entry).toEqual({
            occurrenceId: 'occ-1', revision: 1, reservedMinutes: 60, reservedSystemicCost: 0.4,
            state: 'reserved',
        });
    });

    it('maps an active occurrence with no execution yet to in_progress', () => {
        const entry = toLedgerEntry(input({ occurrenceState: 'active' }));
        expect(entry?.state).toBe('in_progress');
    });

    it('maps an in-progress execution to in_progress regardless of occurrence state', () => {
        const entry = toLedgerEntry(input({
            occurrenceState: 'active',
            execution: { state: 'in_progress', startedAt: '2026-08-18T07:00:00Z' },
        }));
        expect(entry?.state).toBe('in_progress');
        expect(entry?.actualMinutes).toBeUndefined();
    });

    it('maps a completed execution to completed with elapsed actual minutes and the reserved cost as actual', () => {
        const entry = toLedgerEntry(input({
            occurrenceState: 'active',
            estimatedSystemicCost: 0.35,
            execution: {
                state: 'completed',
                startedAt: '2026-08-18T07:00:00Z',
                completedAt: '2026-08-18T08:00:00Z',
            },
        }));
        expect(entry).toEqual({
            occurrenceId: 'occ-1', revision: 1, reservedMinutes: 60, reservedSystemicCost: 0.35,
            state: 'completed', actualMinutes: 60, actualSystemicCost: 0.35,
        });
    });

    it('leaves a completed execution unresolved when completedAt is missing (evidence gap, not a formula guess)', () => {
        const entry = toLedgerEntry(input({
            execution: { state: 'completed', startedAt: '2026-08-18T07:00:00Z', completedAt: null },
        }));
        expect(entry?.state).toBe('unresolved');
        expect(entry?.actualMinutes).toBeUndefined();
        expect(entry?.actualSystemicCost).toBeUndefined();
    });

    it('bounds actual minutes for an abandoned execution but leaves systemic cost unresolved', () => {
        const entry = toLedgerEntry(input({
            estimatedMinutes: 60,
            execution: {
                state: 'abandoned',
                startedAt: '2026-08-18T07:00:00Z',
                completedAt: '2026-08-18T07:12:00Z',
            },
        }));
        expect(entry).toEqual({
            occurrenceId: 'occ-1', revision: 1, reservedMinutes: 60, reservedSystemicCost: 0.4,
            state: 'abandoned', actualMinutes: 12,
        });
        expect(entry?.actualSystemicCost).toBeUndefined();
    });

    it('produces no entry for a superseded occurrence', () => {
        expect(toLedgerEntry(input({ occurrenceState: 'superseded' }))).toBeNull();
    });

    it('produces no entry for a skipped occurrence', () => {
        expect(toLedgerEntry(input({ occurrenceState: 'skipped' }))).toBeNull();
    });

    it('conservatively retains the reservation for a missed occurrence with no execution', () => {
        const entry = toLedgerEntry(input({ occurrenceState: 'missed' }));
        expect(entry?.state).toBe('unresolved');
        expect(entry?.reservedMinutes).toBe(60);
    });

    it('conservatively retains the reservation for a terminal occurrence state with no linked execution', () => {
        const entry = toLedgerEntry(input({ occurrenceState: 'completed' }));
        expect(entry?.state).toBe('unresolved');
    });
});

describe('buildLedgerEntries', () => {
    it('drops superseded/skipped and keeps every other occurrence', () => {
        const entries = buildLedgerEntries([
            input({ occurrenceId: 'occ-a', occurrenceState: 'scheduled' }),
            input({ occurrenceId: 'occ-b', occurrenceState: 'superseded' }),
            input({ occurrenceId: 'occ-c', occurrenceState: 'skipped' }),
            input({ occurrenceId: 'occ-d', occurrenceState: 'active' }),
        ]);
        expect(entries.map(e => e.occurrenceId)).toEqual(['occ-a', 'occ-d']);
    });
});

describe('ADR-0036 D-LEDGER acceptance cases (via buildLedgerEntries -> computeDailyLedger)', () => {
    it('a 90-minute daily ceiling with a 60-minute AM completion leaves at most 30 minutes for PM', () => {
        const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };
        const entries = buildLedgerEntries([
            input({
                occurrenceId: 'occ-am', occurrenceState: 'active', estimatedMinutes: 90, estimatedSystemicCost: 0.3,
                execution: { state: 'completed', startedAt: '2026-08-18T06:00:00Z', completedAt: '2026-08-18T07:00:00Z' },
            }),
        ]);
        const ledger = computeDailyLedger(ceilings, entries);
        expect(ledger.remainingMinutes).toBe(30);
    });

    it('a candidate with spare minutes but exhausted systemic cost is not admitted', () => {
        const ceilings = { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 0.5 };
        const entries = buildLedgerEntries([
            input({
                occurrenceId: 'occ-am', occurrenceState: 'active', estimatedMinutes: 40, estimatedSystemicCost: 0.5,
                execution: { state: 'completed', startedAt: '2026-08-18T06:00:00Z', completedAt: '2026-08-18T06:40:00Z' },
            }),
        ]);
        const ledger = computeDailyLedger(ceilings, entries);
        expect(ledger.remainingMinutes).toBe(80);
        expect(ledger.remainingSystemicCost).toBe(0);
    });

    it('a rejected member never reserves capacity (superseded/skipped excluded), unlike a pending reservation', () => {
        const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };
        const rejected = buildLedgerEntries([
            input({ occurrenceId: 'occ-skipped', occurrenceState: 'skipped', estimatedMinutes: 45, estimatedSystemicCost: 0.3 }),
        ]);
        const pending = buildLedgerEntries([
            input({ occurrenceId: 'occ-pending', occurrenceState: 'scheduled', estimatedMinutes: 45, estimatedSystemicCost: 0.3 }),
        ]);
        expect(computeDailyLedger(ceilings, rejected).remainingMinutes).toBe(90);
        expect(computeDailyLedger(ceilings, pending).remainingMinutes).toBe(45);
    });

    it('a re-imported plan does not double-reserve: the superseded predecessor contributes nothing alongside its successor', () => {
        const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };
        const entries = buildLedgerEntries([
            input({ occurrenceId: 'occ-old', occurrenceState: 'superseded', estimatedMinutes: 60, estimatedSystemicCost: 0.4 }),
            input({ occurrenceId: 'occ-new', occurrenceState: 'scheduled', estimatedMinutes: 60, estimatedSystemicCost: 0.4 }),
        ]);
        expect(computeDailyLedger(ceilings, entries).remainingMinutes).toBe(30);
    });

    it('an abandoned session retains its known elapsed minutes but the full systemic-cost reservation until resolved', () => {
        const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };
        const entries = buildLedgerEntries([
            input({
                occurrenceId: 'occ-abandoned', occurrenceState: 'active', estimatedMinutes: 60, estimatedSystemicCost: 0.4,
                execution: { state: 'abandoned', startedAt: '2026-08-18T06:00:00Z', completedAt: '2026-08-18T06:12:00Z' },
            }),
        ]);
        const ledger = computeDailyLedger(ceilings, entries);
        // Minutes: 90 - 12 (known elapsed) = 78. Cost: 1 - 0.4 (unresolved -> full reservation).
        expect(ledger.remainingMinutes).toBe(78);
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.6, 10);
        expect(ledger.unresolvedEntries).toContain('occ-abandoned');
    });

    it('missing/ambiguous evidence retains the full reservation rather than inferring spare capacity', () => {
        const ceilings = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1 };
        const entries = buildLedgerEntries([
            input({
                occurrenceId: 'occ-ambiguous', occurrenceState: 'active', estimatedMinutes: 60, estimatedSystemicCost: 0.4,
                execution: { state: 'completed', startedAt: '2026-08-18T06:00:00Z', completedAt: null },
            }),
        ]);
        const ledger = computeDailyLedger(ceilings, entries);
        expect(ledger.remainingMinutes).toBe(30);
        expect(ledger.unresolvedEntries).toContain('occ-ambiguous');
    });
});
