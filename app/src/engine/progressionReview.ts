/**
 * ADR-0037: Block Intent and Controlled Progression (H5b).
 *
 * D-CHANGE / D-AUTHORITY: Pure report-only progression review evaluator.
 * Evaluates canonical completed work, follow-up responses, and outcome evidence
 * against explicit progression contracts, deriving one of:
 * - advance_proposal
 * - hold
 * - reduce_proposal
 * - redirect
 *
 * Enforces safety monotonicity: adverse or missing follow-up evidence strictly
 * blocks advancement, regardless of favorable outcome metrics.
 */

import type { SessionOutcome } from '../responses/outcome';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type { ProgressResult } from '../observations/progress';
import type { TrainingIntentProfile } from './models';
import type { BlockProgressionContract, IntentBlock } from './blockIntent';

export type ProgressionReviewAction =
    | 'advance_proposal'
    | 'hold'
    | 'reduce_proposal'
    | 'redirect';

export interface ProposedProgressionChange {
    targetBinding: {
        objectiveId: string;
        sessionId?: string;
        stepId?: string;
    };
    variable: string;
    unit: string;
    previousValue: number;
    proposedValue: number;
    derivedDoseEffects?: Record<string, number>;
}

export interface ProgressionEvidenceAudit {
    exposuresObserved: number;
    exposuresRequired: number;
    followUpCoveragePct: number;
    requiredFollowUpCoveragePct: number;
    adverseResponseCount: number;
    cautionResponseCount: number;
    outcomeMetricEvaluated?: string;
    outcomeTrend?: string;
}

export interface ProgressionReviewResult {
    action: ProgressionReviewAction;
    reasons: readonly string[];
    proposedChange?: ProposedProgressionChange;
    evidenceAudit: ProgressionEvidenceAudit;
    asOfDate: string;
    blockId: string;
    contractVariable?: string;
}

export interface ProgressionReviewInput {
    intentBlock: IntentBlock;
    trainingIntentProfile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'>;
    asOfDate: string;
    /** Completed exposure facts in the relevant historical window */
    completedExposures: readonly PerformedExposureFact[];
    /** Linked session outcomes for completed work */
    sessionOutcomes: readonly SessionOutcome[];
    /** Bound metric progress results from performance testing/observations, if any */
    progressResults?: readonly ProgressResult[];
    /** Current active restrictions or adverse tissue signals */
    activeRestrictions?: {
        hasAdverseTissue: boolean;
        prohibitedRegions?: readonly string[];
    };
}

/**
 * Derives a pure progression review decision from input evidence.
 */
