/**
 * Longitudinal progress derivation across assessment comparison series.
 *
 * Governed by ADR-0046, Issue #897 WP6.1/WP6.4/WP6.5, and Decisions D1-D4.
 *
 * - D1: The unit of comparison is (protocolId, protocolRevision, metricId, comparisonSeriesKey).
 *       Different revisions or series keys are never compared numerically.
 * - D2: Shared pure progress module for History UI, CSV export, and Diagnostic JSON export v2.
 * - D3: Baseline is the earliest valid 'baseline'-purpose observation within the series;
 *       otherwise the earliest valid non-familiarization observation. Familiarization is never baseline.
 * - D4: With no reliability estimate, status is 'insufficient_evidence' with raw absolute and % delta.
 */

import type {
    AssessmentAttempt,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    deriveProgress,
    type CurrentObservation,
    type ProgressResult,
    type SeriesReliabilityEstimate,
} from './progress';
import { getMetricDefinition } from './registry';
import type { OutcomeDirection, OutcomeMetricBinding } from '../outcomes/evaluationSpec';
import { compareCodeUnits } from '../utils/canonicalJson';

export interface AssessmentSeriesIdentity {
    protocolId: string;
    protocolRevision: number;
    metricId: string;
    comparisonSeriesKey: string;
}

export interface AssessmentSeriesObservation {
    head: MetricObservationHead;
    revision: MetricObservationRevision;
    attempt: AssessmentAttempt;
}

export interface AssessmentSeriesGroup {
    identity: AssessmentSeriesIdentity;
    observations: readonly AssessmentSeriesObservation[];
    baselineObservation: AssessmentSeriesObservation | null;
    latestObservation: AssessmentSeriesObservation | null;
    progress: ProgressResult;
}

export interface CanonicalObservationExportLike {
    observationKey: string;
    head: MetricObservationHead;
    revisions: readonly MetricObservationRevision[];
}

export function compareObservationsChronological(
    a: { revision: MetricObservationRevision },
    b: { revision: MetricObservationRevision },
): number {
    return a.revision.observedAt.localeCompare(b.revision.observedAt)
        || compareCodeUnits(a.revision.observationKey, b.revision.observationKey);
}

/**
 * Selects the presentation baseline for a series according to D3:
 * 1. Earliest valid observation from a `purpose: 'baseline'` attempt.
 * 2. Otherwise earliest valid non-familiarization observation.
 * Familiarization is never a baseline.
 */
export function selectSeriesBaselineCandidate<T extends { revision: MetricObservationRevision; attempt?: AssessmentAttempt }>(
    candidates: readonly T[],
): T | null {
    const validCandidates = candidates
        .filter(c => c.revision.validity === 'valid')
        .sort(compareObservationsChronological);

    if (validCandidates.length === 0) return null;

    const baselineEligible = validCandidates.filter(c => c.attempt?.purpose !== 'familiarization');
    if (baselineEligible.length === 0) return null;

    const explicitBaseline = baselineEligible.find(c => c.attempt?.purpose === 'baseline');
    return explicitBaseline ?? baselineEligible[0];
}

/**
 * Derives longitudinal progress for a single comparison series.
 */
export function computeSeriesProgress(
    identity: AssessmentSeriesIdentity,
    seriesObservations: readonly AssessmentSeriesObservation[],
    reliabilityEstimates: readonly SeriesReliabilityEstimate[] = [],
): { baseline: AssessmentSeriesObservation | null; latest: AssessmentSeriesObservation | null; progress: ProgressResult } {
    const metricDef = getMetricDefinition(identity.metricId);
    const baselineCandidate = selectSeriesBaselineCandidate(seriesObservations);

    if (!baselineCandidate) {
        return {
            baseline: null,
            latest: null,
            progress: {
                metricId: identity.metricId,
                comparable: false,
                status: 'insufficient_evidence',
                reasons: ['baseline_not_found'],
                progressPolicyVersion: 'ov-progress-v1',
                comparisonSeriesKey: identity.comparisonSeriesKey,
            },
        };
    }

    const expectedDirection: OutcomeDirection = metricDef.direction === 'lower_is_better'
        ? { kind: 'lower_is_better' }
        : { kind: 'higher_is_better' };

    const binding: OutcomeMetricBinding = metricDef.direction === 'context_only'
        ? {
            id: `binding-${identity.protocolId}-r${identity.protocolRevision}-${identity.metricId}`,
            metricId: identity.metricId,
            protocolRef: { id: identity.protocolId, revision: identity.protocolRevision },
            role: 'context',
            baseline: {
                kind: 'declared_observation',
                observationId: baselineCandidate.revision.observationKey,
            },
            rationale: `Series progress for ${identity.metricId}`,
        }
        : {
            id: `binding-${identity.protocolId}-r${identity.protocolRevision}-${identity.metricId}`,
            metricId: identity.metricId,
            protocolRef: { id: identity.protocolId, revision: identity.protocolRevision },
            role: 'primary',
            expectedDirection,
            baseline: {
                kind: 'declared_observation',
                observationId: baselineCandidate.revision.observationKey,
            },
            rationale: `Series progress for ${identity.metricId}`,
        };

    const currentObs: CurrentObservation[] = seriesObservations.map(o => ({ head: o.head, revision: o.revision }));
    const progress = deriveProgress(binding, currentObs, reliabilityEstimates);

    const latest = progress.latestObservationId
        ? seriesObservations.find(o => o.revision.observationKey === progress.latestObservationId) ?? null
        : null;

    return {
        baseline: baselineCandidate,
        latest,
        progress,
    };
}

