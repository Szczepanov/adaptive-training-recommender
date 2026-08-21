import type {
    MetricObservationHead,
    MetricObservationRevision,
    ReliabilityEstimate,
} from './models';
import type {
    OutcomeMetricBinding,
    OutcomeDirection,
    PracticalThreshold,
} from '../outcomes/evaluationSpec';
import { assertValidOutcomeMetricBinding } from '../outcomes/evaluationSpec';
import { getLocalDateString } from '../utils/localDate';

export const PROGRESS_POLICY_VERSION = 'ov-progress-v1' as const;

export type ProgressStatus =
    | 'meaningful_improvement'
    | 'possible_improvement'
    | 'unclear_within_noise'
    | 'possible_decline'
    | 'meaningful_decline'
    | 'non_comparable'
    | 'insufficient_evidence';

export interface CurrentObservation {
    head: MetricObservationHead;
    revision: MetricObservationRevision;
}

export interface SeriesReliabilityEstimate {
    comparisonSeriesKey: string;
    estimate: ReliabilityEstimate;
}

export interface ProgressResult {
    metricId: string;
    baselineObservationId?: string;
    latestObservationId?: string;
    absoluteChange?: number;
    percentChange?: number;
    comparable: boolean;
    comparisonSeriesKey?: string;
    reliability?: ReliabilityEstimate;
    practicalThreshold?: PracticalThreshold;
    status: ProgressStatus;
    reasons: readonly string[];
    progressPolicyVersion: string;
}

function isCurrentValidObservation(observation: CurrentObservation): boolean {
    const { head, revision } = observation;
    return head.observationKey === revision.observationKey
        && head.metricId === revision.metricId
        && head.assessmentAttemptId === revision.assessmentAttemptId
        && head.headRevision === revision.revision
        && revision.validity === 'valid';
}

function dateFromTimestamp(timestamp: string): string {
    return getLocalDateString(new Date(timestamp));
}

function withinWindow(timestamp: string, window?: { startDate: string; endDate: string }): boolean {
    if (!window) return true;
    const date = dateFromTimestamp(timestamp);
    return date >= window.startDate && date <= window.endDate;
}

function observationOrder(a: CurrentObservation, b: CurrentObservation): number {
    const time = a.revision.observedAt.localeCompare(b.revision.observedAt);
    if (time !== 0) return time;
    return a.revision.observationKey < b.revision.observationKey ? -1 : a.revision.observationKey > b.revision.observationKey ? 1 : 0;
}

function protocolMatches(binding: OutcomeMetricBinding, revision: MetricObservationRevision): boolean {
    return binding.protocolRef === undefined
        || (revision.protocolRef.id === binding.protocolRef.id && revision.protocolRef.revision === binding.protocolRef.revision);
}

function candidateObservations(binding: OutcomeMetricBinding, observations: readonly CurrentObservation[]): CurrentObservation[] {
    return observations
        .filter(isCurrentValidObservation)
        .filter(observation => observation.revision.metricId === binding.metricId)
        .filter(observation => protocolMatches(binding, observation.revision))
        .sort(observationOrder);
}

function selectBaseline(binding: OutcomeMetricBinding, candidates: readonly CurrentObservation[]): CurrentObservation | null {
    const baseline = binding.baseline;
    if (baseline.kind === 'declared_observation') {
        return candidates.find(candidate => candidate.revision.observationKey === baseline.observationId) ?? null;
    }
    return candidates.find(candidate => withinWindow(candidate.revision.observedAt, baseline.window)) ?? null;
}

function selectLatest(binding: OutcomeMetricBinding, candidates: readonly CurrentObservation[], baseline: CurrentObservation): CurrentObservation | null {
    const sameSeries = candidates.filter(candidate =>
        candidate.revision.comparisonSeriesKey === baseline.revision.comparisonSeriesKey
        && candidate.revision.comparisonCanonicalizationVersion === baseline.revision.comparisonCanonicalizationVersion
        && candidate.revision.unit === baseline.revision.unit
        && withinWindow(candidate.revision.observedAt, binding.targetObservationWindow)
        && observationOrder(candidate, baseline) > 0,
    );
    return sameSeries.at(-1) ?? null;
}

