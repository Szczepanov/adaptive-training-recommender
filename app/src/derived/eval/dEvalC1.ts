import {
    classifyDEvalSessionOutcome,
    type DEvalPlannedSessionInput,
    type DEvalSessionOutcome,
} from '../placements/placementOutcome.ts';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import {
    DEVAL_ABSOLUTE_ADHERENCE_FLOOR,
    DEVAL_ADHERENCE_TOLERANCE,
    DEVAL_MAX_BLOCK_UNKNOWN_RATIO,
    DEVAL_MIN_BASELINE_DETERMINABLE_RATIO,
    DEVAL_MIN_BLOCK_DAYS,
    DEVAL_MIN_ELIGIBLE_SESSIONS,
    DEVAL_PARTIAL_WEIGHT,
    isLocalCalendarDate,
    type DEvalCriterionStatus,
} from './dEvalCriteria.ts';

export interface DEvalC1PlannedSessionInput extends DEvalPlannedSessionInput {
    sessionKey?: string;
    performedOccurrenceId?: string | null;
}

export interface DEvalC1BlockInput {
    plannedSessions: readonly DEvalC1PlannedSessionInput[];
    unplannedCount?: number;
}

/**
 * C1 input contract.
 *
 * `baseline` must be the §3 adherence baseline: the planned sessions of the 28 Warsaw dates
 * immediately before `blockStartDate` (`blockStartDate - 28` through `blockStartDate - 1`).
 * The evaluator does not select that window; it validates it. Every baseline session must have
 * an `assignedDate` inside the window and carry the window itself as its own
 * `blockStartDate`/`blockEndDate` (so `moved` is judged against the baseline block). A baseline
 * supplied without a valid `blockStartDate`, or with any session that fails these checks, is not
 * comparable and C1 falls back to the OD5 absolute floor. Validating rather than filtering keeps a
 * miss from silently leaving the baseline denominator.
 */
export interface DEvalC1Input {
    block: DEvalC1BlockInput;
    baseline?: DEvalC1BlockInput | null;
    /** First Warsaw date of the qualifying block; required for a comparable baseline. */
    blockStartDate?: string | null;
}

export interface DEvalC1ReducedBreakdown {
    total: number;
    completed: number;
    partial: number;
    abandoned: number;
    unknown: number;
}

export interface DEvalC1BlockSummary {
    planned: number;
    completed: number;
    moved: number;
    partial: number;
    reduced: number;
    reducedCompleted: number;
    reducedPartial: number;
    reducedAbandoned: number;
    reducedUnknown: number;
    reducedBreakdown: DEvalC1ReducedBreakdown;
    reducedShare: number | null;
    flag_skip: number;
    missed: number;
    unknown: number;
    unplanned: number;
    eligible: number;
    adherenceRate: number | null;
    determinableRatio: number | null;
    unknownRatio: number | null;
    duplicateOccurrenceIds: readonly string[];
    outcomes: readonly { sessionKey: string; outcome: DEvalSessionOutcome }[];
}

export interface DEvalC1BaselineComparison {
    provided: boolean;
    comparable: boolean;
    summary: DEvalC1BlockSummary | null;
    reason: string;
}

export interface DEvalC1Result {
    status: DEvalCriterionStatus;
    block: DEvalC1BlockSummary;
    baseline: DEvalC1BaselineComparison;
    threshold: number;
    thresholdSource: 'baseline_minus_tolerance' | 'absolute_floor';
    reasons: readonly string[];
    knownLimits: readonly string[];
}

const ADHERENCE_FLOAT_EPSILON = 1e-12;

function classifyReducedCompletion(session: DEvalC1PlannedSessionInput): 'completed' | 'partial' | 'abandoned' | 'unknown' {
    const execState = session.linkedExecution?.state;
    if (execState === 'abandoned') return 'abandoned';
    const fraction = session.linkedExecution?.completedFraction ?? session.responseCompletedFraction ?? null;
    if (fraction === 1 && execState !== 'in_progress') return 'completed';
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction < 1) return 'partial';
    return 'unknown';
}

