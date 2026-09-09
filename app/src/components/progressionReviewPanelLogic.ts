import type { ProposedProgressionChange } from '../engine/progressionReview';

/**
 * `evaluateProgressionReview` (H5b) returns no persisted proposal id of its own. H5c needs a
 * stable logical-confirmation id so a retry/double-tap of the same reviewed change resolves
 * to the same immutable activation document.
 *
 * This id deliberately identifies the source block revision + review date + changed variable
 * + proposed value. It is NOT an evidence-snapshot hash: two reviews re-run on the same day
 * against the same source revision/value can therefore derive the same id. Until H5 persists
 * an immutable review/evidence snapshot, activation provenance must not be described as a
 * full replay of the evidence that produced the proposal. The confirmation transaction still
 * revalidates the current block, bounded delta, review date and current restrictions.
 */
export function deriveProposalId(sourcePlanRevision: number, asOfDate: string, change: ProposedProgressionChange): string {
    return `rev${sourcePlanRevision}:${asOfDate}:${change.variable}:${change.proposedValue}`;
}
