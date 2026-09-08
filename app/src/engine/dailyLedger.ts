/**
 * ADR-0036 (H4) D-LEDGER: one pure, as-of daily accounting boundary for the shared minute
 * and systemic-cost ceiling a date's windows draw from. This module has no dependency on
 * wall-clock/timezone resolution (D-TIME), Firestore, or any existing schedule module --
 * every input (ceilings, reservations, actuals) is already resolved by the caller. It is
 * not wired into `schedule.ts`'s `resolveAvailability`, `planner.ts`'s fixed-activity cost
 * reduces, or any recommendation decision yet; see the H4 status notes in
 * `docs/plans/cycling-primary-hybrid-evaluation.md` for the deferred wiring step.
 *
 * Keep the current common cost/eligibility authorities: this file does not invent another
 * fatigue-fusion formula or a second systemic-cost scale. `dailySystemicCostCeiling` and
 * `reservedSystemicCost`/`actualSystemicCost` are expected on the same 0..1
 * `WorkoutCostProfile.systemic` scale existing callers already use.
 */

export interface LedgerCeilings {
    /** Resolved total daily minute ceiling, from the existing capacity/adjudication
     * authorities. Not a new physiological threshold -- reused as-is. */
    dailyMinuteCeiling: number;
    /** Resolved daily systemic-cost/load ceiling, 0..1, from the existing authorities. */
    dailySystemicCostCeiling: number;
}

/** `reserved` -- accepted, not yet started. `in_progress` -- started, not yet complete.
 * `completed`/`partial`/`abandoned` -- terminal states with a canonical disposition, each
 * of which may or may not yet carry a bounded actual for a given dimension.
 * `unresolved` -- telemetry is missing/late/ambiguous; the reservation is retained rather
 * than inferred as zero (D-LEDGER: "missing cost is uncertainty, not proof of spare
 * capacity"). */
export type ReconciliationState = 'reserved' | 'in_progress' | 'completed' | 'partial' | 'abandoned' | 'unresolved';

/** One occurrence's ledger row. `occurrenceId` is the canonical performed-occurrence
 * identity -- the deduplication authority (D-LEDGER); this module does not build an
 * H4-specific fuzzy matcher, it only trusts the identity it is given. `revision` orders
 * competing/replayed/reordered evidence for that same identity. */
export interface LedgerEntry {
    occurrenceId: string;
    revision: number;
    reservedMinutes: number;
    reservedSystemicCost: number;
    state: ReconciliationState;
    /** Present only once canonical evidence bounds the actual minutes for this dimension. */
    actualMinutes?: number;
    /** Present only once canonical evidence bounds the actual systemic cost for this
     * dimension. Reconciliation is per occurrence *and* per dimension: one dimension can
     * resolve while the other stays an outstanding reservation. */
    actualSystemicCost?: number;
}

export interface DailyLedgerResult {
    /** Daily minute ceiling minus unique consumption (actual where known, reserved
     * otherwise), clamped at zero. */
    remainingMinutes: number;
    /** Daily systemic-cost ceiling minus unique consumption on the same rule, clamped at
     * zero. Never cross-subtracted with `remainingMinutes` -- exhausting one dimension
     * does not free the other (D-LEDGER). */
    remainingSystemicCost: number;
    /** Occurrence ids where at least one dimension's actual is still unknown despite a
     * terminal state, or whose state is itself `unresolved`. A normal future reservation
     * or known in-progress occurrence still consumes capacity but is not ambiguous evidence. */
    unresolvedEntries: string[];
}

const TERMINAL_STATES: ReadonlySet<ReconciliationState> = new Set(['completed', 'partial', 'abandoned']);

function assertFiniteNonNegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a finite number >= 0`);
    }
}

function assertSystemicCost(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${label} must be a finite number in [0, 1]`);
    }
}

