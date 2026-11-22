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
    type DEvalC2Status,
    type DEvalGoalBoundProtocol,
} from './dEvalCriteria.ts';

export interface DEvalC2Input {
    observations: readonly CurrentObservation[];
    attemptRecords?: readonly AssessmentAttempt[];
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
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

function isCurrentValidObservation(observation: CurrentObservation): boolean {
    const { head, revision } = observation;
    return head.observationKey === revision.observationKey
        && head.metricId === revision.metricId
        && head.assessmentAttemptId === revision.assessmentAttemptId
        && head.headRevision === revision.revision
        && revision.validity === 'valid';
}

function observationLocalDate(observation: CurrentObservation): string | null {
    const ms = Date.parse(observation.revision.observedAt);
    if (!Number.isFinite(ms)) return null;
    return getLocalDateString(new Date(ms));
}

function compareObservations(a: CurrentObservation, b: CurrentObservation): number {
    const time = a.revision.observedAt.localeCompare(b.revision.observedAt);
    if (time !== 0) return time;
    return a.revision.observationKey < b.revision.observationKey
        ? -1
        : a.revision.observationKey > b.revision.observationKey ? 1 : 0;
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
    attemptById: ReadonlyMap<string, AssessmentAttempt> | null;
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    hasRollback: boolean;
    rollbackAtDate: string | null | undefined;
    callerReliability: readonly SeriesReliabilityEstimate[];
}): DEvalC2MetricEvaluation {
    const {
        protocol,
        metricId,
        observations,
        attemptById,
        blockStartDate,
        blockEndDate,
        asOfDate,
        hasRollback,
        rollbackAtDate,
        callerReliability,
    } = params;

    const beforeWindowStart = addDaysToLocalDateString(blockStartDate, -protocol.retestIntervalDays);
    const afterWindowStart = addDaysToLocalDateString(blockEndDate, 1);
    const dueDate = addDaysToLocalDateString(blockEndDate, protocol.retestIntervalDays);

    const eligible = observations
        .filter(isCurrentValidObservation)
        .filter(obs => obs.revision.protocolRef.id === protocol.protocolId && obs.revision.metricId === metricId)
        .filter(obs => attemptById === null || attemptById.get(obs.revision.assessmentAttemptId)?.state === 'completed')
        .map(obs => ({ obs, date: observationLocalDate(obs) }))
        .filter((entry): entry is { obs: CurrentObservation; date: string } => entry.date !== null)
        .sort((a, b) => compareObservations(a.obs, b.obs));

    const beforeEntry = eligible
        .filter(entry => entry.date >= beforeWindowStart && entry.date <= blockStartDate)
        .at(-1) ?? null;

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
        return makeResult('inconclusive', 'missing_before', ['missing_before_attempt']);
    }

    const beforeSummary = toObservationSummary(beforeEntry.obs, beforeEntry.date);
    const afterCandidates = eligible.filter(
        entry => entry.date >= afterWindowStart
            && entry.date <= dueDate
            && compareObservations(entry.obs, beforeEntry.obs) > 0,
    );

    const isComparableToBefore = (candidate: CurrentObservation): boolean =>
        candidate.revision.protocolRef.revision === beforeEntry.obs.revision.protocolRef.revision
        && candidate.revision.comparisonSeriesKey === beforeEntry.obs.revision.comparisonSeriesKey
        && candidate.revision.comparisonCanonicalizationVersion === beforeEntry.obs.revision.comparisonCanonicalizationVersion
        && candidate.revision.unit === beforeEntry.obs.revision.unit;

    const comparableAfter = afterCandidates.find(entry => isComparableToBefore(entry.obs)) ?? null;
    const nonComparableAfters = afterCandidates.filter(entry => !isComparableToBefore(entry.obs));
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
        if (isRollbackAffectingWindow(hasRollback, rollbackAtDate, blockStartDate, null)) {
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

    const attemptById = input.attemptRecords !== undefined
        ? new Map(input.attemptRecords.map(attempt => [attempt.id, attempt] as const))
        : null;
    const hasRollback = input.rollbackBeforeAfterAttempt === true
        || (input.rollbackBeforeAfterAttempt === undefined && Boolean(input.rollbackAtDate));
    const callerReliability = input.reliabilityEstimates ?? [];

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
            attemptById,
            blockStartDate: input.blockStartDate,
            blockEndDate: input.blockEndDate,
            asOfDate: input.asOfDate,
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
