import { getDayDiff } from '../../utils/localDate.ts';
import {
    evaluateC1Adherence,
    type DEvalC1BaselineComparison,
    type DEvalC1BlockInput,
    type DEvalC1BlockSummary,
    type DEvalC1Input,
    type DEvalC1PlannedSessionInput,
    type DEvalC1ReducedBreakdown,
    type DEvalC1Result,
} from './dEvalC1.ts';
import {
    evaluateC2Benchmarks,
    type DEvalC2Input,
    type DEvalC2MetricEvaluation,
    type DEvalC2ObservationSummary,
    type DEvalC2ProtocolEvaluation,
    type DEvalC2Result,
} from './dEvalC2.ts';
import {
    deriveTissueSeverity,
    evaluateC3FlaggedOutcomes,
    type DEvalC3AdverseOutcome,
    type DEvalC3FlagRecord,
    type DEvalC3FlagSourceState,
    type DEvalC3InjuryInput,
    type DEvalC3Input,
    type DEvalC3PerformedSessionInput,
    type DEvalC3Result,
    type DEvalSessionIntensity,
} from './dEvalC3.ts';
import {
    DEVAL_MIN_BLOCK_DAYS,
    isLocalCalendarDate,
    type DEvalC2Status,
    type DEvalCriterionStatus,
    type DEvalGoalBoundProtocol,
    type DEvalOverallVerdict,
} from './dEvalCriteria.ts';
import { renderDEvalResultMarkdown, type DEvalMarkdownInput } from './dEvalMarkdown.ts';

export {
    evaluateC1Adherence,
    evaluateC2Benchmarks,
    evaluateC3FlaggedOutcomes,
    deriveTissueSeverity,
    renderDEvalResultMarkdown,
};
export type {
    DEvalC1BaselineComparison,
    DEvalC1BlockInput,
    DEvalC1BlockSummary,
    DEvalC1Input,
    DEvalC1PlannedSessionInput,
    DEvalC1ReducedBreakdown,
    DEvalC1Result,
    DEvalC2Input,
    DEvalC2MetricEvaluation,
    DEvalC2ObservationSummary,
    DEvalC2ProtocolEvaluation,
    DEvalC2Result,
    DEvalC2Status,
    DEvalC3AdverseOutcome,
    DEvalC3FlagRecord,
    DEvalC3FlagSourceState,
    DEvalC3InjuryInput,
    DEvalC3Input,
    DEvalC3PerformedSessionInput,
    DEvalC3Result,
    DEvalCriterionStatus,
    DEvalGoalBoundProtocol,
    DEvalMarkdownInput,
    DEvalOverallVerdict,
    DEvalSessionIntensity,
};

export type DEvalRollbackUsage = 'unused' | 'safety' | 'non_safety';

export interface DEvalC4Input {
    rollbackState: DEvalRollbackUsage;
    reason?: string | null;
    rollbackAtDate?: string | null;
}

export interface DEvalC4Result {
    status: DEvalCriterionStatus;
    rollbackState: DEvalRollbackUsage;
    reason: string | null;
    rollbackAtDate: string | null;
}

/** Evaluates ADR-0052 D-EVAL Criterion C4 (rollback usage). */
export function evaluateC4Rollback(input: DEvalC4Input | DEvalRollbackUsage): DEvalC4Result {
    const normalized: DEvalC4Input = typeof input === 'string' ? { rollbackState: input } : input;
    const status: DEvalCriterionStatus = normalized.rollbackState === 'unused'
        ? 'pass'
        : normalized.rollbackState === 'safety'
            ? 'fail'
            : 'inconclusive';

    return {
        status,
        rollbackState: normalized.rollbackState,
        reason: normalized.reason ?? null,
        rollbackAtDate: normalized.rollbackAtDate ?? null,
    };
}

export interface DEvalBlockInput {
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    criteriaCommit?: string | null;
    phase2Commit?: string | null;
    rollbackSettingState?: string | null;
    c1: DEvalC1Input;
    c2: Omit<DEvalC2Input, 'blockStartDate' | 'blockEndDate' | 'asOfDate'> & {
        blockStartDate?: string;
        blockEndDate?: string;
        asOfDate?: string;
    };
    c3: Omit<DEvalC3Input, 'blockStartDate' | 'blockEndDate' | 'asOfDate' | 'asOfTimestamp'> & {
        blockStartDate?: string;
        blockEndDate?: string;
        asOfDate?: string;
        asOfTimestamp?: string | null;
    };
    c4: DEvalC4Input | DEvalRollbackUsage;
    extraKnownLimits?: readonly string[];
}