function selectReliability(
    seriesKey: string,
    estimates: readonly SeriesReliabilityEstimate[],
): ReliabilityEstimate | undefined {
    const candidates = estimates.filter(item => item.comparisonSeriesKey === seriesKey).map(item => item.estimate);
    const priority: Record<ReliabilityEstimate['source'], number> = {
        personal_repeatability: 3,
        manual: 2,
        literature_reference: 1,
    };
    return [...candidates].sort((a, b) => priority[b.source] - priority[a.source])[0];
}

function distanceToRange(value: number, direction: Extract<OutcomeDirection, { kind: 'target_range' }>): number {
    if (value < direction.lowerBound) return direction.lowerBound - value;
    if (value > direction.upperBound) return value - direction.upperBound;
    return 0;
}

function favorableChange(
    baseline: number,
    latest: number,
    direction: OutcomeDirection,
): number {
    if (direction.kind === 'higher_is_better') return latest - baseline;
    if (direction.kind === 'lower_is_better') return baseline - latest;
    return distanceToRange(baseline, direction) - distanceToRange(latest, direction);
}

function errorResolved(
    favorableDelta: number,
    favorablePercent: number | undefined,
    reliability: ReliabilityEstimate,
): { resolved: boolean; reason?: string } {
    const magnitude = Math.abs(favorableDelta);
    switch (reliability.statistic) {
        case 'typical_error_abs':
        case 'sem_abs':
            return { resolved: magnitude > reliability.value };
        case 'cv_pct':
        case 'typical_error_pct':
            if (favorablePercent === undefined) return { resolved: false, reason: 'percentage_error_unusable_with_zero_baseline' };
            return { resolved: Math.abs(favorablePercent) > reliability.value };
    }
}

function practicalSatisfied(
    threshold: PracticalThreshold,
    favorableDelta: number,
    favorablePercent: number | undefined,
    latest: number,
    direction: OutcomeDirection,
): { satisfied: boolean; reason?: string } {
    switch (threshold.kind) {
        case 'absolute':
            return { satisfied: Math.abs(favorableDelta) >= threshold.value };
        case 'percent':
            return favorablePercent === undefined
                ? { satisfied: false, reason: 'percentage_threshold_unusable_with_zero_baseline' }
                : { satisfied: Math.abs(favorablePercent) >= threshold.value };
        case 'target':
            if (direction.kind === 'higher_is_better') return { satisfied: latest >= threshold.value };
            if (direction.kind === 'lower_is_better') return { satisfied: latest <= threshold.value };
            return { satisfied: latest >= direction.lowerBound && latest <= direction.upperBound };
    }
}

function resultBase(binding: OutcomeMetricBinding, reasons: string[]): ProgressResult {
    return {
        metricId: binding.metricId,
        comparable: false,
        status: 'insufficient_evidence',
        reasons,
        progressPolicyVersion: PROGRESS_POLICY_VERSION,
        ...(binding.role !== 'context' && binding.practicalThreshold !== undefined
            ? { practicalThreshold: binding.practicalThreshold }
            : {}),
    };
}

