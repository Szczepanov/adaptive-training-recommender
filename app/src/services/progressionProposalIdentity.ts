import type { ProposedProgressionChange } from '../engine/progressionReview';

/**
 * Logical identity for one reviewed bounded progression change.
 *
 * This is intentionally human-readable and bounded for Firestore. It binds the immutable
 * activation key to the source block revision, review evidence-as-of date, variable and
 * proposed value. It is not a full evidence-snapshot hash; D-REPLAY's remaining snapshot
 * gap is documented in `docs/plans/h5c-pr517-review-hardening.md`.
 */
export function deriveProgressionProposalId(
    sourceBlockRevision: number,
    reviewAsOfDate: string,
    change: ProposedProgressionChange,
): string {
    return `rev${sourceBlockRevision}:${reviewAsOfDate}:${change.variable}:${change.proposedValue}`;
}