function summarizeC1Block(input: DEvalC1BlockInput): DEvalC1BlockSummary {
    const unplannedRaw = input.unplannedCount ?? 0;
    const unplanned = Number.isFinite(unplannedRaw) && unplannedRaw >= 0 ? Math.floor(unplannedRaw) : 0;

    // Count each linked PerformedTrainingOccurrence at most once across planned assignments.
    // The first assignment claiming a performedOccurrenceId owns it; any later duplicate claim
    // referencing an already-seen performedOccurrenceId resolves to `unknown`.
    const seenOccurrenceIds = new Set<string>();
    const duplicateOccurrenceIds: string[] = [];

    let completed = 0;
    let moved = 0;
    let partial = 0;
    let reduced = 0;
    let reducedCompleted = 0;
    let reducedPartial = 0;
    let reducedAbandoned = 0;
    let reducedUnknown = 0;
    let flagSkip = 0;
    let missed = 0;
    let unknown = 0;

    const outcomes: { sessionKey: string; outcome: DEvalSessionOutcome }[] = [];

    input.plannedSessions.forEach((session, index) => {
        const key = session.sessionKey ?? `${session.assignedDate}#${index}`;
        const occId = session.linked && session.performedOccurrenceId ? session.performedOccurrenceId : null;
        let outcome: DEvalSessionOutcome;

        if (occId && seenOccurrenceIds.has(occId)) {
            if (!duplicateOccurrenceIds.includes(occId)) {
                duplicateOccurrenceIds.push(occId);
            }
            outcome = 'unknown';
        } else {
            if (occId) seenOccurrenceIds.add(occId);
            outcome = classifyDEvalSessionOutcome(session);
        }

        outcomes.push({ sessionKey: key, outcome });

        switch (outcome) {
            case 'completed':
                completed += 1;
                break;
            case 'moved':
                moved += 1;
                break;
            case 'partial':
                partial += 1;
                break;
            case 'reduced': {
                reduced += 1;
                const bucket = classifyReducedCompletion(session);
                if (bucket === 'completed') reducedCompleted += 1;
                else if (bucket === 'partial') reducedPartial += 1;
                else if (bucket === 'abandoned') reducedAbandoned += 1;
                else reducedUnknown += 1;
                break;
            }
            case 'flag_skip':
                flagSkip += 1;
                break;
            case 'missed':
                missed += 1;
                break;
            case 'unknown':
                unknown += 1;
                break;
        }
    });

    const planned = input.plannedSessions.length;
    const eligible = planned - reduced - flagSkip - unknown;
    const adherenceRate = eligible > 0
        ? (completed + moved + DEVAL_PARTIAL_WEIGHT * partial) / eligible
        : null;

    return {
        planned,
        completed,
        moved,
        partial,
        reduced,
        reducedCompleted,
        reducedPartial,
        reducedAbandoned,
        reducedUnknown,
        reducedBreakdown: {
            total: reduced,
            completed: reducedCompleted,
            partial: reducedPartial,
            abandoned: reducedAbandoned,
            unknown: reducedUnknown,
        },
        reducedShare: planned > 0 ? reduced / planned : null,
        flag_skip: flagSkip,
        missed,
        unknown,
        unplanned,
        eligible,
        adherenceRate,
        determinableRatio: planned > 0 ? (planned - unknown) / planned : null,
        unknownRatio: planned > 0 ? unknown / planned : null,
        duplicateOccurrenceIds,
        outcomes,
    };
}

function isBaselineComparable(summary: DEvalC1BlockSummary): { comparable: boolean; reason: string } {
    if (summary.planned === 0) {
        return { comparable: false, reason: 'baseline_has_no_planned_sessions' };
    }
    if (summary.eligible < DEVAL_MIN_ELIGIBLE_SESSIONS) {
        return { comparable: false, reason: 'baseline_fewer_than_8_eligible_sessions' };
    }
    // Exact integer comparison for (planned - unknown) / planned >= 0.9 (OD4).
    const determinableNumerator = summary.planned - summary.unknown;
    if (determinableNumerator * 10 < summary.planned * Math.round(DEVAL_MIN_BASELINE_DETERMINABLE_RATIO * 10)) {
        return { comparable: false, reason: 'baseline_determinable_below_90_percent' };
    }
    if (summary.adherenceRate === null) {
        return { comparable: false, reason: 'baseline_zero_eligible_denominator' };
    }
    return { comparable: true, reason: 'baseline_comparable_od4' };
}

function checkBaselineWindow(
    baseline: DEvalC1BlockInput,
    blockStartDate: string | null | undefined,
): { comparable: true } | { comparable: false; reason: string } {
    if (!isLocalCalendarDate(blockStartDate)) {
        return { comparable: false, reason: 'baseline_window_unconfirmed_no_block_start' };
    }
    const windowStart = addDaysToLocalDateString(blockStartDate, -DEVAL_MIN_BLOCK_DAYS);
    const windowEnd = addDaysToLocalDateString(blockStartDate, -1);
    const outside = baseline.plannedSessions.some(session =>
        !isLocalCalendarDate(session.assignedDate)
        || session.assignedDate < windowStart
        || session.assignedDate > windowEnd
        || session.blockStartDate !== windowStart
        || session.blockEndDate !== windowEnd);
    return outside
        ? { comparable: false, reason: 'baseline_outside_pre_block_28_day_window' }
        : { comparable: true };
}