export function deriveProgress(
    binding: OutcomeMetricBinding,
    observations: readonly CurrentObservation[],
    reliabilityEstimates: readonly SeriesReliabilityEstimate[] = [],
): ProgressResult {
    assertValidOutcomeMetricBinding(binding);
    const reasons: string[] = [];
    const base = resultBase(binding, reasons);
    if (binding.role === 'context') {
        reasons.push('context_binding_has_no_progress_label');
        return base;
    }

    const candidates = candidateObservations(binding, observations);
    const baseline = selectBaseline(binding, candidates);
    if (!baseline) {
        reasons.push('baseline_not_found');
        return base;
    }

    const allTargetCandidates = candidates.filter(candidate =>
        withinWindow(candidate.revision.observedAt, binding.targetObservationWindow)
        && observationOrder(candidate, baseline) > 0,
    );
    if (allTargetCandidates.length > 0 && !allTargetCandidates.some(candidate =>
        candidate.revision.comparisonSeriesKey === baseline.revision.comparisonSeriesKey
        && candidate.revision.comparisonCanonicalizationVersion === baseline.revision.comparisonCanonicalizationVersion
        && candidate.revision.unit === baseline.revision.unit,
    )) {
        reasons.push('target_observations_exist_but_series_or_unit_differs');
        return {
            ...base,
            baselineObservationId: baseline.revision.observationKey,
            comparisonSeriesKey: baseline.revision.comparisonSeriesKey,
            status: 'non_comparable',
        };
    }

    const latest = selectLatest(binding, candidates, baseline);
    if (!latest) {
        reasons.push('post_baseline_observation_not_found');
        return {
            ...base,
            baselineObservationId: baseline.revision.observationKey,
            comparisonSeriesKey: baseline.revision.comparisonSeriesKey,
        };
    }

    const absoluteChange = latest.revision.value - baseline.revision.value;
    const percentChange = baseline.revision.value === 0
        ? undefined
        : 100 * absoluteChange / Math.abs(baseline.revision.value);
    const favorableDelta = favorableChange(
        baseline.revision.value,
        latest.revision.value,
        binding.expectedDirection,
    );
    const favorablePercent = baseline.revision.value === 0
        ? undefined
        : 100 * favorableDelta / Math.abs(baseline.revision.value);
    const reliability = selectReliability(baseline.revision.comparisonSeriesKey, reliabilityEstimates);

    const comparableBase: ProgressResult = {
        ...base,
        baselineObservationId: baseline.revision.observationKey,
        latestObservationId: latest.revision.observationKey,
        absoluteChange,
        ...(percentChange === undefined ? {} : { percentChange }),
        comparable: true,
        comparisonSeriesKey: baseline.revision.comparisonSeriesKey,
        ...(reliability ? { reliability } : {}),
    };

    if (favorableDelta === 0) {
        reasons.push('no_directional_change');
        return { ...comparableBase, status: reliability ? 'unclear_within_noise' : 'insufficient_evidence' };
    }

    if (!reliability) {
        reasons.push('no_reliability_estimate');
        reasons.push(favorableDelta > 0 ? 'raw_change_favorable' : 'raw_change_adverse');
        return comparableBase;
    }

    const measurement = errorResolved(favorableDelta, favorablePercent, reliability);
    if (measurement.reason) reasons.push(measurement.reason);
    if (!measurement.resolved) {
        reasons.push('change_within_available_measurement_error');
        return { ...comparableBase, status: 'unclear_within_noise' };
    }
    reasons.push('change_exceeds_available_measurement_error');

    const threshold = binding.practicalThreshold;
    if (!threshold) {
        reasons.push('no_practical_threshold_declared');
        return {
            ...comparableBase,
            status: favorableDelta > 0 ? 'possible_improvement' : 'possible_decline',
        };
    }

    const practical = practicalSatisfied(threshold, favorableDelta, favorablePercent, latest.revision.value, binding.expectedDirection);
    if (practical.reason) reasons.push(practical.reason);
    if (!practical.satisfied) {
        reasons.push('measurement_resolved_but_practical_threshold_not_met');
        return {
            ...comparableBase,
            status: favorableDelta > 0 ? 'possible_improvement' : 'possible_decline',
        };
    }
    reasons.push('declared_practical_threshold_met');
    return {
        ...comparableBase,
        status: favorableDelta > 0 ? 'meaningful_improvement' : 'meaningful_decline',
    };
}
