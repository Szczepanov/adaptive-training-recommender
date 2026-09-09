/**
 * ADR-0037 H5c, Phase B of `docs/plans/h5c-progression-claim-design.md`'s implementation:
 * assembles a real `ProgressionReviewInput` (`engine/progressionReview.ts`, H5b) for one
 * `IntentBlock` + `asOfDate`.
 *
 * Investigated 2026-09-09: most fields have a real raw-data source somewhere in this app,
 * but the *join* from raw facts to `LinkedProgressionExposureEvidence` (exposure <->
 * coverage credit <-> prescription match <-> outcome, all keyed to one canonical occurrence)
 * does not exist anywhere -- this file is that join, not a wiring shim. `evaluateProgressionReview`
 * itself stays pure and untouched; this is purely a caller assembling its input.
 *
 * Deliberate scope cut: `boundProgressResults` always resolves to `[]`. A real bound-metric
 * result requires the separate, heavier OV evaluation-snapshot machinery
 * (`blockOutcomeReportService.ts`'s `BlockOutcomeReportInput`/`OutcomeEvaluationSnapshot`,
 * itself gated on an activated/frozen evaluation revision) that nothing in this manual
 * authoring path produces -- `ProgressionBlockEditor` (Phase D) never sets
 * `successCriteria.evaluationRef`. Wiring that machinery in for the rare block that does
 * carry one is separate follow-up work, not a gap in review correctness for blocks this app
 * can currently author: `evaluateProgressionReview`'s `minCompletedExposures`-only success
 * path needs no bound metric at all.
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
import { checkinService } from './checkinService';
import { trainingSettingsService } from './trainingSettingsService';
import type { SessionOutcome } from '../responses/outcome';

/** How far a `duration_min` exposure may drift from the contract's `currentValue` and
 * still count as delivering the current target dose exactly, rather than a partial one.
 * Not a physiological claim -- a bookkeeping tolerance for real-world session-length
 * variance (traffic lights, a slightly shortened warm-up), matching the kind of latitude
 * `comparePlannedVsPerformed` already gives elsewhere in this codebase for the same reason. */
const DURATION_MATCH_TOLERANCE_FRACTION = 0.15;

function objectivesById(block: IntentBlock): Map<string, BlockObjectiveDefinition> {
    return new Map(block.objectives.map(objective => [objective.id, objective]));
}

/** Resolves the raw execution id behind a canonical occurrence, when one exists. Only
 * `structured_execution`-sourced occurrences can join to a `SessionOutcome` at all --
 * `SessionOutcome`'s identity (`sourceSession.id`) is always an execution id
 * (`sessionOutcomeReportService.buildReport`), never a provider-activity or
 * legacy-strength identity. */
async function resolveExecutionId(userId: string, performedOccurrenceId: string): Promise<string | null> {
    const occurrence = await performedTrainingOccurrenceRepository.getById(userId, performedOccurrenceId);
    if (!occurrence) return null;
    const executionRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
    return executionRef?.executionId ?? null;
}

function matchPrescription(
    exposure: PerformedExposureFact,
    credits: readonly CoverageCreditFact[],
    contract: NonNullable<IntentBlock['progressionContract']>,
    targetObjective: BlockObjectiveDefinition | undefined,
    sourcePlanRevision: number,
): LinkedProgressionExposureEvidence['prescription'] {
    const relevantCredit = targetObjective
        ? credits.find(credit => credit.coverageKey === targetObjective.coverageKey && credit.creditKind !== 'none')
        : undefined;

    const value = contract.variable === 'duration_min' ? (exposure.durationMin ?? 0) : 0;

    let status: ProgressionPrescriptionMatch = 'unknown';
    if (relevantCredit) {
        if (relevantCredit.creditKind === 'semantic_confident') {
            status = 'partial';
        } else if (relevantCredit.creditKind === 'exact') {
            const withinTolerance = contract.variable !== 'duration_min'
                || (exposure.durationMin !== undefined
                    && Math.abs(exposure.durationMin - contract.currentValue) <= contract.currentValue * DURATION_MATCH_TOLERANCE_FRACTION);
            status = withinTolerance ? 'matched_current_target' : 'partial';
        }
    } else if (credits.length > 0) {
        // Credits exist for this occurrence, but none for the target role -- this exposure
        // is real work that is demonstrably not the contract's target, not merely unlinked.
        status = 'mismatch';
    }

    return {
        status,
        sourcePlanRevision,
        ...(contract.targetBinding.sessionId !== undefined ? { sessionId: contract.targetBinding.sessionId } : {}),
        ...(contract.targetBinding.stepId !== undefined ? { stepId: contract.targetBinding.stepId } : {}),
        variable: contract.variable,
        unit: contract.unit,
        value,
    };
}

function deliveredDoseFraction(
    exposure: PerformedExposureFact,
    contract: NonNullable<IntentBlock['progressionContract']>,
): number | undefined {
    if (contract.variable !== 'duration_min' || exposure.durationMin === undefined || contract.currentValue <= 0) return undefined;
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
    const targetObjective = objectivesById(block).get(contract.targetBinding.objectiveId);

    const [facts, sessionOutcomes] = await Promise.all([
        getPerformedTrainingFactsInRange(userId, fromDateInclusive, toDateExclusive),
        sessionOutcomeReportService.buildReport(userId, fromDateInclusive, toDateExclusive),
    ]);
    const outcomesByExecutionId = new Map<string, SessionOutcome>(sessionOutcomes.map(outcome => [outcome.sourceSession.id, outcome]));

    return Promise.all(facts.exposures.map(async exposure => {
        const credits = facts.coverageCredits.filter(credit => credit.performedOccurrenceId === exposure.performedOccurrenceId);
        const executionId = exposure.sourceKinds.includes('structured_execution')
            ? await resolveExecutionId(userId, exposure.performedOccurrenceId)
            : null;
        const outcome = executionId ? outcomesByExecutionId.get(executionId) : undefined;

        return {
            exposure,
            coverageCredits: credits,
            deliveredDoseFraction: deliveredDoseFraction(exposure, contract),
            prescription: matchPrescription(exposure, credits, contract, targetObjective, block.sourcePlanRevision),
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

    // Best-effort: how much of the requested lookback window this app actually has
    // performed-facts coverage for, using the earliest observed exposure as a proxy for
    // "training history begins here" -- not a claim about data completeness before that date.
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
    const prohibitedRegions = [...new Set(active.map(injury => injury.region).filter((region): region is NonNullable<typeof region> => region !== undefined))];
    return { hasAdverseTissue, ...(prohibitedRegions.length > 0 ? { prohibitedRegions } : {}) };
}

/**
 * Assembles a real `ProgressionReviewInput` for one block/date, ready to pass directly to
 * `evaluateProgressionReview`. The window is the block's own `dateRange.startDate` through
 * `asOfDate` inclusive -- `evaluateProgressionReview` computes its own narrower observation
 * window/counts from `contract.observationWindowDays`; this function's job is only to
 * supply enough real candidate evidence for that gating to run against, not to pre-narrow it.
 */
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
