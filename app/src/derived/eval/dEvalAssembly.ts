/**
 * Pure D-EVAL ledger-to-criteria assembler (`docs/analysis/2026-10-25-adr-0052-d-eval-criteria.md`).
 *
 * Zero IO, zero clock, zero `app/src/engine/` imports (verified by `derived.architecture.test.ts`).
 * Converts already-read, hash-verified ledger records into `DEvalBlockInput` for
 * `evaluateDEvalBlock` / `renderDEvalResultMarkdown`.
 */

import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { assembleC1Window, buildExecutionAndLinkIndexes, indexPlans } from './dEvalAssemblyC1.ts';
import { buildC3PerformedSessions, toC3SourceState } from './dEvalAssemblyC3.ts';
import { buildFlagLookup, buildRedFlagLookup, deduplicateCapturedFlags } from './dEvalAssemblyFlags.ts';
import type { DEvalC1BlockInput } from './dEvalC1.ts';
import { DEVAL_MIN_BLOCK_DAYS, isLocalCalendarDate, parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalAssemblyOptions, DEvalRawLedgerData } from './dEvalRawLedger.ts';
import type { DEvalBlockInput } from './dEvalReadout.ts';

export type {
    DEvalAssemblyOptions,
    DEvalRawExecution,
    DEvalRawLedgerData,
    DEvalRawPlacementOverlay,
    DEvalRawPlanIssue,
    DEvalRawPlanRevision,
    DEvalSourceReadState,
} from './dEvalRawLedger.ts';

/**
 * Pure assembler translating raw user-ledger collections into `DEvalBlockInput` for
 * `evaluateDEvalBlock` and `renderDEvalResultMarkdown`.
 */
