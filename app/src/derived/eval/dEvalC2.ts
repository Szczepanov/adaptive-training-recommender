import type { AssessmentAttempt, ReliabilityEstimate } from '../../observations/models.ts';
import {
    deriveProgress,
    type CurrentObservation,
    type ProgressResult,
    type SeriesReliabilityEstimate,
} from '../../observations/progress.ts';
import { getMetricDefinition } from '../../observations/registry.ts';
import type { OutcomeDirection, OutcomeMetricBinding } from '../../outcomes/evaluationSpec.ts';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate.ts';
import {
    DEVAL_GOAL_BOUND_PROTOCOLS,
    isLocalCalendarDate,
    parseUtcTimestampMs,
    type DEvalC2Status,
    type DEvalGoalBoundProtocol,
} from './dEvalCriteria.ts';

/**
 * C2 input contract.
 *
 * - `attemptRecords` is the completion evidence for §3 "completed attempt". When it is omitted,
 *   no observation can be confirmed as coming from a completed attempt and every protocol is
 *   inconclusive (`attempt_records_unavailable`). Pass an empty array only when the attempt
 *   collection was read and is genuinely empty.
 * - Comparability reference: the after attempt pins the series. "Before" is the most recent
 *   pre-block record (inside one retest interval, strictly before `blockStartDate`) that is
 *   comparable to an eligible after attempt under the same protocol revision, comparison series,
 *   canonicalization version and unit. Until a comparable after attempt exists, the most recent
 *   pre-block record is reported as the provisional reference.
 * - `asOfDate` (and optional `asOfTimestamp`) is the information cutoff: an observation revision
 *   is usable at the cutoff only if `revision.createdAt` is a valid offset timestamp on or before
 *   the cutoff (`ms <= asOfMs` when `asOfTimestamp` parses, else Warsaw calendar date
 *   `<= asOfDate`). A revision 1 created after the cutoff did not exist at the cutoff and is
 *   excluded; a revision `> 1` created after the cutoff (or any revision with unparseable
 *   `createdAt`) means the pre-cutoff revision was not reconstructed, so the affected metric fails
 *   closed as `inconclusive` (`observation_revision_unresolved_at_cutoff`). Callers with
 *   revision-history access (e.g. `DEvalReadoutService`) reconstruct the latest revision created
 *   on or before the cutoff before invoking C2.
 * - Observations whose attempt has a `completedAt` on a later Warsaw date (or after `asOfTimestamp`)
 *   are ignored; an attempt completed on the cutoff counts. A `completedAt` that is present but
 *   not a valid offset timestamp cannot be placed before the cutoff, so its attempt is excluded.
 *   Legacy attempts without `completedAt` stay eligible and are dated by their observation's
 *   `observedAt`, which the before/after windows already bound by the cutoff (same policy as
 *   `assessmentHistoryService`).
 */
export interface DEvalC2Input {
    observations: readonly CurrentObservation[];
    observationsComplete?: boolean;
    incompleteObservationMetricIds?: readonly string[];
    attemptRecords?: readonly AssessmentAttempt[];
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    rollbackBeforeAfterAttempt?: boolean;
    rollbackAtDate?: string | null;
    reliabilityEstimates?: readonly SeriesReliabilityEstimate[];
    protocols?: readonly DEvalGoalBoundProtocol[];
}

export interface DEvalC2ObservationSummary {
    observationKey: string;
    date: string;
    value: number;
    unit: string;
    protocolRevision: number;
    comparisonSeriesKey: string;
}

export interface DEvalC2MetricEvaluation {
    protocolId: string;
    metricId: string;
    status: DEvalC2Status;
    before: DEvalC2ObservationSummary | null;
    after: DEvalC2ObservationSummary | null;
    dueDate: string;
    comparability: 'comparable' | 'non_comparable' | 'missing_before' | 'pending_after' | 'missing_after' | 'no_stated_noise';
    nonComparableAttemptsObserved: boolean;
    reliability: ReliabilityEstimate | null;
    progress: ProgressResult | null;
    reasons: readonly string[];
}

export interface DEvalC2ProtocolEvaluation {
    protocolId: string;
    retestIntervalDays: number;
    dueDate: string;
    status: DEvalC2Status;
    metrics: readonly DEvalC2MetricEvaluation[];
    reasons: readonly string[];
}

export interface DEvalC2Result {
    status: DEvalC2Status;
    protocols: readonly DEvalC2ProtocolEvaluation[];
    pendingDueDates: readonly string[];
    reasons: readonly string[];
    knownLimits: readonly string[];
}

