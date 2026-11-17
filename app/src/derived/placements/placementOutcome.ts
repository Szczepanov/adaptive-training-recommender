/**
 * Derived outcome of a past plan placement: ledger export Phase 3, coaching continuity
 * (`docs/plans/2026-11-14-ledger-export-ai-content.md`, G3).
 *
 * Pure and export-only: nothing is written back, and today or later dates are never
 * classified. Every uncertain case resolves to a weaker state, because a wrong `missed` would
 * be a fabricated fact. The ADR-0052 D-EVAL §2 readout answers a related question with its own
 * vocabulary. It should extend these inputs (per-execution completion fraction, executed definition
 * and performed date; link records instead of a boolean) rather than re-derive linkage on its own,
 * so the export and the readout cannot disagree about whether a session was performed.
 */

export const PLACEMENT_OUTCOMES = [
    'performed',
    'unknown',
    'done_unlinked',
    'started_not_completed',
    'dropped',
    'superseded',
    'missed',
] as const;
export type PlacementOutcome = typeof PLACEMENT_OUTCOMES[number];

export type PlacementOutcomeStatus = 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';

/** An execution of exactly this plan session: same plan id, revision, session id, and a content
 * hash that matches the verified stored revision. Title matches never count. */
export interface PlacementExecutionEvidence {
    state: 'in_progress' | 'completed' | 'abandoned';
}

export interface PlacementOutcomeInput {
    /** The placement's assigned date as of the export (a moved session uses its as-of date). */
    assignedDate: string;
    asOfDate: string;
    /** As-of placement status; `null` when the placement was removed from the overlay. */
    status: PlacementOutcomeStatus | null;
    /** Placements, executions and planned-to-performed links were all read completely, and the
     * reads cover this placement (its dates, its revision and the export window). */
    evidenceComplete: boolean;
    /** A valid, hash-verified planned-to-performed link exists for this placement. */
    linked: boolean;
    /** A link or execution for this placement exists but its revision or content hash did not verify. */
    unverifiedEvidence: boolean;
    executions: readonly PlacementExecutionEvidence[];
}

/**
 * The outcome of one placement dated before `asOfDate`, or `null` for today and later. Rules
 * are applied in order and the first match wins:
 * 1. a valid planned-to-performed link → `performed`;
 * 2. incomplete reads, a removed placement or unverifiable link/execution evidence → `unknown`;
 * 3. status `completed`, or a completed execution with no link → `done_unlinked`;
 * 4. a started or abandoned execution of the session → `started_not_completed`;
 * 5. status `dropped` or `superseded` → that status;
 * 6. otherwise → `missed`.
 */
export function classifyPlacementOutcome(input: PlacementOutcomeInput): PlacementOutcome | null {
    if (input.assignedDate >= input.asOfDate) return null;
    if (input.linked) return 'performed';
    if (!input.evidenceComplete || input.status === null || input.unverifiedEvidence) return 'unknown';
    if (input.status === 'completed' || input.executions.some(execution => execution.state === 'completed')) {
        return 'done_unlinked';
    }
    if (input.executions.length > 0) return 'started_not_completed';
    if (input.status === 'dropped' || input.status === 'superseded') return input.status;
    return 'missed';
}
