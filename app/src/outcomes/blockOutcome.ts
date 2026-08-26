import type { CompetitionOutcome } from '../observations/models';
import type { ProgressResult } from '../observations/progress';
import type { ClosedLoopFeedbackRecord } from '../feedback/feedbackModels';
import type { OutcomeEvaluationSnapshot, OutcomeMetricBinding } from './evaluationSpec';
import type { BlockProcessEvidence } from './blockProcessEvidence';
import { deriveFeedbackLoopEvidence, type FeedbackLoopEvidence } from './feedbackLoopEvidence';
import type { PolicySegment } from './policySegments';

export const BLOCK_VERDICT_POLICY_VERSION = 'block-adequacy-v1' as const;
export const BLOCK_ADEQUACY_V1 = {
    minKeyRoleCoveragePct: 70,
    minAdherencePct: 70,
    minResponseCoveragePctForOnTrack: 70,
} as const;

export type BlockVerdict = 'on_track' | 'mixed' | 'off_track' | 'insufficient_evidence';

export interface BlockOutcomeReport {
    evaluationRef: {
        id: string;
        revision: number;
        contentHash: string;
    };
    period: { startDate: string; endDate: string };
    metricProgress: readonly ProgressResult[];
    ecologicalOutcomes: readonly CompetitionOutcome[];
    process: BlockProcessEvidence;
    /**
     * SV4 evidence sidecar: closed-loop athlete-decision/regret/utility telemetry summarized
     * over the same window. Purely additive -- it never participates in `verdict`.
     */
    feedbackLoopEvidence: FeedbackLoopEvidence;
    verdict: BlockVerdict;
    reasons: readonly string[];
    policySegments: readonly PolicySegment[];
    blockVerdictPolicyVersion: string;
    sourceIds: {
        observationIds: readonly string[];
        sessionIds: readonly string[];
        recommendationIds: readonly string[];
        ecologicalOutcomeIds: readonly string[];
        feedbackRecordIds: readonly string[];
    };
}

export interface BlockOutcomeInput {
    evaluation: OutcomeEvaluationSnapshot;
    /**
     * Results are supplied in frozen binding order by BlockOutcomeReportService. When more
     * than one binding references the same metric, same-metric results are consumed in this
     * order so distinct windows/baselines are not collapsed into one metric-level value.
     */
    metricProgress: readonly ProgressResult[];
    ecologicalOutcomes: readonly CompetitionOutcome[];
    process: BlockProcessEvidence;
    policySegments: readonly PolicySegment[];
    /** Optional: omitted or empty when no closed-loop feedback records exist yet for this
     * window (no reader has been wired to a persistence store as of SV4). */
    feedbackRecords?: readonly ClosedLoopFeedbackRecord[];
}

function pct(numerator: number, denominator: number): number {
    if (denominator === 0) return 100;
    return 100 * numerator / denominator;
}

function compareCodeUnits(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly (string | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => value !== undefined))].sort(compareCodeUnits);
}

function sortedProgress(progress: readonly ProgressResult[]): ProgressResult[] {
    return [...progress].sort((a, b) => compareCodeUnits(a.metricId, b.metricId)
        || compareCodeUnits(a.baselineObservationId ?? '', b.baselineObservationId ?? '')
        || compareCodeUnits(a.latestObservationId ?? '', b.latestObservationId ?? ''));
}

function sortedEcologicalOutcomes(outcomes: readonly CompetitionOutcome[]): CompetitionOutcome[] {
    return [...outcomes].sort((a, b) => compareCodeUnits(a.occurredAt, b.occurredAt) || compareCodeUnits(a.id, b.id));
}

/**
 * Match once across every frozen binding rather than indexing by metric id. OutcomeEvaluation
 * permits multiple bindings for the same metric (for example different target windows), so a
 * Map<metricId, result> would silently collapse valid frozen criteria. Results with the same
 * metric are consumed in caller order; the report service guarantees that order by deriving
 * one result per evaluation binding in sequence.
 */
function matchProgressToBindings(
    bindings: readonly OutcomeMetricBinding[],
    progress: readonly ProgressResult[],
): (ProgressResult | undefined)[] {
    const remaining = [...progress];
    return bindings.map(binding => {
        const index = remaining.findIndex(result => result.metricId === binding.metricId);
        if (index < 0) return undefined;
        const [matched] = remaining.splice(index, 1);
        return matched;
    });
}

/**
 * OV5.3: versioned categorical evidence policy. It never produces a weighted score and it
 * never numerically offsets response cost against performance gain.
 */