export function classifyObservationTimestampAtCutoff(
    timestamp: string | undefined,
    asOfDate: string,
    asOfMs: number | null,
): 'known' | 'after' | 'invalid' {
    const ms = parseUtcTimestampMs(timestamp);
    if (ms === null) return 'invalid';
    if (asOfMs !== null) return ms <= asOfMs ? 'known' : 'after';
    return getLocalDateString(new Date(ms)) <= asOfDate ? 'known' : 'after';
}

function isCompletedByAsOf(attempt: AssessmentAttempt | undefined, asOfDate: string, asOfMs: number | null): boolean {
    if (attempt?.state !== 'completed') return false;
    if (attempt.completedAt === undefined) return true;
    return classifyObservationTimestampAtCutoff(attempt.completedAt, asOfDate, asOfMs) === 'known';
}

function isCurrentObservation(observation: CurrentObservation): boolean {
    const { head, revision } = observation;
    return head.observationKey === revision.observationKey
        && head.metricId === revision.metricId
        && head.assessmentAttemptId === revision.assessmentAttemptId
        && head.headRevision === revision.revision;
}

interface DatedObservation {
    obs: CurrentObservation;
    date: string;
    ms: number;
}

function toDatedObservation(obs: CurrentObservation): DatedObservation | null {
    const ms = parseUtcTimestampMs(obs.revision.observedAt);
    if (ms === null) return null;
    return { obs, date: getLocalDateString(new Date(ms)), ms };
}