export function evaluateProgressionReview(input: ProgressionReviewInput): ProgressionReviewResult {
    const {
        intentBlock,
        asOfDate,
        completedExposures,
        sessionOutcomes,
        progressResults = [],
        activeRestrictions,
    } = input;

    const contract: BlockProgressionContract | undefined = intentBlock.progressionContract;

    // Default empty evidence audit
    const emptyAudit: ProgressionEvidenceAudit = {
        exposuresObserved: 0,
        exposuresRequired: contract ? contract.minCompletedExposures : 0,
        followUpCoveragePct: 0,
        requiredFollowUpCoveragePct: contract ? contract.requiredFollowUpCoveragePct : 0,
        adverseResponseCount: 0,
        cautionResponseCount: 0,
    };

    // 1. Contract existence gate
    if (!contract) {
        return {
            action: 'hold',
            reasons: ['no_progression_contract_defined'],
            evidenceAudit: emptyAudit,
            asOfDate,
            blockId: intentBlock.id,
        };
    }

    // 2. Find matching target objective
    const targetObj = intentBlock.objectives.find(o => o.id === contract.targetBinding.objectiveId);
    if (!targetObj) {
        return {
            action: 'hold',
            reasons: ['target_objective_not_found'],
            evidenceAudit: emptyAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 3. Cadence timing check
    if (intentBlock.reviewSchedule && asOfDate < intentBlock.reviewSchedule.nextReviewDate) {
        return {
            action: 'hold',
            reasons: [`review_cadence_not_reached: asOfDate ${asOfDate} < nextReviewDate ${intentBlock.reviewSchedule.nextReviewDate}`],
            evidenceAudit: emptyAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 4. Filter completed exposures relevant to this target within the observation window
    const windowExposures = completedExposures.filter(exp => {
        if (exp.localDate > asOfDate) return false;
        if (targetObj.sport === 'cycling' && exp.modality !== 'Cycling') return false;
        if (targetObj.sport === 'strength' && exp.modality !== 'Strength') return false;
        if (targetObj.sport === 'running' && exp.modality !== 'Running') return false;
        return true;
    });

    const exposuresObserved = windowExposures.length;

    // 5. Match session outcomes for window exposures
    let completedWithFollowUp = 0;
    let adverseCount = 0;
    let cautionCount = 0;

    for (const outcome of sessionOutcomes) {
        if (outcome.hasFollowUpData) {
            completedWithFollowUp++;
        }
        if (outcome.status === 'reactive') {
            adverseCount++;
        } else if (outcome.status === 'caution') {
            cautionCount++;
        }
    }

    // Also consider active restrictions as adverse tissue signal
    if (activeRestrictions?.hasAdverseTissue) {
        adverseCount++;
    }

    const followUpCoveragePct = exposuresObserved > 0
        ? Math.min(100, Math.round((completedWithFollowUp / exposuresObserved) * 100))
        : 0;

    const evidenceAudit: ProgressionEvidenceAudit = {
        exposuresObserved,
        exposuresRequired: contract.minCompletedExposures,
        followUpCoveragePct,
        requiredFollowUpCoveragePct: contract.requiredFollowUpCoveragePct,
        adverseResponseCount: adverseCount,
        cautionResponseCount: cautionCount,
    };

    // Check outcome evaluation progress if specified in objective success criteria
    if (targetObj.successCriteria?.evaluationRef) {
        const matchingProgress = progressResults.find(
            p => p.metricId === targetObj.successCriteria?.evaluationRef?.metricId,
        );
        if (matchingProgress) {
            evidenceAudit.outcomeMetricEvaluated = matchingProgress.metricId;
            evidenceAudit.outcomeTrend = matchingProgress.status;
        }
    }

    // 6. Hard safety & adverse response check (Takes strict precedence over advancement!)
    if (adverseCount > 0) {
        if (adverseCount >= 2 || (activeRestrictions && activeRestrictions.hasAdverseTissue)) {
            return {
                action: 'redirect',
                reasons: [`adverse_safety_response_detected: ${adverseCount} adverse signals`],
                evidenceAudit,
                asOfDate,
                blockId: intentBlock.id,
                contractVariable: contract.variable,
            };
        }

        if (contract.reductionAlternative) {
            const reducedVal = Math.max(
                contract.permittedRange.min,
                contract.currentValue - contract.reductionAlternative.decrement,
            );
            return {
                action: 'reduce_proposal',
                reasons: [`adverse_response_triggers_reduction: ${adverseCount} adverse signal(s)`],
                proposedChange: {
                    targetBinding: contract.targetBinding,
                    variable: contract.variable,
                    unit: contract.unit,
                    previousValue: contract.currentValue,
                    proposedValue: reducedVal,
                },
                evidenceAudit,
                asOfDate,
                blockId: intentBlock.id,
                contractVariable: contract.variable,
            };
        }

        return {
            action: 'hold',
            reasons: [`adverse_safety_response_blocks_advancement: ${adverseCount} reactive outcome(s)`],
            evidenceAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    if (cautionCount > 0) {
        return {
            action: 'hold',
            reasons: [`cautionary_tissue_response_blocks_advancement: ${cautionCount} caution outcome(s)`],
            evidenceAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 7. Exposure quantity check
    if (exposuresObserved < contract.minCompletedExposures) {
        return {
            action: 'hold',
            reasons: [`insufficient_completed_exposures: observed ${exposuresObserved} < required ${contract.minCompletedExposures}`],
            evidenceAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 8. Follow-up coverage check
    if (followUpCoveragePct < contract.requiredFollowUpCoveragePct) {
        return {
            action: 'hold',
            reasons: [`insufficient_followup_evidence: coverage ${followUpCoveragePct}% < required ${contract.requiredFollowUpCoveragePct}%`],
            evidenceAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 9. Boundary-at-maximum check
    if (contract.currentValue >= contract.permittedRange.max) {
        return {
            action: 'hold',
            reasons: [`max_permitted_value_reached: currentValue ${contract.currentValue} >= max ${contract.permittedRange.max}`],
            evidenceAudit,
            asOfDate,
            blockId: intentBlock.id,
            contractVariable: contract.variable,
        };
    }

    // 10. Outcome metric check (if specified)
    if (targetObj.successCriteria?.evaluationRef) {
        const metricId = targetObj.successCriteria.evaluationRef.metricId;
        const matchingProgress = progressResults.find(p => p.metricId === metricId);
        if (!matchingProgress) {
            return {
                action: 'hold',
                reasons: [`bound_outcome_metric_missing: no progress result for ${metricId}`],
                evidenceAudit,
                asOfDate,
                blockId: intentBlock.id,
                contractVariable: contract.variable,
            };
        }
        if (!matchingProgress.comparable || matchingProgress.status === 'non_comparable') {
            return {
                action: 'hold',
                reasons: [`bound_outcome_metric_non_comparable: ${metricId} is non-comparable`],
                evidenceAudit,
                asOfDate,
                blockId: intentBlock.id,
                contractVariable: contract.variable,
            };
        }
        if (matchingProgress.status === 'meaningful_decline' || matchingProgress.status === 'possible_decline') {
            return {
                action: 'hold',
                reasons: [`bound_outcome_metric_declining: ${metricId} has status ${matchingProgress.status}`],
                evidenceAudit,
                asOfDate,
                blockId: intentBlock.id,
                contractVariable: contract.variable,
            };
        }
    }

    // 11. All criteria met: advance proposal with bounded increment
    const proposedValue = Math.min(contract.permittedRange.max, contract.currentValue + contract.increment);

    return {
        action: 'advance_proposal',
        reasons: ['all_progression_prerequisites_and_evidence_criteria_satisfied'],
        proposedChange: {
            targetBinding: contract.targetBinding,
            variable: contract.variable,
            unit: contract.unit,
            previousValue: contract.currentValue,
            proposedValue,
        },
        evidenceAudit,
        asOfDate,
        blockId: intentBlock.id,
        contractVariable: contract.variable,
    };
}