export interface DEvalBlockResult extends DEvalMarkdownInput {
    meetsMinBlockDays: boolean;
    blockCompletedAsOfDate: boolean;
    reasons: readonly string[];
}

/**
 * Evaluates a complete ADR-0052 D-EVAL qualifying block (OD1 block length + C1–C4 criteria)
 * and computes the §4 overall verdict (`NO_GO` > `EXTEND` > `PENDING` > `GO`).
 */
export function evaluateDEvalBlock(input: DEvalBlockInput): DEvalBlockResult {
    const validDates = isLocalCalendarDate(input.blockStartDate)
        && isLocalCalendarDate(input.blockEndDate)
        && isLocalCalendarDate(input.asOfDate)
        && input.blockStartDate <= input.blockEndDate;

    const blockDays = validDates ? getDayDiff(input.blockEndDate, input.blockStartDate) + 1 : 0;
    const meetsMinBlockDays = validDates && blockDays >= DEVAL_MIN_BLOCK_DAYS;
    const blockCompletedAsOfDate = validDates && input.asOfDate >= input.blockEndDate;

    const c1 = evaluateC1Adherence(input.c1);
    const c2 = evaluateC2Benchmarks({
        ...input.c2,
        blockStartDate: input.c2.blockStartDate ?? input.blockStartDate,
        blockEndDate: input.c2.blockEndDate ?? input.blockEndDate,
        asOfDate: input.c2.asOfDate ?? input.asOfDate,
    });
    const c3 = evaluateC3FlaggedOutcomes({
        ...input.c3,
        blockStartDate: input.c3.blockStartDate ?? input.blockStartDate,
        blockEndDate: input.c3.blockEndDate ?? input.blockEndDate,
        asOfDate: input.c3.asOfDate ?? input.asOfDate,
        asOfTimestamp: input.c3.asOfTimestamp !== undefined ? input.c3.asOfTimestamp : input.asOfTimestamp,
    });
    const c4 = evaluateC4Rollback(input.c4);

    const reasons: string[] = [];
    const blockLimits: string[] = [];
    if (!validDates) {
        reasons.push('invalid_block_or_as_of_dates');
        blockLimits.push('Block or as-of calendar dates are invalid.');
    } else {
        if (!meetsMinBlockDays) {
            reasons.push('block_shorter_than_28_days');
            blockLimits.push(`Block length ${blockDays}d is shorter than the 28-day minimum (OD1).`);
        }
        if (!blockCompletedAsOfDate) {
            reasons.push('as_of_date_before_block_end');
            blockLimits.push(`Evaluation as-of date ${input.asOfDate} precedes block end ${input.blockEndDate}.`);
        }
    }

    const criterionStatuses = [c1.status, c2.status, c3.status, c4.status];
    let overall: DEvalOverallVerdict;
    if (criterionStatuses.includes('fail')) {
        overall = 'NO_GO';
    } else if (criterionStatuses.includes('inconclusive') || !meetsMinBlockDays || !blockCompletedAsOfDate) {
        overall = 'EXTEND';
    } else if (c2.status === 'pending') {
        overall = 'PENDING';
    } else {
        overall = 'GO';
    }

    const knownLimits = [...new Set([
        ...c1.knownLimits,
        ...c2.knownLimits,
        ...c3.knownLimits,
        ...blockLimits,
        ...(input.extraKnownLimits ?? []),
    ])];

    return {
        blockStartDate: input.blockStartDate,
        blockEndDate: input.blockEndDate,
        blockDays,
        asOfDate: input.asOfDate,
        criteriaCommit: input.criteriaCommit ?? null,
        phase2Commit: input.phase2Commit ?? null,
        rollbackSettingState: input.rollbackSettingState ?? null,
        c1,
        c2,
        c3,
        c4,
        meetsMinBlockDays,
        blockCompletedAsOfDate,
        overall,
        reasons: [...new Set([...reasons, ...c1.reasons, ...c2.reasons, ...c3.reasons])],
        knownLimits,
    };
}
