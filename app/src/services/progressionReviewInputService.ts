/**
 * ADR-0037 H5c review-input assembly.
 *
 * This boundary joins canonical performed occurrences, exact coverage, immutable execution
 * prescriptions, outcomes, check-ins and active constraints. It deliberately fails closed:
 * performed duration or modality/coverage alone can never manufacture the prescription
 * identity that H5b's `prescriptionMatchesTarget` gate requires.
 */

import { addDaysToLocalDateString } from '../utils/localDate';
import type { IntentBlock, BlockObjectiveDefinition } from '../engine/blockIntent';
import { deriveTissueSeverity } from '../engine/injuryPolicy';
import type {
    LinkedProgressionExposureEvidence,
    ProgressionPrerequisiteEvidence,
    ProgressionPrescriptionMatch,
    ProgressionReviewInput,
} from '../engine/progressionReview';
import type { PerformedExposureFact, CoverageCreditFact } from '../engine/performedTrainingFacts';
import { getPerformedTrainingFactsInRange } from '../training-occurrence/performedTrainingFactsService';
import { performedTrainingOccurrenceRepository } from '../training-occurrence/repository';
import { isStructuredExecutionRef } from '../training-occurrence/models';
import { sessionOutcomeReportService } from './sessionOutcomeReportService';
import { sessionExecutionService } from './sessionExecutionService';
import { executionPrescriptionService } from './executionPrescriptionService';
import { checkinService } from './checkinService';
import { trainingSettingsService } from './trainingSettingsService';
import type { SessionOutcome } from '../responses/outcome';
import type { ExecutionPrescription, SessionExecution, SessionSourceRef } from '../sessions/models';

const DURATION_MATCH_TOLERANCE_FRACTION = 0.15;

interface StructuredReviewEvidence {
    executionId: string;
    execution?: SessionExecution;
    prescription?: ExecutionPrescription;
}

function objectivesById(block: IntentBlock): Map<string, BlockObjectiveDefinition> {
    return new Map(block.objectives.map(objective => [objective.id, objective]));
}

async function resolveStructuredReviewEvidence(
    userId: string,
    performedOccurrenceId: string,
): Promise<StructuredReviewEvidence | null> {
    const occurrence = await performedTrainingOccurrenceRepository.getById(userId, performedOccurrenceId);
    if (!occurrence) return null;
    const executionRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
    if (!executionRef) return null;

    const result: StructuredReviewEvidence = { executionId: executionRef.executionId };
    const executionState = await sessionExecutionService.getExecution(userId, executionRef.executionId);
    if (executionState.status !== 'AVAILABLE') return result;
    result.execution = executionState.data;

    const prescriptionHash = executionState.data.prescriptionHash ?? executionRef.prescriptionHash;
    if (!prescriptionHash) return result;
    const prescriptionState = await executionPrescriptionService.getPrescription(userId, prescriptionHash);
    if (prescriptionState.status === 'AVAILABLE') result.prescription = prescriptionState.data;
    return result;
}

function sameSessionSource(left: SessionSourceRef, right: SessionSourceRef): boolean {
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
        case 'external_plan':
            return right.kind === 'external_plan'
                && left.planId === right.planId
                && left.revision === right.revision
                && left.sessionId === right.sessionId
                && left.contentHash === right.contentHash;
        case 'manual':
            return right.kind === 'manual'
                && left.definitionId === right.definitionId
                && left.revision === right.revision
                && left.contentHash === right.contentHash;
        case 'catalog':
            return right.kind === 'catalog'
                && left.workoutId === right.workoutId
                && left.catalogVersion === right.catalogVersion;
        case 'unplanned_fixture':
            return right.kind === 'unplanned_fixture' && left.fixtureId === right.fixtureId;
    }
}

function sourceRevision(source: SessionSourceRef | undefined): number {
    if (!source) return 0;
    if (source.kind === 'external_plan' || source.kind === 'manual') return source.revision;
    return 0;
}

function sourceMatchesBlock(
    block: IntentBlock,
    source: SessionSourceRef | undefined,
    contract: NonNullable<IntentBlock['progressionContract']>,
): boolean {
    if (!source) return false;
    if (source.kind === 'external_plan') {
        return source.planId === block.sourcePlanId
            && source.revision === block.sourcePlanRevision
            && (contract.targetBinding.sessionId === undefined
                || source.sessionId === contract.targetBinding.sessionId);
    }
    if (source.kind === 'manual') {
        return contract.targetBinding.sessionId === undefined
            && source.definitionId === block.sourcePlanId
            && source.revision === block.sourcePlanRevision;
    }
    return false;
}

function exactNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') return undefined;
    const range = value as { min?: unknown; max?: unknown };
    return typeof range.min === 'number'
        && typeof range.max === 'number'
        && Number.isFinite(range.min)
        && range.min === range.max
        ? range.min
        : undefined;
}