/** Orders by instant (not timestamp text, which differs across UTC offsets), then observationKey. */
function compareObservations(a: DatedObservation, b: DatedObservation): number {
    if (a.ms !== b.ms) return a.ms - b.ms;
    const keyA = a.obs.revision.observationKey;
    const keyB = b.obs.revision.observationKey;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function isComparablePair(a: CurrentObservation, b: CurrentObservation): boolean {
    return a.revision.protocolRef.revision === b.revision.protocolRef.revision
        && a.revision.comparisonSeriesKey === b.revision.comparisonSeriesKey
        && a.revision.comparisonCanonicalizationVersion === b.revision.comparisonCanonicalizationVersion
        && a.revision.unit === b.revision.unit;
}

/**
 * Picks the most recent pre-block record that has a comparable later after attempt, paired with
 * the earliest such after attempt. Falls back to the most recent pre-block record with no pair.
 */
function selectBeforeAndAfter(
    beforeCandidates: readonly DatedObservation[],
    afterCandidates: readonly DatedObservation[],
): { before: DatedObservation | null; after: DatedObservation | null } {
    for (let i = beforeCandidates.length - 1; i >= 0; i -= 1) {
        const before = beforeCandidates[i]!;
        const after = afterCandidates.find(entry =>
            compareObservations(entry, before) > 0 && isComparablePair(entry.obs, before.obs));
        if (after) return { before, after };
    }
    return { before: beforeCandidates.at(-1) ?? null, after: null };
}

function toObservationSummary(observation: CurrentObservation, date: string): DEvalC2ObservationSummary {
    return {
        observationKey: observation.revision.observationKey,
        date,
        value: observation.revision.value,
        unit: observation.revision.unit,
        protocolRevision: observation.revision.protocolRef.revision,
        comparisonSeriesKey: observation.revision.comparisonSeriesKey,
    };
}

function expectedDirectionForMetric(metricId: string): OutcomeDirection {
    const definition = getMetricDefinition(metricId);
    if (definition.direction === 'lower_is_better') return { kind: 'lower_is_better' };
    return { kind: 'higher_is_better' };
}

function aggregateC2Statuses(statuses: readonly DEvalC2Status[]): DEvalC2Status {
    if (statuses.includes('fail')) return 'fail';
    if (statuses.includes('inconclusive')) return 'inconclusive';
    if (statuses.includes('pending')) return 'pending';
    return 'pass';
}

function isRollbackAffectingWindow(
    hasRollback: boolean,
    rollbackAtDate: string | null | undefined,
    blockStartDate: string,
    afterDate: string | null,
): boolean {
    if (!hasRollback) return false;
    if (!rollbackAtDate || !isLocalCalendarDate(rollbackAtDate)) return true;
    if (rollbackAtDate < blockStartDate) return false;
    return afterDate === null || rollbackAtDate <= afterDate;
}

function evaluateProtocolMetric(params: {
    protocol: DEvalGoalBoundProtocol;
    metricId: string;
    observations: readonly CurrentObservation[];
    observationsIncomplete: boolean;
    attemptById: ReadonlyMap<string, AssessmentAttempt>;
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfMs: number | null;
    hasRollback: boolean;
    rollbackAtDate: string | null | undefined;
    callerReliability: readonly SeriesReliabilityEstimate[];
}): DEvalC2MetricEvaluation {
    const {
        protocol,
        metricId,
        observations,
        observationsIncomplete,
        attemptById,
        blockStartDate,
        blockEndDate,
        asOfDate,
        asOfMs,
        hasRollback,
        rollbackAtDate,
        callerReliability,
    } = params;

    const beforeWindowStart = addDaysToLocalDateString(blockStartDate, -protocol.retestIntervalDays);
    const afterWindowStart = addDaysToLocalDateString(blockEndDate, 1);
    const dueDate = addDaysToLocalDateString(blockEndDate, protocol.retestIntervalDays);

    const protocolMetricObs = observations
        .filter(isCurrentObservation)
        .filter(obs => obs.revision.protocolRef.id === protocol.protocolId && obs.revision.metricId === metricId);

    const knownAtCutoff: CurrentObservation[] = [];
    let unresolvedRevisionAtCutoff = false;
    for (const obs of protocolMetricObs) {
        const createdRel = classifyObservationTimestampAtCutoff(obs.revision.createdAt, asOfDate, asOfMs);
        if (createdRel === 'known') {
            knownAtCutoff.push(obs);
        } else if (createdRel === 'invalid' || obs.revision.revision > 1) {
            unresolvedRevisionAtCutoff = true;
        }
    }

    const eligible = knownAtCutoff
        .filter(obs => obs.revision.validity === 'valid')
        .filter(obs => isCompletedByAsOf(attemptById.get(obs.revision.assessmentAttemptId), asOfDate, asOfMs))
        .map(toDatedObservation)
        .filter((entry): entry is DatedObservation => entry !== null && (asOfMs === null || entry.ms <= asOfMs))
        .sort(compareObservations);

    const metricIncomplete = observationsIncomplete || unresolvedRevisionAtCutoff;
    const incompleteReasons: string[] = [
        ...(observationsIncomplete ? ['observation_records_incomplete'] : []),
        ...(unresolvedRevisionAtCutoff ? ['observation_revision_unresolved_at_cutoff'] : []),
    ];

    // Before window: inclusive lower bound, exclusive upper bound (the block start date is in the block).
    const beforeCandidates = eligible.filter(entry => entry.date >= beforeWindowStart && entry.date < blockStartDate);
    // After window ends at the earlier of the due date and the as-of information cutoff.
    const afterWindowEnd = asOfDate < dueDate ? asOfDate : dueDate;
    const afterWindowCandidates = eligible.filter(
        entry => entry.date >= afterWindowStart && entry.date <= afterWindowEnd,
    );
    const { before: beforeEntry, after: comparableAfter } = selectBeforeAndAfter(beforeCandidates, afterWindowCandidates);

    const makeResult = (
        status: DEvalC2Status,
        comparability: DEvalC2MetricEvaluation['comparability'],
        reasons: readonly string[],
        extras: Partial<Pick<DEvalC2MetricEvaluation, 'before' | 'after' | 'nonComparableAttemptsObserved' | 'reliability' | 'progress'>> = {},
    ): DEvalC2MetricEvaluation => ({
        protocolId: protocol.protocolId,
        metricId,
        status,
        before: extras.before ?? null,
        after: extras.after ?? null,
        dueDate,
        comparability,
        nonComparableAttemptsObserved: extras.nonComparableAttemptsObserved ?? false,
        reliability: extras.reliability ?? protocol.reliability,
        progress: extras.progress ?? null,
        reasons,
    });

    if (!beforeEntry) {
        return makeResult(
            'inconclusive',
            'missing_before',
            [...incompleteReasons, 'missing_before_attempt'],
        );
    }

    const beforeSummary = toObservationSummary(beforeEntry.obs, beforeEntry.date);
    const afterCandidates = afterWindowCandidates.filter(entry => compareObservations(entry, beforeEntry) > 0);
    const nonComparableAfters = afterCandidates.filter(entry => !isComparablePair(entry.obs, beforeEntry.obs));
    const nonComparableAttemptsObserved = nonComparableAfters.length > 0;

    if (!comparableAfter) {
        const nonComparableReasons = nonComparableAfters.some(
            entry => entry.obs.revision.protocolRef.revision !== beforeEntry.obs.revision.protocolRef.revision,
        )
            ? ['protocol_revision_changed']
            : nonComparableAttemptsObserved
                ? ['target_observations_exist_but_series_or_unit_differs']
                : [];

        const missingExtras = { before: beforeSummary, nonComparableAttemptsObserved };
        if (metricIncomplete) {
            const comparability = nonComparableAttemptsObserved
                ? 'non_comparable'
                : asOfDate <= dueDate
                    ? 'pending_after'
                    : 'missing_after';
            return makeResult(
                'inconclusive',
                comparability,
                [...incompleteReasons, ...nonComparableReasons],
                missingExtras,
            );
        }
        // No after attempt by the as-of date: a rollback on or before it precedes the eventual after attempt.
        if (isRollbackAffectingWindow(hasRollback, rollbackAtDate, blockStartDate, asOfDate)) {
            return makeResult(
                'inconclusive',
                nonComparableAttemptsObserved ? 'non_comparable' : 'missing_after',
                ['rollback_before_after_attempt', ...nonComparableReasons],
                missingExtras,
            );
        }
        if (asOfDate <= dueDate) {
            return makeResult(
                'pending',
                nonComparableAttemptsObserved ? 'non_comparable' : 'pending_after',
                ['after_attempt_pending_within_interval', ...nonComparableReasons],
                missingExtras,
            );
        }
        return makeResult(
            'inconclusive',
            nonComparableAttemptsObserved ? 'non_comparable' : 'missing_after',
            nonComparableAttemptsObserved ? nonComparableReasons : ['after_attempt_missed_beyond_interval'],
            missingExtras,
        );
    }

    const afterSummary = toObservationSummary(comparableAfter.obs, comparableAfter.date);
    const binding: OutcomeMetricBinding = {
        id: `d-eval:${protocol.protocolId}:${metricId}`,
        metricId,
        protocolRef: {
            id: beforeEntry.obs.revision.protocolRef.id,
            revision: beforeEntry.obs.revision.protocolRef.revision,
        },
        role: 'primary',
        expectedDirection: expectedDirectionForMetric(metricId),
        baseline: {
            kind: 'declared_observation',
            observationId: beforeEntry.obs.revision.observationKey,
        },
        targetObservationWindow: {
            startDate: comparableAfter.date,
            endDate: comparableAfter.date,
        },
        rationale: `ADR-0052 D-EVAL C2 benchmark check for ${protocol.protocolId}`,
    };

    const mergedReliability: SeriesReliabilityEstimate[] = [
        ...callerReliability,
        ...(protocol.reliability
            ? [{ comparisonSeriesKey: beforeEntry.obs.revision.comparisonSeriesKey, estimate: protocol.reliability }]
            : []),
    ];

    const progress = deriveProgress(binding, [beforeEntry.obs, comparableAfter.obs], mergedReliability);
    const sharedExtras = {
        before: beforeSummary,
        after: afterSummary,
        nonComparableAttemptsObserved,
        reliability: progress.reliability ?? protocol.reliability,
        progress,
    };

    if (metricIncomplete) {
        const noNoise = !progress.reliability || progress.reasons.includes('no_reliability_estimate');
        const comparability = progress.status === 'non_comparable' || progress.status === 'insufficient_evidence'
            ? (noNoise ? 'no_stated_noise' : 'non_comparable')
            : 'comparable';
        return makeResult('inconclusive', comparability, [...incompleteReasons, ...progress.reasons], sharedExtras);
    }
    if (progress.status === 'possible_decline' || progress.status === 'meaningful_decline') {
        return makeResult('fail', 'comparable', ['benchmark_declined_beyond_noise', ...progress.reasons], sharedExtras);
    }
    if (isRollbackAffectingWindow(hasRollback, rollbackAtDate, blockStartDate, comparableAfter.date)) {
        return makeResult('inconclusive', 'comparable', ['rollback_before_after_attempt'], sharedExtras);
    }
    if (progress.status === 'non_comparable' || progress.status === 'insufficient_evidence') {
        const noNoise = !progress.reliability || progress.reasons.includes('no_reliability_estimate');
        return makeResult('inconclusive', noNoise ? 'no_stated_noise' : 'non_comparable', [...progress.reasons], sharedExtras);
    }
    return makeResult('pass', 'comparable', [...progress.reasons], sharedExtras);
}

/** Evaluates ADR-0052 D-EVAL Criterion C2 (goal-bound benchmarks on per-protocol schedules). */
export function evaluateC2Benchmarks(input: DEvalC2Input): DEvalC2Result {
    const protocols = input.protocols ?? DEVAL_GOAL_BOUND_PROTOCOLS;

    if (
        !isLocalCalendarDate(input.blockStartDate)
        || !isLocalCalendarDate(input.blockEndDate)
        || !isLocalCalendarDate(input.asOfDate)
        || input.blockStartDate > input.blockEndDate
    ) {
        return {
            status: 'inconclusive',
            protocols: [],
            pendingDueDates: [],
            reasons: ['invalid_block_or_as_of_dates'],
            knownLimits: [],
        };
    }

    if (protocols.length === 0) {
        return {
            status: 'inconclusive',
            protocols: [],
            pendingDueDates: [],
            reasons: ['no_goal_bound_protocols_declared'],
            knownLimits: [],
        };
    }

    if (input.attemptRecords === undefined) {
        return {
            status: 'inconclusive',
            protocols: protocols.map(protocol => ({
                protocolId: protocol.protocolId,
                retestIntervalDays: protocol.retestIntervalDays,
                dueDate: addDaysToLocalDateString(input.blockEndDate, protocol.retestIntervalDays),
                status: 'inconclusive' as const,
                metrics: [],
                reasons: ['attempt_records_unavailable'],
            })),
            pendingDueDates: [],
            reasons: ['attempt_records_unavailable'],
            knownLimits: ['Assessment attempt records were not supplied, so no observation could be confirmed as a completed attempt.'],
        };
    }
    const attemptById = new Map(input.attemptRecords.map(attempt => [attempt.id, attempt] as const));
    const hasRollback = input.rollbackBeforeAfterAttempt === true
        || (input.rollbackBeforeAfterAttempt === undefined && Boolean(input.rollbackAtDate));
    const callerReliability = input.reliabilityEstimates ?? [];
    const incompleteMetrics = new Set(input.incompleteObservationMetricIds ?? []);
    const allObservationsIncomplete = input.observationsComplete === false;
    const asOfMs = parseUtcTimestampMs(input.asOfTimestamp ?? null);

    const protocolResults: DEvalC2ProtocolEvaluation[] = protocols.map(protocol => {
        const dueDate = addDaysToLocalDateString(input.blockEndDate, protocol.retestIntervalDays);
        if (protocol.metricIds.length === 0) {
            return {
                protocolId: protocol.protocolId,
                retestIntervalDays: protocol.retestIntervalDays,
                dueDate,
                status: 'inconclusive',
                metrics: [],
                reasons: ['protocol_declares_no_metrics'],
            };
        }
        const metrics = protocol.metricIds.map(metricId => evaluateProtocolMetric({
            protocol,
            metricId,
            observations: input.observations,
            observationsIncomplete: allObservationsIncomplete || incompleteMetrics.has(metricId),
            attemptById,
            blockStartDate: input.blockStartDate,
            blockEndDate: input.blockEndDate,
            asOfDate: input.asOfDate,
            asOfMs,
            hasRollback,
            rollbackAtDate: input.rollbackAtDate,
            callerReliability,
        }));
        const status = aggregateC2Statuses(metrics.map(metric => metric.status));
        const reasons = [...new Set(metrics.flatMap(metric => metric.reasons))];
        return {
            protocolId: protocol.protocolId,
            retestIntervalDays: protocol.retestIntervalDays,
            dueDate,
            status,
            metrics,
            reasons,
        };
    });

    const status = aggregateC2Statuses(protocolResults.map(protocol => protocol.status));
    const pendingDueDates = [...new Set(
        protocolResults
            .filter(protocol => protocol.status === 'pending')
            .map(protocol => protocol.dueDate),
    )].sort();
    const reasons = [...new Set(protocolResults.flatMap(protocol => protocol.reasons))];

    const knownLimits: string[] = [];
    if (protocolResults.some(protocol => protocol.reasons.includes('observation_records_incomplete'))) {
        knownLimits.push('One or more goal-bound metric observation reads were unavailable or contained unreadable records; affected C2 comparisons are inconclusive.');
    }
    if (protocolResults.some(protocol => protocol.reasons.includes('observation_revision_unresolved_at_cutoff'))) {
        knownLimits.push('One or more metric observations were modified after the as-of cutoff and their pre-cutoff revision could not be reconstructed; affected C2 comparisons are inconclusive.');
    }
    if (protocolResults.some(protocol => protocol.metrics.some(metric => metric.reliability?.source === 'literature_reference'))) {
        knownLimits.push('C2 uses OD10 literature_reference CV bounds unless personal repeatability or manual estimates exist for the series.');
    }

    return {
        status,
        protocols: protocolResults,
        pendingDueDates,
        reasons,
        knownLimits,
    };
}
