import type { ProposedProgressionChange } from '../engine/progressionReview';

/**
 * `evaluateProgressionReview` (H5b) returns no id of its own -- it is a pure function, not a
 * persisted proposal. `confirmProgressionRevision` (Phase C) needs a `proposalId` stable
 * across re-running the same review against the same evidence (so a repeated confirmation
 * of an unchanged proposal is genuinely idempotent), but different whenever the evidence
 * that produced `proposedChange` actually changes.
 *
 * Composed directly from the values that matter to that identity -- the source revision
 * `confirmProgressionRevision` re-validates anyway, the review date, and the proposed
 * value -- rather than hashing the whole result: those three already uniquely determine
 * "this exact proposal" for the single registered progression variable
 * (`duration_min`, `engine/blockIntent.ts`), and staying human-readable makes a stored
 * activation's `proposalId` field legible without decoding a hash.
 */
export function deriveProposalId(sourcePlanRevision: number, asOfDate: string, change: ProposedProgressionChange): string {
    return `rev${sourcePlanRevision}:${asOfDate}:${change.variable}:${change.proposedValue}`;
}
