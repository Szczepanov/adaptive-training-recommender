/**
 * ADR-0036 (H4) D-LEDGER: builds today's `LedgerEntry[]` from already-resolved occurrence
 * and execution facts (docs/plans/h4-434-pr3-bundle-second-member-launch.md, Phase 2 step
 * 6). Pure -- no Firestore, no session-definition resolution, no wall-clock reads. The
 * caller (`Home.tsx` / the Phase 2 seeding path in `sessionOccurrenceService.ts`) is
 * responsible for resolving each occurrence's estimated minutes/systemic cost (the same
 * estimator `activeExternalPlanService.ts`'s `toMembers` already uses) before calling this
 * module; "engine pure, resolution in callers" is the same invariant PR 1 established for
 * the launch-binding path.
 *
 * `superseded`/`skipped` occurrences produce no entry at all (not a zero-reservation
 * entry): they never governed a decision and never consumed anything, and Phase 1's
 * supersession (step 4b) / Phase 3's reject-handling (step 8) already made that the
 * invariant an occurrence in those states holds. Counting them would double-reserve a
 * re-imported plan, or charge the day for a member the gates just rejected.
 *
 * Deliberately not modeled here (documented rather than guessed at):
 * - `ReconciliationState: 'partial'` is never emitted. `SessionExecution.state` has no
 *   `'partial'` value, and the only partial-disposition signal the plan names
 *   (`SessionResponse.completedFraction`, Phase 5) does not exist yet at this point in the
 *   implementation sequence. Inventing a heuristic (e.g. from logged-entry counts) would be
 *   exactly the kind of new formula this module's ADR forbids. When a real partial signal
 *   is wired in, extend `toReconciliationState` -- do not guess here.
 * - An occurrence's own `missed` state has no case in the plan's step 6 table. Mapped
 *   conservatively to `'unresolved'` (reservation retained, evidence gap surfaced) per
 *   D-LEDGER's "missing cost is uncertainty, never spare capacity" -- never silently
 *   treated as freed capacity.
 * - A completed execution's actual systemic cost is not independently estimable from
 *   performed facts anywhere in this codebase (that estimator does not exist; building one
 *   here would be the same forbidden new formula). Full completion is therefore modeled as
 *   "the reserved estimate was, as far as anything can currently prove, actually spent" --
 *   `actualSystemicCost` mirrors `reservedSystemicCost`. An `abandoned` execution's
 *   systemic-cost dimension stays unresolved rather than assumed complete or scaled down.
 */

import type { LedgerEntry, ReconciliationState } from './dailyLedger';
import type { OccurrenceState, SessionExecutionState } from '../sessions/models';

/**
 * One occurrence's already-resolved facts, as the caller has gathered them for today.
 * `estimatedMinutes`/`estimatedSystemicCost` are the same authored/estimated figures used
 * at reservation time (D-LEDGER: "keep the current common cost/eligibility authorities").
 */
export interface OccurrenceLedgerInput {
    occurrenceId: string;
    occurrenceState: OccurrenceState;
    estimatedMinutes: number;
    estimatedSystemicCost: number;
    /** Orders competing/replayed evidence for this occurrence identity (D-LEDGER
     * dedupe authority). A monotonic proxy such as `Date.parse(execution.updatedAt ??
     * occurrence.updatedAt)` is sufficient -- this module does not require a real sequence
     * number, only that later evidence carries a strictly higher value. */
    revision: number;
    /** The linked execution's own facts, when a `session_executions` document exists for
     * this occurrence. Absent for a reservation with no execution yet. */
    execution?: {
        state: SessionExecutionState;
        startedAt: string;
        completedAt?: string | null;
    };
}

const TERMINAL_OCCURRENCE_STATES_WITHOUT_ENTRY: ReadonlySet<OccurrenceState> = new Set(['superseded', 'skipped']);

/** Elapsed minutes between two ISO instants, rounded to the nearest whole minute and
 * floored at zero. A real timestamp fact, not an estimate -- safe to treat as a bounded
 * actual regardless of completion disposition. */
function elapsedMinutes(startedAt: string, completedAt: string): number | undefined {
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(completedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return undefined;
    return Math.round((endMs - startMs) / 60000);
}

/** Maps one occurrence's already-resolved facts onto D-LEDGER's `ReconciliationState` --
 * see the module doc for the exact table and the deliberately-out-of-scope cases. Returns
 * `null` for `superseded`/`skipped`, meaning "no entry", not a zero-cost entry. */
export function toLedgerEntry(input: OccurrenceLedgerInput): LedgerEntry | null {
    if (TERMINAL_OCCURRENCE_STATES_WITHOUT_ENTRY.has(input.occurrenceState)) return null;

    const base = {
        occurrenceId: input.occurrenceId,
        revision: input.revision,
        reservedMinutes: input.estimatedMinutes,
        reservedSystemicCost: input.estimatedSystemicCost,
    };

    if (input.execution?.state === 'in_progress') {
        return { ...base, state: 'in_progress' };
    }
    if (input.execution?.state === 'completed') {
        const actualMinutes = input.execution.completedAt
            ? elapsedMinutes(input.execution.startedAt, input.execution.completedAt)
            : undefined;
        const state: ReconciliationState = actualMinutes !== undefined ? 'completed' : 'unresolved';
        return {
            ...base,
            state,
            ...(actualMinutes !== undefined ? { actualMinutes } : {}),
            // See module doc: no independent actual-cost estimator exists yet, so a full
            // completion's actual is the reserved estimate -- never assumed for an
            // unbounded-duration completion, since that would itself be an unverified guess.
            ...(actualMinutes !== undefined ? { actualSystemicCost: input.estimatedSystemicCost } : {}),
        };
    }
    if (input.execution?.state === 'abandoned') {
        // Elapsed minutes are still a real, knowable fact for an abandoned session; actual
        // systemic cost is not (see module doc) and stays unresolved, so
        // computeDailyLedger's TERMINAL_STATES gate falls back to the full
        // reservedSystemicCost rather than crediting an unproven partial discount.
        const actualMinutes = input.execution.completedAt
            ? elapsedMinutes(input.execution.startedAt, input.execution.completedAt)
            : undefined;
        return {
            ...base,
            state: 'abandoned',
            ...(actualMinutes !== undefined ? { actualMinutes } : {}),
        };
    }

    // No linked execution: the occurrence's own state governs.
    switch (input.occurrenceState) {
        case 'scheduled':
            return { ...base, state: 'reserved' };
        case 'active':
            // Claimed but no execution record found yet -- still in progress against the
            // reservation; no actual is knowable without an execution.
            return { ...base, state: 'in_progress' };
        case 'completed':
        case 'abandoned':
        case 'missed':
            // The occurrence itself reached a terminal disposition with no linked
            // execution to source a bounded actual from (e.g. the best-effort occurrence
            // transition in useSessionRunner succeeded while an execution lookup failed,
            // or a manually-marked 'missed' occurrence). Conservative fallback: retain the
            // full reservation, surface the evidence gap.
            return { ...base, state: 'unresolved' };
        default:
            return { ...base, state: 'unresolved' };
    }
}

/** Builds today's full `LedgerEntry[]` from every occurrence's already-resolved facts,
 * dropping `superseded`/`skipped` occurrences entirely. Pass the result straight to
 * `computeDailyLedger` -- this function performs no aggregation of its own. */
export function buildLedgerEntries(inputs: readonly OccurrenceLedgerInput[]): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    for (const input of inputs) {
        const entry = toLedgerEntry(input);
        if (entry) entries.push(entry);
    }
    return entries;
}
