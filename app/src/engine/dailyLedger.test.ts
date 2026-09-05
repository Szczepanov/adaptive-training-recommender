import { describe, expect, it } from 'vitest';
import { admitsCandidate, computeDailyLedger, reconcileEntry, type LedgerEntry } from './dailyLedger';

const CEILINGS = { dailyMinuteCeiling: 90, dailySystemicCostCeiling: 0.6 };

function entry(overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'occurrenceId'>): LedgerEntry {
    return {
        revision: 1,
        reservedMinutes: 0,
        reservedSystemicCost: 0,
        state: 'reserved',
        ...overrides,
    };
}

describe('computeDailyLedger (ADR-0036 D-LEDGER)', () => {
    it('leaves at most 30 minutes for PM after a 60-minute AM completion against a 90-minute ceiling, even though both windows individually offer 90 minutes', () => {
        const am = entry({ occurrenceId: 'am-1', state: 'completed', reservedMinutes: 60, actualMinutes: 60, reservedSystemicCost: 0.2, actualSystemicCost: 0.2 });
        const ledger = computeDailyLedger(CEILINGS, [am]);
        expect(ledger.remainingMinutes).toBe(30);
        // A 90-minute PM window candidate is still bounded by the shared daily remainder,
        // not by its own window's nominal size.
        const admission = admitsCandidate(ledger, 90, 30, 0.1);
        expect(admission.admittedMinutes).toBe(30);
        expect(admission.admitted).toBe(true);
    });

    it('does not admit a candidate with spare minutes but exhausted daily systemic-cost capacity', () => {
        const am = entry({ occurrenceId: 'am-1', state: 'completed', reservedMinutes: 30, actualMinutes: 30, reservedSystemicCost: 0.6, actualSystemicCost: 0.6 });
        const ledger = computeDailyLedger(CEILINGS, [am]);
        expect(ledger.remainingMinutes).toBe(60); // plenty of minutes left
        expect(ledger.remainingSystemicCost).toBe(0); // but no cost headroom
        const admission = admitsCandidate(ledger, 60, 20, 0.05);
        expect(admission.admitted).toBe(false);
    });

    it('counts completed actuals and outstanding reservations against the same clamped remainder without double-counting', () => {
        const completed = entry({ occurrenceId: 'am-1', state: 'completed', reservedMinutes: 40, actualMinutes: 40, reservedSystemicCost: 0.2, actualSystemicCost: 0.2 });
        const pending = entry({ occurrenceId: 'pm-1', state: 'reserved', reservedMinutes: 30, reservedSystemicCost: 0.2 });
        const ledger = computeDailyLedger(CEILINGS, [completed, pending]);
        expect(ledger.remainingMinutes).toBe(20); // 90 - 40 - 30
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.2); // 0.6 - 0.2 - 0.2
    });

    it('keeps the outstanding reservation and flags unresolved when an actual is missing/ambiguous, so late reconciliation cannot invent capacity', () => {
        const ambiguous = entry({ occurrenceId: 'am-1', state: 'unresolved', reservedMinutes: 45, reservedSystemicCost: 0.3 });
        const ledger = computeDailyLedger(CEILINGS, [ambiguous]);
        expect(ledger.remainingMinutes).toBe(45);
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.3);
        expect(ledger.unresolvedEntries).toEqual(['am-1']);
    });

    it('flags a terminal entry missing only one dimension\'s actual as unresolved while still consuming the resolved dimension', () => {
        const partial = entry({ occurrenceId: 'am-1', state: 'partial', reservedMinutes: 60, actualMinutes: 25, reservedSystemicCost: 0.3 }); // no actualSystemicCost yet
        const ledger = computeDailyLedger(CEILINGS, [partial]);
        expect(ledger.remainingMinutes).toBe(65); // 90 - 25 actual minutes
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.3); // reserved cost retained
        expect(ledger.unresolvedEntries).toEqual(['am-1']);
    });

    it('clamps remaining capacity at zero on an execution overrun rather than erasing performed work', () => {
        const overrun = entry({ occurrenceId: 'am-1', state: 'completed', reservedMinutes: 60, actualMinutes: 120, reservedSystemicCost: 0.5, actualSystemicCost: 0.9 });
        const ledger = computeDailyLedger(CEILINGS, [overrun]);
        expect(ledger.remainingMinutes).toBe(0);
        expect(ledger.remainingSystemicCost).toBe(0);
    });

    it('releases only the proven-unperformed reservation for an abandoned occurrence, retaining known partial consumption', () => {
        const abandonedWithKnownPartial = entry({ occurrenceId: 'pm-1', state: 'abandoned', reservedMinutes: 30, actualMinutes: 10, reservedSystemicCost: 0.1, actualSystemicCost: 0.05 });
        const ledger = computeDailyLedger(CEILINGS, [abandonedWithKnownPartial]);
        // Only the demonstrably-performed 10 minutes / 0.05 cost remain consumed; the rest
        // of the original 30-minute reservation is released.
        expect(ledger.remainingMinutes).toBe(80);
        expect(ledger.remainingSystemicCost).toBeCloseTo(0.55);
    });

    it('dedupes replayed/reordered evidence for the same occurrence by keeping only the highest revision', () => {
        const stale = entry({ occurrenceId: 'am-1', revision: 1, state: 'reserved', reservedMinutes: 60, reservedSystemicCost: 0.3 });
        const fresh = entry({ occurrenceId: 'am-1', revision: 2, state: 'completed', reservedMinutes: 60, actualMinutes: 55, reservedSystemicCost: 0.3, actualSystemicCost: 0.28 });
        const ledgerBothOrders1 = computeDailyLedger(CEILINGS, [stale, fresh]);
        const ledgerBothOrders2 = computeDailyLedger(CEILINGS, [fresh, stale]);
        expect(ledgerBothOrders1).toEqual(ledgerBothOrders2);
        expect(ledgerBothOrders1.remainingMinutes).toBe(35); // 90 - 55, not 90 - 60 - 55
    });
});

describe('reconcileEntry (ADR-0036 D-LEDGER idempotency)', () => {
    it('applies evidence with a higher revision', () => {
        const reserved = entry({ occurrenceId: 'am-1', revision: 1, reservedMinutes: 60, reservedSystemicCost: 0.3 });
        const reconciled = reconcileEntry(reserved, { minutes: 58, systemicCost: 0.29, state: 'completed' }, 2);
        expect(reconciled).toMatchObject({ revision: 2, state: 'completed', actualMinutes: 58, actualSystemicCost: 0.29 });
    });

    it('is a no-op for duplicate or stale (equal or lower revision) evidence', () => {
        const reconciledOnce = reconcileEntry(entry({ occurrenceId: 'am-1', revision: 1, reservedMinutes: 60, reservedSystemicCost: 0.3 }), { minutes: 58, systemicCost: 0.29, state: 'completed' }, 2);
        const duplicateReplay = reconcileEntry(reconciledOnce, { minutes: 999, systemicCost: 0.99, state: 'abandoned' }, 2);
        const staleReplay = reconcileEntry(reconciledOnce, { minutes: 999, systemicCost: 0.99, state: 'abandoned' }, 1);
        expect(duplicateReplay).toEqual(reconciledOnce);
        expect(staleReplay).toEqual(reconciledOnce);
    });
});
