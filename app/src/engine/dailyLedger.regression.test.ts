import { describe, expect, it } from 'vitest';
import { admitsCandidate, computeDailyLedger, reconcileEntry, type LedgerEntry } from './dailyLedger';

const CEILINGS = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 0.6 };

function entry(overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'occurrenceId'>): LedgerEntry {
    return {
        revision: 1,
        reservedMinutes: 30,
        reservedSystemicCost: 0.2,
        state: 'reserved',
        ...overrides,
    };
}

describe('daily ledger regression coverage', () => {
    it('does not label ordinary reserved or in-progress rows as unresolved evidence', () => {
        const ledger = computeDailyLedger(CEILINGS, [
            entry({ occurrenceId: 'future', state: 'reserved' }),
            entry({ occurrenceId: 'running', state: 'in_progress' }),
        ]);

        expect(ledger.remainingMinutes).toBe(30);
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.2);
        expect(ledger.unresolvedEntries).toEqual([]);
    });

    it('still exposes an explicit unresolved row while retaining its reservation', () => {
        const ledger = computeDailyLedger(CEILINGS, [entry({ occurrenceId: 'ambiguous', state: 'unresolved' })]);

        expect(ledger.remainingMinutes).toBe(60);
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.4);
        expect(ledger.unresolvedEntries).toEqual(['ambiguous']);
    });

    it('rejects negative or non-finite accounting facts instead of manufacturing capacity', () => {
        expect(() => computeDailyLedger(CEILINGS, [entry({ occurrenceId: 'negative', actualMinutes: -10, state: 'completed' })])).toThrow(/actualMinutes/);
        expect(() => computeDailyLedger(CEILINGS, [entry({ occurrenceId: 'nan', actualSystemicCost: Number.NaN, state: 'completed' })])).toThrow(/actualSystemicCost/);
        expect(() => computeDailyLedger({ dailyMinuteCeiling: Number.POSITIVE_INFINITY, dailySystemicCostCeiling: 0.6 }, [])).toThrow(/dailyMinuteCeiling/);
    });

    it('rejects a zero-duration candidate rather than admitting an empty occurrence', () => {
        const ledger = computeDailyLedger(CEILINGS, []);

        expect(admitsCandidate(ledger, 60, 0, 0.1)).toEqual({ admittedMinutes: 60, admitted: false });
    });

    it('treats an exhausted systemic-cost dimension as closed even for a nominal zero-cost candidate', () => {
        const ledger = computeDailyLedger(CEILINGS, [
            entry({ occurrenceId: 'spent', reservedMinutes: 20, reservedSystemicCost: 0.6 }),
        ]);

        expect(ledger.remainingSystemicCost).toBe(0);
        expect(admitsCandidate(ledger, 60, 20, 0)).toEqual({ admittedMinutes: 60, admitted: false });
    });

    it('rejects invalid reconciliation facts before they can enter a newer ledger revision', () => {
        const reserved = entry({ occurrenceId: 'am' });

        expect(() => reconcileEntry(reserved, { minutes: -1, state: 'completed' }, 2)).toThrow(/actual.minutes/);
        expect(() => reconcileEntry(reserved, { systemicCost: Number.NaN, state: 'completed' }, 2)).toThrow(/actual.systemicCost/);
        expect(() => reconcileEntry(reserved, { minutes: 20, state: 'completed' }, 1.5)).toThrow(/evidenceRevision/);
    });

    it('ignores stale/duplicate payload bytes completely once that revision is already applied', () => {
        const current = entry({
            occurrenceId: 'am', revision: 2, state: 'completed', actualMinutes: 20, actualSystemicCost: 0.1,
        });

        expect(reconcileEntry(current, { minutes: -999, systemicCost: Number.NaN, state: 'abandoned' }, 2)).toBe(current);
        expect(reconcileEntry(current, { minutes: -999, systemicCost: Number.NaN, state: 'abandoned' }, 1)).toBe(current);
    });

    it('enforces the 0..1 systemic-cost scale across ceilings, reservations, actuals, and candidates', () => {
        expect(() => computeDailyLedger({ dailyMinuteCeiling: 90, dailySystemicCostCeiling: 1.5 }, [])).toThrow(/dailySystemicCostCeiling/);
        expect(() => computeDailyLedger(CEILINGS, [entry({ occurrenceId: 'out-of-range-res', reservedSystemicCost: 1.1 })])).toThrow(/reservedSystemicCost/);
        expect(() => computeDailyLedger(CEILINGS, [entry({ occurrenceId: 'out-of-range-act', actualSystemicCost: 2.0, state: 'completed' })])).toThrow(/actualSystemicCost/);

        const reserved = entry({ occurrenceId: 'am' });
        expect(() => reconcileEntry(reserved, { systemicCost: 1.05, state: 'completed' }, 2)).toThrow(/actual.systemicCost/);

        const ledger = computeDailyLedger(CEILINGS, []);
        expect(() => admitsCandidate(ledger, 60, 30, 1.2)).toThrow(/candidateSystemicCost/);
    });

    it('accepts exact duplicate rows at the same revision but fails closed on conflicting equal-revision evidence', () => {
        const row1 = entry({ occurrenceId: 'am', revision: 1, state: 'reserved', reservedMinutes: 30, reservedSystemicCost: 0.2 });
        const exactDup = entry({ occurrenceId: 'am', revision: 1, state: 'reserved', reservedMinutes: 30, reservedSystemicCost: 0.2 });
        const conflictState = entry({ occurrenceId: 'am', revision: 1, state: 'completed', reservedMinutes: 30, reservedSystemicCost: 0.2, actualMinutes: 30, actualSystemicCost: 0.2 });
        const conflictCost = entry({ occurrenceId: 'am', revision: 1, state: 'reserved', reservedMinutes: 30, reservedSystemicCost: 0.4 });

        // Exact duplicates are accepted regardless of order
        const ledgerDup1 = computeDailyLedger(CEILINGS, [row1, exactDup]);
        const ledgerDup2 = computeDailyLedger(CEILINGS, [exactDup, row1]);
        expect(ledgerDup1).toEqual(ledgerDup2);
        expect(ledgerDup1.remainingMinutes).toBe(60);

        // Conflicting facts at equal revision fail closed regardless of order
        expect(() => computeDailyLedger(CEILINGS, [row1, conflictState])).toThrow(/Conflicting ledger entries for occurrence 'am' at revision 1/);
        expect(() => computeDailyLedger(CEILINGS, [conflictState, row1])).toThrow(/Conflicting ledger entries for occurrence 'am' at revision 1/);
        expect(() => computeDailyLedger(CEILINGS, [row1, conflictCost])).toThrow(/Conflicting ledger entries for occurrence 'am' at revision 1/);
        expect(() => computeDailyLedger(CEILINGS, [conflictCost, row1])).toThrow(/Conflicting ledger entries for occurrence 'am' at revision 1/);
    });
});
