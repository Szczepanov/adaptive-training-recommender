import type { ProposedProgressionChange } from '../engine/progressionReview';
import type { ProgressionExperimentClaim } from '../services/progressionClaimService';
import { deriveProgressionProposalId } from '../services/progressionProposalIdentity';

/** UI-facing alias retained so the panel/tests stay decoupled from persistence naming. */
export function deriveProposalId(sourcePlanRevision: number, asOfDate: string, change: ProposedProgressionChange): string {
    return deriveProgressionProposalId(sourcePlanRevision, asOfDate, change);
}

/**
 * A held claim may be completed from the review surface only when the review is for the
 * exact authored revision that the claim activated. This prevents a stale review tab or a
 * different block from releasing the athlete-wide singleton slot.
 */
export function claimBelongsToReviewedRevision(
    claim: ProgressionExperimentClaim | null,
    blockId: string | null,
    revision: number | null,
): boolean {
    return claim?.state === 'held'
        && blockId !== null
        && revision !== null
        && claim.blockId === blockId
        && claim.activationRevisionId === String(revision);
}
