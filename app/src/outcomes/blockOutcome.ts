import type { CompetitionOutcome } from '../observations/models';
import type { ProgressResult } from '../observations/progress';
import type { OutcomeEvaluationSnapshot } from './evaluationSpec';
import type { BlockProcessEvidence } from './blockProcessEvidence';
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
    verdict: BlockVerdict;
    reasons: readonly string[];
    policySegments: readonly PolicySegment[];
    blockVerdictPolicyVersion: string;
    sourceIds: {
        observationIds: readonly string[];
        sessionIds: readonly string[];
        recommendationIds: readonly string[];
        ecologicalOutcomeIds: readonly string[];
    };
}

export interface BlockOutcomeInput {
    evaluation: OutcomeEvaluationSnapshot;
    metricProgress: readonly ProgressResult[];
    ecologicalOutcomes: readonly CompetitionOutcome[];
    process: BlockProcessEvidence;
    policySegments: readonly PolicySegment[];
}

function pct(numerator: number, denominator: number): number {
    if (denominator === 0) return 100;
    return 100 * numerator / denominator;
}

function uniqueSorted(values: readonly (string | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => value !== undefined))].sort();
}

function sortedProgress(progress: readonly ProgressResult[]): ProgressResult[] {
    return [...progress].sort((a, b) => a.metricId.localeCompare(b.metricId)
        || (a.baselineObservationId ?? '').localeCompare(b.baselineObservationId ?? '')
        || (a.latestObservationId ?? '').localeCompare(b.latestObservationId ?? ''));
}

function sortedEcologicalOutcomes(outcomes: readonly CompetitionOutcome[]): CompetitionOutcome[] {
    return [...outcomes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
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

    const metricProgress = sortedProgress(input.metricProgress);
    const progressByMetric = new Map(metricProgress.map(item => [item.metricId, item]));
    const primaryBindings = evaluation.bindings.filter(binding => binding.role === 'primary');
    const secondaryBindings = evaluation.bindings.filter(binding => binding.role === 'secondary');
    const primaryResults = primaryBindings.map(binding => progressByMetric.get(binding.metricId));
    const secondaryResults = secondaryBindings.map(binding => progressByMetric.get(binding.metricId)).filter(Boolean) as ProgressResult[];

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
        result === undefined
        || result.status === 'non_comparable'
        || result.status === 'insufficient_evidence'
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
        verdict,
        reasons,
        policySegments: [...input.policySegments].sort((a, b) => a.startDate.localeCompare(b.startDate)),
        blockVerdictPolicyVersion: BLOCK_VERDICT_POLICY_VERSION,
        sourceIds: {
            observationIds: uniqueSorted(metricProgress.flatMap(item => [item.baselineObservationId, item.latestObservationId])),
            sessionIds: uniqueSorted(process.sourceIds.sessionIds),
            recommendationIds: uniqueSorted(process.sourceIds.recommendationIds),
            ecologicalOutcomeIds: uniqueSorted(ecologicalOutcomes.map(item => item.id)),
        },
    };
}