/**
 * Computes series-level progress for export (D1 / D2).
 * Groups by (protocol.id, protocol.revision, metricId, comparisonSeriesKey).
 */
export function computeProgressForExport(
    protocols: readonly MeasurementProtocol[],
    attempts: readonly AssessmentAttempt[],
    canonicalObservations: readonly CanonicalObservationExportLike[],
    reliabilityEstimates: readonly SeriesReliabilityEstimate[] = [],
): ProgressResult[] {
    const attemptsById = new Map(attempts.map(a => [a.id, a] as const));
    const results: ProgressResult[] = [];

    for (const protocol of protocols) {
        for (const metricId of protocol.metricIds) {
            // Group current observations for this protocol and metric by comparisonSeriesKey
            const observationsBySeries = new Map<string, AssessmentSeriesObservation[]>();

            for (const obs of canonicalObservations) {
                if (obs.head.metricId !== metricId) continue;
                const headRev = obs.revisions.find(r => r.revision === obs.head.headRevision);
                if (!headRev) continue;
                if (headRev.protocolRef.id !== protocol.id || headRev.protocolRef.revision !== protocol.revision) continue;
                const parentAttempt = attemptsById.get(headRev.assessmentAttemptId);
                // Only a completed parent attempt may contribute a longitudinal benchmark point
                if (!parentAttempt || parentAttempt.state !== 'completed') continue;
                if (
                    parentAttempt.protocolRef.id !== protocol.id
                    || parentAttempt.protocolRef.revision !== protocol.revision
                ) continue;

                const seriesKey = headRev.comparisonSeriesKey;
                const list = observationsBySeries.get(seriesKey) ?? [];
                list.push({ head: obs.head, revision: headRev, attempt: parentAttempt });
                observationsBySeries.set(seriesKey, list);
            }

            // Derive progress for each series independently
            for (const [seriesKey, seriesObs] of observationsBySeries.entries()) {
                const identity: AssessmentSeriesIdentity = {
                    protocolId: protocol.id,
                    protocolRevision: protocol.revision,
                    metricId,
                    comparisonSeriesKey: seriesKey,
                };
                const { progress } = computeSeriesProgress(identity, seriesObs, reliabilityEstimates);
                results.push(progress);
            }
        }
    }

    return results.sort((a, b) =>
        compareCodeUnits(a.metricId, b.metricId)
        || compareCodeUnits(a.comparisonSeriesKey ?? '', b.comparisonSeriesKey ?? ''),
    );
}

export interface ObservationRowProgress {
    baselineValue?: number;
    absoluteChange?: number;
    percentChange?: number;
    status: string;
}

/**
 * Computes the per-row progress status and deltas for a specific observation in a series.
 * Used for CSV export and detailed attempt drill-downs.
 */
export function computeObservationRowProgress(
    observation: AssessmentSeriesObservation,
    baselineObservation: AssessmentSeriesObservation | null,
    reliabilityEstimates: readonly SeriesReliabilityEstimate[] = [],
): ObservationRowProgress {
    if (observation.attempt.purpose === 'familiarization') {
        return { status: 'familiarization' };
    }
    if (observation.revision.validity !== 'valid') {
        return { status: observation.revision.validity };
    }
    if (!baselineObservation) {
        return { status: 'insufficient_evidence' };
    }

    const baselineKey = baselineObservation.revision.observationKey;
    const obsKey = observation.revision.observationKey;

    if (obsKey === baselineKey) {
        return {
            baselineValue: baselineObservation.revision.value,
            status: 'baseline',
        };
    }

    // Chronological order check: observation must be after baseline
    const order = compareObservationsChronological(observation, baselineObservation);
    if (order <= 0) {
        return { status: 'insufficient_evidence' };
    }

    const baselineVal = baselineObservation.revision.value;
    const currentVal = observation.revision.value;
    const absoluteChange = currentVal - baselineVal;
    const percentChange = baselineVal === 0
        ? undefined
        : 100 * absoluteChange / Math.abs(baselineVal);

    // Call deriveProgress with a target window pinned to this single observation
    const metricDef = getMetricDefinition(observation.revision.metricId);
    const expectedDirection: OutcomeDirection = metricDef.direction === 'lower_is_better'
        ? { kind: 'lower_is_better' }
        : { kind: 'higher_is_better' };

    const binding: OutcomeMetricBinding = {
        id: `row-binding-${observation.revision.observationKey}`,
        metricId: observation.revision.metricId,
        protocolRef: observation.revision.protocolRef,
        role: 'primary',
        expectedDirection,
        baseline: {
            kind: 'declared_observation',
            observationId: baselineKey,
        },
        // Pin window to observationKey via observations filtering
        rationale: 'Row progress calculation',
    };

    // Only baseline and this specific observation
    const pair: CurrentObservation[] = [
        { head: baselineObservation.head, revision: baselineObservation.revision },
        { head: observation.head, revision: observation.revision },
    ];
    const derived = deriveProgress(binding, pair, reliabilityEstimates);

    return {
        baselineValue: baselineVal,
        absoluteChange,
        ...(percentChange !== undefined ? { percentChange } : {}),
        status: derived.status,
    };
}

/**
 * Returns an explicit explanation why an older/other series is not comparable to the active series.
 */
export function explainNonComparability(
    other: { protocolRevision: number; comparisonSeriesKey: string },
    active: { protocolRevision: number; comparisonSeriesKey: string },
): string {
    if (other.protocolRevision !== active.protocolRevision) {
        return 'protocol revision changed';
    }
    if (other.comparisonSeriesKey !== active.comparisonSeriesKey) {
        return 'setup/method changed';
    }
    return 'not comparable';
}