export function assembleDEvalBlockInput(
    raw: DEvalRawLedgerData,
    options: DEvalAssemblyOptions,
): DEvalBlockInput {
    const {
        blockStartDate,
        blockEndDate,
        asOfDate,
        asOfTimestamp = null,
        includeBaseline = true,
        criteriaCommit = null,
        phase2Commit = null,
        rollbackState: reportedRollbackState,
        rollbackReason: reportedRollbackReason = null,
        rollbackAtDate = null,
    } = options;

    // The setting is on now although usage was reported as unused: C4 cannot pass on that report, and
    // C2 cannot show that the after-attempt stayed in the qualifying regime.
    const rollbackContradicted = raw.engineRecommendationsEnabled === true && reportedRollbackState === 'unused';
    const rollbackState = rollbackContradicted ? 'non_safety' : reportedRollbackState;
    const rollbackReason = rollbackContradicted
        ? 'reported unused, but engineRecommendationsEnabled is on at readout; usage unconfirmed'
        : reportedRollbackReason;

    const asOfMs = parseUtcTimestampMs(asOfTimestamp);
    const extraKnownLimits: string[] = [];

    const validBlockDates = isLocalCalendarDate(blockStartDate)
        && isLocalCalendarDate(blockEndDate)
        && isLocalCalendarDate(asOfDate)
        && blockStartDate <= blockEndDate;

    const effectiveBlockEnd = validBlockDates
        ? (asOfDate < blockEndDate ? asOfDate : blockEndDate)
        : blockEndDate;

    if (validBlockDates && asOfDate <= blockEndDate) {
        extraKnownLimits.push(
            `Dry-run readout at as-of date ${asOfDate} (on or before block end ${blockEndDate}); `
            + 'pending or ±1-day sessions and open follow-up windows may still resolve.',
        );
    }

    const baselineStart = isLocalCalendarDate(blockStartDate)
        ? addDaysToLocalDateString(blockStartDate, -DEVAL_MIN_BLOCK_DAYS)
        : '';
    const baselineEnd = isLocalCalendarDate(blockStartDate)
        ? addDaysToLocalDateString(blockStartDate, -1)
        : '';

    const dedupedFlags = deduplicateCapturedFlags(raw.flagEvaluations, asOfDate, asOfMs);
    const { c3Flags, c3SourceStates, activeFlagOnDate } = buildFlagLookup(
        dedupedFlags,
        raw.flagEvaluationsState,
        blockStartDate,
        effectiveBlockEnd,
    );
    const redFlagOnDate = buildRedFlagLookup(raw.checkins, raw.checkinsState, asOfDate, asOfMs);

    const planIndex = indexPlans(raw, asOfMs);
    const { execById, execsBySession, unverifiedSessions, linksBySession } = buildExecutionAndLinkIndexes(
        raw,
        planIndex.verifiedRevMap,
        asOfDate,
        asOfMs,
    );

    const mainC1 = assembleC1Window({
        windowStart: blockStartDate,
        windowEnd: blockEndDate,
        effectiveEnd: effectiveBlockEnd,
        raw,
        planIndex,
        execsBySession,
        unverifiedSessions,
        linksBySession,
        activeFlagOnDate,
        redFlagOnDate,
        asOfDate,
        asOfMs,
    });
    extraKnownLimits.push(...mainC1.knownLimits);

    let baselineC1: DEvalC1BlockInput | null = null;
    if (includeBaseline && isLocalCalendarDate(baselineStart) && isLocalCalendarDate(baselineEnd) && asOfDate >= blockStartDate) {
        const baselineWindow = assembleC1Window({
            windowStart: baselineStart,
            windowEnd: baselineEnd,
            effectiveEnd: baselineEnd,
            raw,
            planIndex,
            execsBySession,
            unverifiedSessions,
            linksBySession,
            activeFlagOnDate,
            redFlagOnDate,
            asOfDate,
            asOfMs,
        });
        baselineC1 = baselineWindow.block;
    }

    const attemptsReliable = raw.attemptsState === 'measured'
        && (raw.unreadableAttemptsCount ?? 0) === 0
        && raw.attemptsTruncated !== true
        && raw.attempts !== undefined;
    if (!attemptsReliable) {
        extraKnownLimits.push('Assessment attempt records were unavailable, truncated, or contained unreadable rows; C2 cannot verify attempt completion.');
    }
    const incompleteObservationMetricIds = raw.incompleteObservationMetricIds ?? [];
    const hasObservationReadIssue = raw.observationsState === 'unavailable'
        || raw.observationsState === 'invalid'
        || (raw.unreadableObservationsCount ?? 0) > 0
        || incompleteObservationMetricIds.length > 0;
    if (hasObservationReadIssue) {
        extraKnownLimits.push('Metric observations were unavailable or contained unreadable records.');
    }
    const observationsComplete = !hasObservationReadIssue || incompleteObservationMetricIds.length > 0;

    const performedSessions = buildC3PerformedSessions({
        raw,
        planIndex,
        execById,
        blockStartDate,
        effectiveEnd: effectiveBlockEnd,
        asOfDate,
        asOfMs,
    });

    const checkinsSourceState = toC3SourceState(raw.checkinsState);
    const injuriesSourceState = toC3SourceState(raw.trainingSettingsState);
    const outcomesSourceState = toC3SourceState(raw.healthAnomalyOutcomesState);
    const performedReadsOk = (raw.occurrencesState === 'measured' || raw.occurrencesState === 'missing')
        && (raw.executionsState === 'measured' || raw.executionsState === 'missing');
    if (!performedReadsOk) {
        extraKnownLimits.push('Performed occurrence or execution reads were incomplete; C3 flagged-day evaluation is marked incomplete.');
    }

    const flagSourcesComplete = raw.flagEvaluationsState === 'measured' || raw.flagEvaluationsState === 'missing';
    const followUpSourcesComplete = performedReadsOk
        && checkinsSourceState === 'measured'
        && injuriesSourceState === 'measured'
        && outcomesSourceState === 'measured';

    const preferenceVerified = raw.preferencesState === 'measured' || raw.preferencesState === 'missing';
    let rollbackSettingState: string;
    if (preferenceVerified) {
        rollbackSettingState = raw.engineRecommendationsEnabled === true ? 'on (enabled)' : 'off';
        if (rollbackContradicted) {
            extraKnownLimits.push(
                'Preference `engineRecommendationsEnabled` is currently enabled while rollback state was reported as `unused`.',
            );
        }
    } else {
        rollbackSettingState = `unknown (${raw.preferencesState ?? 'unread'})`;
        extraKnownLimits.push('User preference `engineRecommendationsEnabled` could not be verified.');
    }

    return {
        blockStartDate,
        blockEndDate,
        asOfDate,
        asOfTimestamp,
        criteriaCommit,
        phase2Commit,
        rollbackSettingState,
        c1: {
            block: mainC1.block,
            baseline: baselineC1,
        },
        c2: {
            observations: raw.observations,
            observationsComplete,
            ...(incompleteObservationMetricIds.length > 0 ? { incompleteObservationMetricIds } : {}),
            attemptRecords: attemptsReliable ? raw.attempts : undefined,
            rollbackBeforeAfterAttempt: rollbackState !== 'unused',
            rollbackAtDate,
        },
        c3: {
            flags: c3Flags,
            flagSourceStates: c3SourceStates,
            performedSessions,
            checkins: raw.checkins,
            injuries: raw.injuries,
            healthAnomalyOutcomes: raw.healthAnomalyOutcomes,
            flagSourcesComplete,
            followUpSourcesComplete,
            followUpSourceStates: {
                checkins: checkinsSourceState,
                injuries: injuriesSourceState,
                healthAnomalyOutcomes: outcomesSourceState,
            },
        },
        c4: {
            rollbackState,
            reason: rollbackReason,
            rollbackAtDate,
            settingVerified: preferenceVerified,
        },
        extraKnownLimits: [...new Set(extraKnownLimits)],
    };
}
