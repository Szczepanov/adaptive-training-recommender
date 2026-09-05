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

    it('rejects invalid reconciliation facts before they can enter the ledger', () => {
        const reserved = entry({ occurrenceId: 'am' });

        expect(() => reconcileEntry(reserved, { minutes: -1, state: 'completed' }, 2)).toThrow(/actual.minutes/);
        expect(() => reconcileEntry(reserved, { systemicCost: Number.NaN, state: 'completed' }, 2)).toThrow(/actual.systemicCost/);
        expect(() => reconcileEntry(reserved, { minutes: 20, state: 'completed' }, 1.5)).toThrow(/evidenceRevision/);
    });
});