/**
 * Best-case adherence if every `unknown` session turned out eligible and fully completed.
 * When even this bound misses the threshold, the failure is observed regardless of how the
 * unknown sessions resolve (§4: an observed failure takes precedence over missing evidence).
 */
function bestCaseAdherence(block: DEvalC1BlockSummary): number | null {
    const denominator = block.eligible + block.unknown;
    if (block.eligible <= 0 || denominator <= 0) return null;
    return (block.completed + block.moved + DEVAL_PARTIAL_WEIGHT * block.partial + block.unknown) / denominator;
}

/** Evaluates ADR-0052 D-EVAL Criterion C1 (adherence) with optional OD4 baseline comparison. */
export function evaluateC1Adherence(input: DEvalC1Input): DEvalC1Result {
    const block = summarizeC1Block(input.block);
    const baselineSummary = input.baseline ? summarizeC1Block(input.baseline) : null;
    const baselineWindow = input.baseline ? checkBaselineWindow(input.baseline, input.blockStartDate) : null;
    const baselineEval = !baselineSummary
        ? { comparable: false, reason: 'baseline_not_provided' }
        : baselineWindow && !baselineWindow.comparable
            ? baselineWindow
            : isBaselineComparable(baselineSummary);

    const comparableBaseline = baselineSummary !== null && baselineEval.comparable && baselineSummary.adherenceRate !== null;
    const thresholdSource = comparableBaseline ? 'baseline_minus_tolerance' : 'absolute_floor';
    const threshold = comparableBaseline
        ? Math.max(0, baselineSummary.adherenceRate! - DEVAL_ADHERENCE_TOLERANCE)
        : DEVAL_ABSOLUTE_ADHERENCE_FLOOR;

    const reasons: string[] = [];
    const knownLimits: string[] = [];

    if (comparableBaseline) {
        knownLimits.push('Adherence baseline ran under legacy engine adjudication (loop vs loop comparison, not a controlled experiment).');
    } else if (input.baseline) {
        knownLimits.push(`Pre-block adherence baseline failed OD4 comparability (${baselineEval.reason}); fell back to 75% absolute floor (OD5).`);
    } else {
        knownLimits.push('No pre-block adherence baseline supplied; used 75% absolute floor (OD5).');
    }

    if (block.duplicateOccurrenceIds.length > 0) {
        knownLimits.push(
            `Duplicate performedOccurrenceId claims (${block.duplicateOccurrenceIds.join(', ')}) were counted once and subsequent claims marked unknown.`,
        );
    }

    const unknownExceedsMax = block.planned > 0
        && block.unknown * 10 > block.planned * Math.round(DEVAL_MAX_BLOCK_UNKNOWN_RATIO * 10);

    const meetsThreshold = (rate: number): boolean => rate + ADHERENCE_FLOAT_EPSILON >= threshold;
    // With >= 8 eligible sessions the sample-size gate is met however the unknowns resolve, so a
    // best-case rate below threshold is an observed failure even when unknown exceeds 10%.
    const bestCase = bestCaseAdherence(block);
    const observedFailureDespiteUnknown = unknownExceedsMax
        && block.eligible >= DEVAL_MIN_ELIGIBLE_SESSIONS
        && bestCase !== null
        && !meetsThreshold(bestCase);

    let status: DEvalCriterionStatus;
    if (observedFailureDespiteUnknown) {
        status = 'fail';
        reasons.push('adherence_below_threshold');
        knownLimits.push('C1 failed on best-case adherence (every unknown session counted as eligible and completed).');
    } else if (block.planned === 0 || block.eligible <= 0 || block.eligible < DEVAL_MIN_ELIGIBLE_SESSIONS || unknownExceedsMax) {
        status = 'inconclusive';
        if (block.planned === 0) reasons.push('no_planned_sessions');
        if (block.eligible <= 0) reasons.push('zero_eligible_denominator');
        else if (block.eligible < DEVAL_MIN_ELIGIBLE_SESSIONS) reasons.push('fewer_than_8_eligible_sessions');
        if (unknownExceedsMax) reasons.push('unknown_exceeds_10_percent');
    } else if (block.adherenceRate !== null && meetsThreshold(block.adherenceRate)) {
        status = 'pass';
        reasons.push('adherence_meets_threshold');
    } else {
        status = 'fail';
        reasons.push('adherence_below_threshold');
    }

    return {
        status,
        block,
        baseline: {
            provided: Boolean(input.baseline),
            comparable: comparableBaseline,
            summary: baselineSummary,
            reason: baselineEval.reason,
        },
        threshold,
        thresholdSource,
        reasons,
        knownLimits,
    };
}