function assertRevision(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a nonnegative integer`);
    }
}

function assertValidCeilings(ceilings: LedgerCeilings): void {
    assertFiniteNonNegative(ceilings.dailyMinuteCeiling, 'dailyMinuteCeiling');
    assertSystemicCost(ceilings.dailySystemicCostCeiling, 'dailySystemicCostCeiling');
}

function assertValidEntry(entry: LedgerEntry): void {
    if (!entry.occurrenceId) throw new Error('occurrenceId must be non-empty');
    assertRevision(entry.revision, `revision for ${entry.occurrenceId}`);
    assertFiniteNonNegative(entry.reservedMinutes, `reservedMinutes for ${entry.occurrenceId}`);
    assertSystemicCost(entry.reservedSystemicCost, `reservedSystemicCost for ${entry.occurrenceId}`);
    if (entry.actualMinutes !== undefined) {
        assertFiniteNonNegative(entry.actualMinutes, `actualMinutes for ${entry.occurrenceId}`);
    }
    if (entry.actualSystemicCost !== undefined) {
        assertSystemicCost(entry.actualSystemicCost, `actualSystemicCost for ${entry.occurrenceId}`);
    }
}

function areEntriesEqual(a: LedgerEntry, b: LedgerEntry): boolean {
    return a.occurrenceId === b.occurrenceId
        && a.revision === b.revision
        && a.state === b.state
        && a.reservedMinutes === b.reservedMinutes
        && a.reservedSystemicCost === b.reservedSystemicCost
        && a.actualMinutes === b.actualMinutes
        && a.actualSystemicCost === b.actualSystemicCost;
}

/** Keeps the entry with the highest `revision` per `occurrenceId` -- idempotent under
 * replayed, duplicate or reordered completion/provider evidence (D-LEDGER).
 * Identical duplicate rows sharing an occurrenceId and revision are accepted, but
 * conflicting facts at the same revision cause a fail-closed rejection regardless of order. */
function dedupeByOccurrence(entries: readonly LedgerEntry[]): LedgerEntry[] {
    const latest = new Map<string, LedgerEntry>();
    for (const entry of entries) {
        assertValidEntry(entry);
        const current = latest.get(entry.occurrenceId);
        if (!current) {
            latest.set(entry.occurrenceId, entry);
        } else if (entry.revision > current.revision) {
            latest.set(entry.occurrenceId, entry);
        } else if (entry.revision === current.revision && !areEntriesEqual(entry, current)) {
            throw new Error(`Conflicting ledger entries for occurrence '${entry.occurrenceId}' at revision ${entry.revision}`);
        }
    }
    return [...latest.values()];
}

/** Compute one date's shared remainder across every window, from already-resolved
 * ceilings and per-occurrence ledger rows. Every accepted/in-progress/terminal entry is
 * counted exactly once (by its deduped, latest-revision row); an occurrence is never
 * refunded merely because its terminal disposition is favorable, and it is never charged
 * twice across reservation and reconciled actual. */
export function computeDailyLedger(ceilings: LedgerCeilings, entries: readonly LedgerEntry[]): DailyLedgerResult {
    assertValidCeilings(ceilings);
    const deduped = dedupeByOccurrence(entries);

    let consumedMinutes = 0;
    let consumedSystemicCost = 0;
    const unresolvedEntries: string[] = [];

    for (const entry of deduped) {
        const isTerminal = TERMINAL_STATES.has(entry.state);
        const hasActualMinutes = isTerminal && entry.actualMinutes !== undefined;
        const hasActualCost = isTerminal && entry.actualSystemicCost !== undefined;

        consumedMinutes += hasActualMinutes ? entry.actualMinutes! : entry.reservedMinutes;
        consumedSystemicCost += hasActualCost ? entry.actualSystemicCost! : entry.reservedSystemicCost;

        // Missing an actual matters to reconciliation only after a terminal disposition.
        // Reserved and in-progress rows intentionally retain their reservation above, but
        // they are known states rather than ambiguous evidence. An explicit `unresolved`
        // state is always surfaced.
        if (entry.state === 'unresolved' || (isTerminal && (!hasActualMinutes || !hasActualCost))) {
            unresolvedEntries.push(entry.occurrenceId);
        }
    }

    return {
        remainingMinutes: Math.max(0, ceilings.dailyMinuteCeiling - consumedMinutes),
        remainingSystemicCost: Math.max(0, ceilings.dailySystemicCostCeiling - consumedSystemicCost),
        unresolvedEntries,
    };
}

/** Applies canonical execution/reconciliation evidence to one entry. Refuses to move
 * `revision` backwards -- a duplicate or late-arriving copy of already-applied evidence
 * (or a stale replay) is a no-op, never a second charge or an erroneous refund. An
 * execution overrun (`actual` exceeding the original reservation) is accepted as-is: this
 * function records the actual; `computeDailyLedger` clamps the *remaining* total at zero
 * from the larger value rather than this function erasing or shrinking the reservation. */
export function reconcileEntry(
    entry: LedgerEntry,
    actual: { minutes?: number; systemicCost?: number; state: ReconciliationState },
    evidenceRevision: number,
): LedgerEntry {
    assertValidEntry(entry);
    assertRevision(evidenceRevision, 'evidenceRevision');
    // Stale/duplicate evidence is deliberately a no-op before inspecting its payload: its
    // bytes cannot affect the authoritative row once an equal/newer revision is present.
    if (evidenceRevision <= entry.revision) return entry;
    if (actual.minutes !== undefined) assertFiniteNonNegative(actual.minutes, 'actual.minutes');
    if (actual.systemicCost !== undefined) assertSystemicCost(actual.systemicCost, 'actual.systemicCost');
    return {
        ...entry,
        revision: evidenceRevision,
        state: actual.state,
        actualMinutes: actual.minutes ?? entry.actualMinutes,
        actualSystemicCost: actual.systemicCost ?? entry.actualSystemicCost,
    };
}

/** Floating-point tolerance for systemic-cost comparisons on the bounded 0..1 scale.
 * Binary floating-point subtraction (e.g. 0.6 - 0.2 = 0.39999999999999997) can leave
 * a remainder infinitesimally below a mathematically exact candidate cost. A 1e-6 tolerance
 * prevents spurious rejection of exact fits while keeping the capacity boundary rigid. */
export const SYSTEMIC_COST_TOLERANCE = 1e-6;

export interface CandidateAdmission {
    /** The candidate's window duration clamped to the ledger's remaining minutes. */
    admittedMinutes: number;
    /** True only when both daily dimensions have headroom and the candidate fits within
     * those remainders -- minute availability alone is not admission (D-LEDGER). */
    admitted: boolean;
}

/** Whether a candidate occurrence can be admitted against the current ledger remainder.
 * Spare minutes never substitute for exhausted systemic-cost capacity, and vice versa --
 * both dimensions must independently have room. */
export function admitsCandidate(
    ledger: DailyLedgerResult,
    candidateWindowMinutes: number,
    candidateMinutes: number,
    candidateSystemicCost: number,
): CandidateAdmission {
    assertFiniteNonNegative(ledger.remainingMinutes, 'ledger.remainingMinutes');
    assertFiniteNonNegative(ledger.remainingSystemicCost, 'ledger.remainingSystemicCost');
    assertFiniteNonNegative(candidateWindowMinutes, 'candidateWindowMinutes');
    assertFiniteNonNegative(candidateMinutes, 'candidateMinutes');
    assertSystemicCost(candidateSystemicCost, 'candidateSystemicCost');

    const admittedMinutes = Math.max(0, Math.min(candidateWindowMinutes, ledger.remainingMinutes));
    const admitted = candidateMinutes > 0
        && admittedMinutes > 0
        && ledger.remainingSystemicCost > 0
        && candidateMinutes <= admittedMinutes
        && candidateSystemicCost <= ledger.remainingSystemicCost + SYSTEMIC_COST_TOLERANCE;
    return { admittedMinutes, admitted };
}