export function deriveBlockOutcome(input: BlockOutcomeInput): BlockOutcomeReport {
    const { evaluation, process } = input;
    if (evaluation.revision.status === 'draft' || !evaluation.revision.contentHash) {
        throw new Error('Block outcome requires a frozen non-draft evaluation revision');
    }

    const matchedProgress = matchProgressToBindings(evaluation.bindings, input.metricProgress);
    const primaryResults = matchedProgress.filter((_, index) => evaluation.bindings[index]?.role === 'primary');
    const secondaryResults = matchedProgress
        .filter((_, index) => evaluation.bindings[index]?.role === 'secondary')
        .filter((result): result is ProgressResult => result !== undefined);
    const metricProgress = sortedProgress(input.metricProgress);

    const keyRoleCoveragePct = pct(process.completedKeyRoles, process.plannedKeyRoles);
    const processAdequate = keyRoleCoveragePct >= BLOCK_ADEQUACY_V1.minKeyRoleCoveragePct
        && process.adherencePct >= BLOCK_ADEQUACY_V1.minAdherencePct;
    const responseAdequateForOnTrack = process.responseCoveragePct >= BLOCK_ADEQUACY_V1.minResponseCoveragePctForOnTrack;

    const reasons: string[] = [
        `key_role_coverage_pct:${Math.round(keyRoleCoveragePct * 100) / 100}`,
        `adherence_pct:${process.adherencePct}`,
        `response_coverage_pct:${process.responseCoveragePct}`,
    ];

    const missingPrimary = primaryResults.some(result => result === undefined);
    const unusablePrimary = primaryResults.some(result =>
        result?.status === 'non_comparable'
        || result?.status === 'insufficient_evidence'
    );

    let verdict: BlockVerdict;
    if (!processAdequate || missingPrimary || unusablePrimary) {
        verdict = 'insufficient_evidence';
        if (!processAdequate) reasons.push('process_adequacy_failed');
        if (keyRoleCoveragePct < BLOCK_ADEQUACY_V1.minKeyRoleCoveragePct) reasons.push('key_role_coverage_below_policy');
        if (process.adherencePct < BLOCK_ADEQUACY_V1.minAdherencePct) reasons.push('adherence_below_policy');
        if (missingPrimary) reasons.push('declared_primary_progress_missing');
        if (unusablePrimary) reasons.push('declared_primary_progress_non_comparable_or_insufficient');
    } else {
        const concretePrimary = primaryResults as ProgressResult[];
        const primaryImprovement = concretePrimary.some(item => item.status === 'meaningful_improvement');
        const primaryDecline = concretePrimary.some(item => item.status === 'meaningful_decline');
        const secondaryDecline = secondaryResults.some(item => item.status === 'meaningful_decline');
        const repeatedReactiveResponse = process.responseCounts.reactive >= 2;

        if (!primaryImprovement && !primaryDecline) {
            verdict = 'insufficient_evidence';
            reasons.push('no_meaningful_primary_outcome');
        } else if (primaryDecline && !primaryImprovement) {
            verdict = 'off_track';
            reasons.push('meaningful_primary_decline');
        } else if (primaryDecline && primaryImprovement) {
            verdict = 'mixed';
            reasons.push('conflicting_primary_outcomes');
        } else if (secondaryDecline) {
            verdict = 'mixed';
            reasons.push('primary_improvement_with_secondary_decline');
        } else if (repeatedReactiveResponse) {
            verdict = 'mixed';
            reasons.push('primary_improvement_with_repeated_reactive_response');
        } else if (!responseAdequateForOnTrack) {
            verdict = 'mixed';
            reasons.push('positive_primary_outcome_with_low_response_coverage');
        } else {
            verdict = 'on_track';
            reasons.push('meaningful_primary_improvement');
            reasons.push('process_adequate');
            reasons.push('response_coverage_adequate');
        }
    }

    const ecologicalOutcomes = sortedEcologicalOutcomes(input.ecologicalOutcomes);
    const feedbackLoopEvidence = deriveFeedbackLoopEvidence(input.feedbackRecords ?? []);
    return {
        evaluationRef: {
            id: evaluation.revision.id,
            revision: evaluation.revision.revision,
            contentHash: evaluation.revision.contentHash,
        },
        period: { startDate: evaluation.revision.startDate, endDate: evaluation.revision.endDate },
        metricProgress,
        ecologicalOutcomes,
        process,
        feedbackLoopEvidence,
        verdict,
        reasons,
        policySegments: [...input.policySegments].sort((a, b) => compareCodeUnits(a.startDate, b.startDate)),
        blockVerdictPolicyVersion: BLOCK_VERDICT_POLICY_VERSION,
        sourceIds: {
            observationIds: uniqueSorted(metricProgress.flatMap(item => [item.baselineObservationId, item.latestObservationId])),
            sessionIds: uniqueSorted(process.sourceIds.sessionIds),
            recommendationIds: uniqueSorted(process.sourceIds.recommendationIds),
            ecologicalOutcomeIds: uniqueSorted(ecologicalOutcomes.map(item => item.id)),
            feedbackRecordIds: feedbackLoopEvidence.sourceIds.feedbackRecordIds,
        },
    };
}
