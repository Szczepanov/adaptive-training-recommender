import type { ProposedProgressionChange } from '../engine/progressionReview';
import { deriveProgressionProposalId } from '../services/progressionProposalIdentity';

/** UI-facing alias retained so the panel/tests stay decoupled from persistence naming. */
export function deriveProposalId(sourcePlanRevision: number, asOfDate: string, change: ProposedProgressionChange): string {
    return deriveProgressionProposalId(sourcePlanRevision, asOfDate, change);
}
