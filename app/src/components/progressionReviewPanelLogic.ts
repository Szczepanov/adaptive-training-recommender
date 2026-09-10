import type { IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import type { ProgressionExperimentClaim } from '../services/progressionClaimService';
import { deriveProgressionProposalId } from '../services/progressionProposalIdentity';
import { SELECTION_WIRED_COVERAGE_KEYS } from '../engine/confirmedProgressionOverrides';

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

/**
 * ADR-0037 D-DOSE: whether the objective a block's progression contract targets has a
 * coverage key evergreen selection actually wires up yet
 * (`engine/confirmedProgressionOverrides.ts`). A review can still run and a change can
 * still be confirmed and recorded either way; this only drives a visible, non-blocking
 * notice rather than a silent gap.
 */
export function isProgressionSelectionUnsupported(block: IntentBlock | null | undefined): boolean {
    const contract = block?.progressionContract;
    if (!contract) return false;
    const objective = block.objectives.find(item => item.id === contract.targetBinding.objectiveId);
    return objective ? !SELECTION_WIRED_COVERAGE_KEYS.includes(objective.coverageKey) : false;
}
