/**
 * Versioned policy/threshold decisions (ADR-0034 "Reconciliation evidence contract",
 * `docs/plans/training-occurrence-pr1-scope.md` reconciliation checklist). Kept separate
 * from `reconciliationScore.ts` so scoring stays a pure evidence function and threshold
 * tuning is auditable/versioned on its own (`RECONCILIATION_POLICY_VERSION`).
 */
import type { PerformedTrainingOccurrence } from './models';
import type { ReconciliationScore } from './reconciliationScore';

export const AUTO_LINK_CONFIDENCE = 0.75;
export const AMBIGUOUS_CONFIDENCE = 0.4;

export interface ScoredCandidate {
    occurrence: PerformedTrainingOccurrence;
    score: ReconciliationScore;
}

export type ReconciliationDecision =
    | { outcome: 'auto_link'; candidate: ScoredCandidate; competing: ScoredCandidate[] }
    | { outcome: 'ambiguous'; candidates: ScoredCandidate[] }
    | { outcome: 'no_match' };

/**
 * Never auto-links on date-only evidence: a top candidate must carry either explicit
 * correlation (prescription-hash match) or absolute-timestamp evidence, no matter how
 * high a date+duration-only score happens to be. A second candidate that also clears the
 * ambiguous bar forces `ambiguous` even when the top candidate alone would have cleared
 * auto-link -- "two plausible competing candidates must reduce confidence materially"
 * (ADR-0034), because a high pairwise score is not enough if the match is not unique.
 */
export function decideReconciliation(scored: readonly ScoredCandidate[]): ReconciliationDecision {
    const eligible = [...scored]
        .filter(candidate => candidate.score.confidence >= AMBIGUOUS_CONFIDENCE)
        .sort((a, b) => b.score.confidence - a.score.confidence
            || sourceRefsKey(a.occurrence).localeCompare(sourceRefsKey(b.occurrence)));

    if (eligible.length === 0) return { outcome: 'no_match' };

    const [top, runnerUp] = eligible;
    const topHasStrongEvidence = top.score.features.explicitCorrelation || top.score.features.hasAbsoluteTimestamps;
    const topClearsAutoLink = top.score.confidence >= AUTO_LINK_CONFIDENCE;
    const hasCompetingCandidate = runnerUp !== undefined && runnerUp.score.confidence >= AMBIGUOUS_CONFIDENCE;

    if (topClearsAutoLink && topHasStrongEvidence && !hasCompetingCandidate) {
        return { outcome: 'auto_link', candidate: top, competing: eligible.slice(1) };
    }
    return { outcome: 'ambiguous', candidates: eligible };
}

/** Deterministic tie-break key -- stable regardless of input ordering. */
function sourceRefsKey(occurrence: PerformedTrainingOccurrence): string {
    return occurrence.performedOccurrenceId;
}
