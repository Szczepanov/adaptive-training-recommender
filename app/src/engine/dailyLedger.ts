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
     * terminal state, or whose state is itself `unresolved`. Same-day capacity must expose
     * this rather than silently treating it as an empty training day. */
    unresolvedEntries: string[];
}

const TERMINAL_STATES: ReadonlySet<ReconciliationState> = new Set(['completed', 'partial', 'abandoned']);

/** Keeps the entry with the highest `revision` per `occurrenceId` -- idempotent under
 * replayed, duplicate or reordered completion/provider evidence (D-LEDGER). */
function dedupeByOccurrence(entries: readonly LedgerEntry[]): LedgerEntry[] {
    const latest = new Map<string, LedgerEntry>();
    for (const entry of entries) {
        const current = latest.get(entry.occurrenceId);
        if (!current || entry.revision > current.revision) latest.set(entry.occurrenceId, entry);
    }
    return [...latest.values()];
}

/** Compute one date's shared remainder across every window, from already-resolved
 * ceilings and per-occurrence ledger rows. Every accepted/in-progress/terminal entry is
 * counted exactly once (by its deduped, latest-revision row); an occurrence is never
 * refunded merely because its terminal disposition is favorable, and it is never charged
 * twice across reservation and reconciled actual. */
export function computeDailyLedger(ceilings: LedgerCeilings, entries: readonly LedgerEntry[]): DailyLedgerResult {
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

        // Missing an actual for either dimension keeps the outstanding reservation for
        // that dimension (handled above) and flags the occurrence as unresolved -- delayed
        // reconciliation must not silently create fictitious capacity.
        if (entry.state === 'unresolved' || !hasActualMinutes || !hasActualCost) {
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
    if (evidenceRevision <= entry.revision) return entry;
    return {
        ...entry,
        revision: evidenceRevision,
        state: actual.state,
        actualMinutes: actual.minutes ?? entry.actualMinutes,
        actualSystemicCost: actual.systemicCost ?? entry.actualSystemicCost,
    };
}

export interface CandidateAdmission {
    /** The candidate's window duration clamped to the ledger's remaining minutes. */
    admittedMinutes: number;
    /** True only when there are spare minutes *and* the candidate's systemic cost fits
     * within the remaining cost ceiling -- minute availability alone is not admission
     * (D-LEDGER). */
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
    const admittedMinutes = Math.max(0, Math.min(candidateWindowMinutes, ledger.remainingMinutes));
    const admitted = admittedMinutes > 0 && candidateMinutes <= admittedMinutes && candidateSystemicCost <= ledger.remainingSystemicCost;
    return { admittedMinutes, admitted };
}
