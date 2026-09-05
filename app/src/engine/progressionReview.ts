/**
 * ADR-0037: Block Intent and Controlled Progression (H5b).
 *
 * Pure, report-only progression review. This module has no selection authority. It consumes
 * already-linked canonical occurrence/coverage/prescription/response evidence and returns a
 * frozen proposal/hold/reduce/redirect result. It never infers linkage from modality alone.
 */

import type { ProgressResult } from '../observations/progress';
import type { SessionOutcome } from '../responses/outcome';
import type { CoverageCreditFact, PerformedExposureFact } from './performedTrainingFacts';
import type {
    BlockProgressionContract,
    IntentBlock,
    TissueSeverity,
} from './blockIntent';
import { isValidLocalDateString, validateIntentBlock } from './blockIntent';

export type ProgressionReviewAction = 'advance_proposal' | 'hold' | 'reduce_proposal' | 'redirect';

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
    derivedDoseEffects: {
        delta: number;
    };
}

export interface ProgressionEvidenceAudit {
    windowStartDate?: string;
    windowEndDate?: string;
    candidateExposureCount: number;
    exposuresObserved: number;
    excludedExposureCount: number;
    exposuresRequired: number;
    followUpCoveragePct: number;
    requiredFollowUpCoveragePct: number;
    missingFollowUpCount: number;
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

export type ProgressionPrescriptionMatch = 'matched_current_target' | 'partial' | 'mismatch' | 'unknown';

/**
 * One canonical occurrence with all evidence already linked to that occurrence. The caller
 * owns construction of this join from canonical stores; the evaluator verifies occurrence
 * ids/coverage and refuses to infer identity from dates or modality.
 */
export interface LinkedProgressionExposureEvidence {
    exposure: PerformedExposureFact;
    coverageCredits: readonly CoverageCreditFact[];
    prescription: {
        status: ProgressionPrescriptionMatch;
        definitionId?: string;
        revision?: number;
        stepId?: string;
    };
    outcome?: SessionOutcome;
}

/** Progress output frozen against the exact authored evaluation reference. */
export interface BoundProgressEvidence {
    evaluationRef: {
        id: string;
        revision: number;
        metricId: string;
    };
    result: ProgressResult;
}

export interface ProgressionPrerequisiteEvidence {
    priorComparableExposures?: number;
    baselineDays?: number;
    observedTissueSeverities?: readonly TissueSeverity[];
}

export interface ProgressionReviewInput {
    intentBlock: IntentBlock;
    asOfDate: string;
    linkedExposures: readonly LinkedProgressionExposureEvidence[];
    boundProgressResults?: readonly BoundProgressEvidence[];
    prerequisiteEvidence?: ProgressionPrerequisiteEvidence;
    activeRestrictions?: {
        hasAdverseTissue: boolean;
        prohibitedRegions?: readonly string[];
    };
}

function addCalendarDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const instant = new Date(Date.UTC(year, month - 1, day + days));
    return `${instant.getUTCFullYear()}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}-${String(instant.getUTCDate()).padStart(2, '0')}`;
}

function calendarDaysInclusive(startDate: string, endDate: string): number {
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    const start = Date.UTC(startYear, startMonth - 1, startDay);
    const end = Date.UTC(endYear, endMonth - 1, endDay);
    return Math.floor((end - start) / 86_400_000) + 1;
}

function emptyAudit(contract?: BlockProgressionContract): ProgressionEvidenceAudit {
    return {
        candidateExposureCount: 0,
        exposuresObserved: 0,
        excludedExposureCount: 0,
        exposuresRequired: contract?.minCompletedExposures ?? 0,
        followUpCoveragePct: 0,
        requiredFollowUpCoveragePct: contract?.requiredFollowUpCoveragePct ?? 0,
        missingFollowUpCount: 0,
        adverseResponseCount: 0,
        cautionResponseCount: 0,
    };
}

function result(
    action: ProgressionReviewAction,
    reasons: readonly string[],
    input: ProgressionReviewInput,
    evidenceAudit: ProgressionEvidenceAudit,
    proposedChange?: ProposedProgressionChange,
): ProgressionReviewResult {
    return {
        action,
        reasons,
        ...(proposedChange ? { proposedChange } : {}),
        evidenceAudit,
        asOfDate: input.asOfDate,
        blockId: input.intentBlock.id,
        ...(input.intentBlock.progressionContract
            ? { contractVariable: input.intentBlock.progressionContract.variable }
            : {}),
    };
}