/** H5 currently registers only `duration_min`. Read that value from the immutable execution
 * prescription, not from performed duration. A ranged prescription is deliberately not
 * coerced to the block's target value because doing so would fabricate exact provenance. */
function prescribedDurationMinutes(
    prescription: ExecutionPrescription | undefined,
    stepId: string | undefined,
): number | undefined {
    if (!prescription) return undefined;
    if (stepId !== undefined) {
        const step = prescription.blocks.flatMap(block => block.steps).find(item => item.id === stepId);
        if (step?.dose?.kind !== 'duration') return undefined;
        const seconds = exactNumber(step.dose.seconds);
        if (seconds === undefined) return undefined;
        return seconds * (step.dose.sets ?? 1) / 60;
    }
    const duration = prescription.displayMetadata?.duration;
    if (!duration || duration.min !== duration.max || !Number.isFinite(duration.min)) return undefined;
    return duration.min;
}

function isRelevantCoverage(
    credit: CoverageCreditFact,
    objective: BlockObjectiveDefinition | undefined,
): boolean {
    if (!objective || credit.creditKind === 'none') return false;
    if (credit.coverageKey === objective.coverageKey) return true;
    return (objective.allowedSubstitutions ?? []).some(substitution =>
        substitution.targetCoverageKey === objective.coverageKey
        && substitution.allowedCoverageKeys.includes(credit.coverageKey),
    );
}

function matchPrescription(
    exposure: PerformedExposureFact,
    credits: readonly CoverageCreditFact[],
    block: IntentBlock,
    structured: StructuredReviewEvidence | null,
): LinkedProgressionExposureEvidence['prescription'] {
    const contract = block.progressionContract!;
    const targetObjective = objectivesById(block).get(contract.targetBinding.objectiveId);
    const relevantCredits = credits.filter(credit => isRelevantCoverage(credit, targetObjective));
    const hasRelevantExact = relevantCredits.some(credit => credit.creditKind === 'exact');
    const hasRelevantSemantic = relevantCredits.some(credit => credit.creditKind === 'semantic_confident');

    const source = structured?.prescription?.sessionSource ?? structured?.execution?.sessionSource;
    const actualSourceRevision = sourceRevision(source);
    const prescribedValue = prescribedDurationMinutes(structured?.prescription, contract.targetBinding.stepId);

    let status: ProgressionPrescriptionMatch = 'unknown';
    if (hasRelevantExact || hasRelevantSemantic) {
        if (!hasRelevantExact) {
            status = 'partial';
        } else if (!structured?.execution || !structured.prescription) {
            // Real role-relevant work exists, but immutable prescription provenance is absent.
            status = 'partial';
        } else if (!sameSessionSource(structured.execution.sessionSource, structured.prescription.sessionSource)
            || !sourceMatchesBlock(block, structured.prescription.sessionSource, contract)) {
            status = 'mismatch';
        } else {
            const deliveredDuration = exposure.durationMin;
            const deliveredMatches = contract.variable === 'duration_min'
                && deliveredDuration !== undefined
                && deliveredDuration !== null
                && Math.abs(deliveredDuration - contract.currentValue)
                    <= contract.currentValue * DURATION_MATCH_TOLERANCE_FRACTION;
            const prescribedMatches = contract.variable === 'duration_min'
                && prescribedValue !== undefined
                && prescribedValue === contract.currentValue;
            status = deliveredMatches && prescribedMatches ? 'matched_current_target' : 'partial';
        }
    } else if (credits.length > 0) {
        status = 'mismatch';
    }

    return {
        status,
        sourcePlanRevision: actualSourceRevision,
        ...(source?.kind === 'external_plan' ? { sessionId: source.sessionId } : {}),
        ...(contract.targetBinding.stepId !== undefined ? { stepId: contract.targetBinding.stepId } : {}),
        variable: contract.variable,
        unit: contract.unit,
        value: prescribedValue ?? Number.NaN,
    };
}

function deliveredDoseFraction(
    exposure: PerformedExposureFact,
    contract: NonNullable<IntentBlock['progressionContract']>,
): number | undefined {
    if (contract.variable !== 'duration_min'
        || exposure.durationMin === undefined
        || exposure.durationMin === null
        || contract.currentValue <= 0) return undefined;
    return exposure.durationMin / contract.currentValue;
}