function exactCoverageMatches(
    evidence: LinkedProgressionExposureEvidence,
    coverageKey: string,
): boolean {
    return evidence.coverageCredits.some(credit =>
        credit.performedOccurrenceId === evidence.exposure.performedOccurrenceId
        && credit.coverageKey === coverageKey
        && credit.creditKind === 'exact',
    );
}

function prescriptionMatchesTarget(
    evidence: LinkedProgressionExposureEvidence,
    contract: BlockProgressionContract,
): boolean {
    if (evidence.prescription.status !== 'matched_current_target') return false;
    if (contract.targetBinding.sessionId !== undefined
        && evidence.prescription.definitionId !== contract.targetBinding.sessionId) return false;
    if (contract.targetBinding.stepId !== undefined
        && evidence.prescription.stepId !== contract.targetBinding.stepId) return false;
    return true;
}

function boundProgressFor(
    evidence: readonly BoundProgressEvidence[],
    evaluationRef: { id: string; revision: number; metricId: string },
): ProgressResult | undefined {
    return evidence.find(item =>
        item.evaluationRef.id === evaluationRef.id
        && item.evaluationRef.revision === evaluationRef.revision
        && item.evaluationRef.metricId === evaluationRef.metricId
        && item.result.metricId === evaluationRef.metricId,
    )?.result;
}

function redirectTrigger(contract: BlockProgressionContract, trigger: 'adverse_response' | 'active_restriction'): boolean {
    return contract.redirectCriteria?.triggers.includes(trigger) === true;
}

function evaluatePrerequisites(
    input: ProgressionReviewInput,
    targetObjective: IntentBlock['objectives'][number],
): string[] {
    const prerequisites = targetObjective.entryPrerequisites;
    if (!prerequisites) return [];
    const evidence = input.prerequisiteEvidence;
    const reasons: string[] = [];

    if (prerequisites.requiredPriorExposures !== undefined) {
        if (evidence?.priorComparableExposures === undefined) {
            reasons.push('required_prior_exposure_evidence_missing');
        } else if (evidence.priorComparableExposures < prerequisites.requiredPriorExposures) {
            reasons.push(`insufficient_prior_exposures: observed ${evidence.priorComparableExposures} < required ${prerequisites.requiredPriorExposures}`);
        }
    }
    if (prerequisites.minBaselineDays !== undefined) {
        if (evidence?.baselineDays === undefined) {
            reasons.push('required_baseline_duration_evidence_missing');
        } else if (evidence.baselineDays < prerequisites.minBaselineDays) {
            reasons.push(`insufficient_baseline_days: observed ${evidence.baselineDays} < required ${prerequisites.minBaselineDays}`);
        }
    }
    if (prerequisites.prohibitedTissueSeverities?.length) {
        if (!evidence?.observedTissueSeverities) {
            reasons.push('required_tissue_prerequisite_evidence_missing');
        } else {
            const prohibited = evidence.observedTissueSeverities.find(severity =>
                prerequisites.prohibitedTissueSeverities?.includes(severity),
            );
            if (prohibited) reasons.push(`prohibited_tissue_severity_present: ${prohibited}`);
        }
    }
    return reasons;
}

function outcomeSatisfiesTargetTrend(
    progress: ProgressResult,
    targetTrend: 'stable' | 'improving' | undefined,
    acceptableDeclineTolerancePct: number | undefined,
): { passes: boolean; reason?: string } {
    if (targetTrend === undefined) return { passes: true };
    if (targetTrend === 'improving') {
        return progress.status === 'meaningful_improvement' || progress.status === 'possible_improvement'
            ? { passes: true }
            : { passes: false, reason: `bound_outcome_not_improving: status ${progress.status}` };
    }

    if (progress.status === 'meaningful_improvement' || progress.status === 'possible_improvement') {
        return { passes: true };
    }
    if (acceptableDeclineTolerancePct === undefined || progress.percentChange === undefined) {
        return { passes: false, reason: 'stable_target_missing_comparable_decline_tolerance_evidence' };
    }
    if (Math.abs(progress.percentChange) <= acceptableDeclineTolerancePct) {
        return { passes: true };
    }
    return {
        passes: false,
        reason: `stable_target_outside_tolerance: |${progress.percentChange}%| > ${acceptableDeclineTolerancePct}%`,
    };
}