async function assembleLinkedExposures(
    userId: string,
    block: IntentBlock,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<readonly LinkedProgressionExposureEvidence[]> {
    const contract = block.progressionContract;
    if (!contract) return [];

    const [facts, sessionOutcomes] = await Promise.all([
        getPerformedTrainingFactsInRange(userId, fromDateInclusive, toDateExclusive),
        sessionOutcomeReportService.buildReport(userId, fromDateInclusive, toDateExclusive),
    ]);
    const outcomesByExecutionId = new Map<string, SessionOutcome>(
        sessionOutcomes.map(outcome => [outcome.sourceSession.id, outcome]),
    );

    return Promise.all(facts.exposures.map(async exposure => {
        const credits = facts.coverageCredits.filter(
            credit => credit.performedOccurrenceId === exposure.performedOccurrenceId,
        );
        const structured = exposure.sourceKinds.includes('structured_execution')
            ? await resolveStructuredReviewEvidence(userId, exposure.performedOccurrenceId)
            : null;
        const outcome = structured ? outcomesByExecutionId.get(structured.executionId) : undefined;

        return {
            exposure,
            coverageCredits: credits,
            deliveredDoseFraction: deliveredDoseFraction(exposure, contract),
            prescription: matchPrescription(exposure, credits, block, structured),
            ...(outcome ? { outcome } : {}),
        };
    }));
}

async function assemblePrerequisiteEvidence(
    userId: string,
    block: IntentBlock,
    asOfDate: string,
): Promise<ProgressionPrerequisiteEvidence | undefined> {
    const contract = block.progressionContract;
    const targetObjective = contract ? objectivesById(block).get(contract.targetBinding.objectiveId) : undefined;
    if (!contract || !targetObjective) return undefined;

    const lookbackDays = targetObjective.entryPrerequisites?.minBaselineDays ?? 90;
    const lookbackStart = addDaysToLocalDateString(block.dateRange.startDate, -lookbackDays);

    const [priorFacts, checkins] = await Promise.all([
        getPerformedTrainingFactsInRange(userId, lookbackStart, block.dateRange.startDate),
        checkinService.getCheckinsInRange(userId, lookbackStart, addDaysToLocalDateString(asOfDate, 1)),
    ]);

    const priorComparableExposures = priorFacts.exposures.filter(exposure => priorFacts.coverageCredits
        .some(credit => credit.performedOccurrenceId === exposure.performedOccurrenceId
            && credit.coverageKey === targetObjective.coverageKey
            && credit.creditKind !== 'none')).length;

    const earliestExposureDate = priorFacts.exposures.reduce<string | undefined>(
        (earliest, exposure) => (!earliest || exposure.localDate < earliest ? exposure.localDate : earliest),
        undefined,
    );
    const baselineDays = earliestExposureDate
        ? Math.max(0, calendarDayDiff(earliestExposureDate, block.dateRange.startDate))
        : 0;

    const observedTissueSeverities = [...new Set(
        checkins.flatMap(checkin => Object.values(checkin.tissueResponses ?? {}))
            .map(deriveTissueSeverity)
            .filter((severity): severity is NonNullable<typeof severity> => severity !== null),
    )];

    return { priorComparableExposures, baselineDays, observedTissueSeverities };
}

function calendarDayDiff(fromDateInclusive: string, toDateExclusive: string): number {
    const [fy, fm, fd] = fromDateInclusive.split('-').map(Number);
    const [ty, tm, td] = toDateExclusive.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

async function assembleActiveRestrictions(
    userId: string,
    asOfDate: string,
): Promise<ProgressionReviewInput['activeRestrictions']> {
    const settingsState = await trainingSettingsService.peekTrainingSettingsState(userId);
    if (settingsState.status !== 'AVAILABLE') return undefined;
    const active = (settingsState.data.injuries ?? []).filter(injury => !injury.reviewBy || injury.reviewBy >= asOfDate);
    const hasAdverseTissue = active.some(injury => injury.severity === 'limit' || injury.severity === 'exclude');
    const prohibitedRegions = [...new Set(
        active.map(injury => injury.region).filter((region): region is NonNullable<typeof region> => region !== undefined),
    )];
    return { hasAdverseTissue, ...(prohibitedRegions.length > 0 ? { prohibitedRegions } : {}) };
}

/** Assemble enough real candidate evidence for the pure evaluator to apply its own review
 * window and fail-closed gates. `boundProgressResults` stays empty until this authoring path
 * has a frozen outcome-evaluation binding; inventing one would be less correct than a hold. */
export async function assembleProgressionReviewInput(
    userId: string,
    block: IntentBlock,
    asOfDate: string,
): Promise<ProgressionReviewInput> {
    const toDateExclusive = addDaysToLocalDateString(asOfDate, 1);
    const [linkedExposures, prerequisiteEvidence, activeRestrictions] = await Promise.all([
        assembleLinkedExposures(userId, block, block.dateRange.startDate, toDateExclusive),
        assemblePrerequisiteEvidence(userId, block, asOfDate),
        assembleActiveRestrictions(userId, asOfDate),
    ]);

    return {
        intentBlock: block,
        asOfDate,
        linkedExposures,
        boundProgressResults: [],
        ...(prerequisiteEvidence ? { prerequisiteEvidence } : {}),
        ...(activeRestrictions ? { activeRestrictions } : {}),
    };
}