/** Derives a pure report-only review from frozen linked evidence. */
export function evaluateProgressionReview(input: ProgressionReviewInput): ProgressionReviewResult {
    const contract = input.intentBlock.progressionContract;
    const initialAudit = emptyAudit(contract);

    if (!isValidLocalDateString(input.asOfDate)) {
        return result('hold', ['invalid_review_as_of_date'], input, initialAudit);
    }

    const validation = validateIntentBlock(input.intentBlock);
    if (!validation.valid) {
        return result(
            'hold',
            ['invalid_intent_block', ...validation.issues.map(issue => `validation:${issue.code}`)],
            input,
            initialAudit,
        );
    }

    if (!contract) {
        return result('hold', ['no_progression_contract_defined'], input, initialAudit);
    }

    const targetObjective = input.intentBlock.objectives.find(objective =>
        objective.id === contract.targetBinding.objectiveId,
    );
    if (!targetObjective) {
        return result('hold', ['target_objective_not_found'], input, initialAudit);
    }

    if (input.asOfDate < input.intentBlock.dateRange.startDate) {
        return result('hold', ['review_before_block_start'], input, initialAudit);
    }
    if (input.asOfDate < input.intentBlock.reviewSchedule.nextReviewDate) {
        return result(
            'hold',
            [`review_cadence_not_reached: asOfDate ${input.asOfDate} < nextReviewDate ${input.intentBlock.reviewSchedule.nextReviewDate}`],
            input,
            initialAudit,
        );
    }

    const prerequisiteReasons = evaluatePrerequisites(input, targetObjective);
    if (prerequisiteReasons.length > 0) {
        return result('hold', prerequisiteReasons, input, initialAudit);
    }

    const elapsedDays = calendarDaysInclusive(input.intentBlock.dateRange.startDate, input.asOfDate);
    if (targetObjective.exitCriteria?.maxWeeksInBlock !== undefined
        && elapsedDays > targetObjective.exitCriteria.maxWeeksInBlock * 7) {
        return result(
            'redirect',
            [`max_block_duration_exit_reached: ${elapsedDays} days > ${targetObjective.exitCriteria.maxWeeksInBlock * 7}`],
            input,
            initialAudit,
        );
    }

    if (input.activeRestrictions?.hasAdverseTissue) {
        const audit = { ...initialAudit, adverseResponseCount: 1 };
        if (redirectTrigger(contract, 'active_restriction')) {
            return result('redirect', ['active_restriction_triggers_redirect'], input, audit);
        }
        return result('hold', ['active_restriction_blocks_advancement'], input, audit);
    }

    const rawWindowStart = addCalendarDays(input.asOfDate, -(contract.observationWindowDays - 1));
    const windowStartDate = rawWindowStart > input.intentBlock.dateRange.startDate
        ? rawWindowStart
        : input.intentBlock.dateRange.startDate;
    const windowEndDate = input.asOfDate < input.intentBlock.dateRange.endDate
        ? input.asOfDate
        : input.intentBlock.dateRange.endDate;

    const canonicalByOccurrence = new Map<string, LinkedProgressionExposureEvidence>();
    for (const evidence of input.linkedExposures) {
        const occurrenceId = evidence.exposure.performedOccurrenceId;
        if (!occurrenceId) continue;
        if (evidence.exposure.localDate < windowStartDate || evidence.exposure.localDate > windowEndDate) continue;
        if (!canonicalByOccurrence.has(occurrenceId)) canonicalByOccurrence.set(occurrenceId, evidence);
    }

    const candidates = [...canonicalByOccurrence.values()];
    const matchingExposures = candidates.filter(evidence =>
        exactCoverageMatches(evidence, targetObjective.coverageKey)
        && prescriptionMatchesTarget(evidence, contract),
    );

    const exposuresRequired = Math.max(
        contract.minCompletedExposures,
        targetObjective.successCriteria?.minCompletedExposures ?? 0,
    );

    let completedWithFollowUp = 0;
    let adverseCount = 0;
    let cautionCount = 0;
    for (const evidence of matchingExposures) {
        if (evidence.outcome?.hasFollowUpData) completedWithFollowUp++;
        if (evidence.outcome?.status === 'reactive') adverseCount++;
        if (evidence.outcome?.status === 'caution') cautionCount++;
    }

    const followUpCoveragePct = matchingExposures.length > 0
        ? Math.min(100, Math.round((completedWithFollowUp / matchingExposures.length) * 100))
        : 0;
    const evidenceAudit: ProgressionEvidenceAudit = {
        windowStartDate,
        windowEndDate,
        candidateExposureCount: candidates.length,
        exposuresObserved: matchingExposures.length,
        excludedExposureCount: candidates.length - matchingExposures.length,
        exposuresRequired,
        followUpCoveragePct,
        requiredFollowUpCoveragePct: contract.requiredFollowUpCoveragePct,
        missingFollowUpCount: matchingExposures.length - completedWithFollowUp,
        adverseResponseCount: adverseCount,
        cautionResponseCount: cautionCount,
    };

    const evaluationRef = targetObjective.successCriteria?.evaluationRef;
    const boundProgress = evaluationRef
        ? boundProgressFor(input.boundProgressResults ?? [], evaluationRef)
        : undefined;
    if (evaluationRef && boundProgress) {
        evidenceAudit.outcomeMetricEvaluated = boundProgress.metricId;
        evidenceAudit.outcomeTrend = boundProgress.status;
    }

    // Safety-monotonic evidence always wins over favorable outcomes.
    if (adverseCount > 0) {
        if (redirectTrigger(contract, 'adverse_response')) {
            return result(
                'redirect',
                [`adverse_response_triggers_redirect: ${adverseCount} reactive outcome(s)`],
                input,
                evidenceAudit,
            );
        }
        if (contract.reductionAlternative?.trigger === 'adverse_response') {
            const proposedValue = contract.currentValue - contract.reductionAlternative.decrement;
            return result(
                'reduce_proposal',
                [`adverse_response_triggers_reduction: ${adverseCount} reactive outcome(s)`],
                input,
                evidenceAudit,
                {
                    targetBinding: contract.targetBinding,
                    variable: contract.variable,
                    unit: contract.unit,
                    previousValue: contract.currentValue,
                    proposedValue,
                    derivedDoseEffects: { delta: proposedValue - contract.currentValue },
                },
            );
        }
        return result(
            'hold',
            [`adverse_safety_response_blocks_advancement: ${adverseCount} reactive outcome(s)`],
            input,
            evidenceAudit,
        );
    }

    if (cautionCount > 0) {
        return result(
            'hold',
            [`cautionary_tissue_response_blocks_advancement: ${cautionCount} caution outcome(s)`],
            input,
            evidenceAudit,
        );
    }

    if (matchingExposures.length < exposuresRequired) {
        return result(
            'hold',
            [`insufficient_completed_exposures: observed ${matchingExposures.length} < required ${exposuresRequired}`],
            input,
            evidenceAudit,
        );
    }

    if (followUpCoveragePct < contract.requiredFollowUpCoveragePct) {
        return result(
            'hold',
            [`insufficient_followup_evidence: coverage ${followUpCoveragePct}% < required ${contract.requiredFollowUpCoveragePct}%`],
            input,
            evidenceAudit,
        );
    }

    if (contract.currentValue >= contract.permittedRange.max) {
        return result(
            'hold',
            [`max_permitted_value_reached: currentValue ${contract.currentValue} >= max ${contract.permittedRange.max}`],
            input,
            evidenceAudit,
        );
    }

    if (evaluationRef) {
        if (!boundProgress) {
            return result(
                'hold',
                [`bound_outcome_metric_missing: no frozen progress result for ${evaluationRef.id}@${evaluationRef.revision}/${evaluationRef.metricId}`],
                input,
                evidenceAudit,
            );
        }
        if (!boundProgress.comparable || boundProgress.status === 'non_comparable' || boundProgress.status === 'insufficient_evidence') {
            return result(
                'hold',
                [`bound_outcome_metric_non_comparable: ${evaluationRef.metricId} has status ${boundProgress.status}`],
                input,
                evidenceAudit,
            );
        }

        const trend = outcomeSatisfiesTargetTrend(
            boundProgress,
            targetObjective.successCriteria?.targetTrend,
            targetObjective.successCriteria?.acceptableDeclineTolerancePct,
        );
        if (!trend.passes) {
            const stagnationWeeks = targetObjective.exitCriteria?.stagnationReviewAfterWeeks;
            if (
                targetObjective.intent === 'develop'
                && stagnationWeeks !== undefined
                && elapsedDays > stagnationWeeks * 7
            ) {
                return result(
                    'redirect',
                    [`stagnation_review_due_after_${stagnationWeeks}_weeks`, ...(trend.reason ? [trend.reason] : [])],
                    input,
                    evidenceAudit,
                );
            }
            return result('hold', [trend.reason ?? 'bound_outcome_target_not_satisfied'], input, evidenceAudit);
        }
    }

    const proposedValue = Math.min(contract.permittedRange.max, contract.currentValue + contract.increment);
    return result(
        'advance_proposal',
        ['all_progression_prerequisites_and_evidence_criteria_satisfied'],
        input,
        evidenceAudit,
        {
            targetBinding: contract.targetBinding,
            variable: contract.variable,
            unit: contract.unit,
            previousValue: contract.currentValue,
            proposedValue,
            derivedDoseEffects: { delta: proposedValue - contract.currentValue },
        },
    );
}
