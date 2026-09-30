/**
 * Pure join and projection logic for Assessment History (WP6.1).
 *
 * Governed by ADR-0046, Issue #897 WP6.1-WP6.5, and Decisions D1-D8.
 */

import type {
    AssessmentAttempt,
    AssessmentAttemptPurpose,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
    ObservationValidity,
} from './models';
import {
    computeObservationRowProgress,
    computeSeriesProgress,
    explainNonComparability,
    type AssessmentSeriesIdentity,
    type AssessmentSeriesObservation,
    type ObservationRowProgress,
} from './assessmentProgress';
import {
    PERFORMANCE_TEST_DEFINITIONS,
    getPerformanceTestFamily,
    type PerformanceTestDefinition,
} from './performanceTestingCatalog';
import { getMetricDefinition } from './registry';
import {
    computeBodyMassRelativeContext,
    resolveSameDayBodyMass,
    type BodyMassRelativeContext,
    type ResolveSameDayBodyMassOptions,
} from '../anthropometry/bodyMass';
import { getLocalDateString } from '../utils/localDate';
import { compareCodeUnits } from '../utils/canonicalJson';

export interface AssessmentHistoryRow {
    observationKey: string;
    attemptId: string;
    attemptPurpose: AssessmentAttemptPurpose;
    attemptState: AssessmentAttempt['state'];
    localDate: string;
    observedAt: string;
    metricId: string;
    displayName: string;
    value: number;
    unit: string;
    validity: ObservationValidity;
    sourceKind: 'trial-derived' | 'summary-only historical assessment';
    relativeContext: BodyMassRelativeContext;
    rowProgress: ObservationRowProgress;
    attempt: AssessmentAttempt;
    head: MetricObservationHead;
    revision: MetricObservationRevision;
}

export interface AssessmentHistorySeries {
    protocolRevision: number;
    comparisonSeriesKey: string;
    resolvedContext: ComparisonContext;
    observations: readonly AssessmentHistoryRow[];
    baseline: AssessmentHistoryRow | null;
    latest: AssessmentHistoryRow | null;
    progress: ReturnType<typeof computeSeriesProgress>['progress'];
    nonComparableReason?: string;
}

export interface AssessmentTestHistory {
    definitionId: string;
    protocolId: string;
    title: string;
    family: 'cycling' | 'strength' | 'field';
    definition: PerformanceTestDefinition;
    activeSeries: AssessmentHistorySeries | null;
    otherSeries: readonly AssessmentHistorySeries[];
    completedWithoutBenchmarkCount: number;
    abandonedCount: number;
    unreadableCount: number;
}

export interface AssessmentHistoryModel {
    tests: readonly AssessmentTestHistory[];
    totalUnreadableCount: number;
}

export interface BuildAssessmentHistoryInput {
    definitions?: readonly PerformanceTestDefinition[];
    attempts: readonly AssessmentAttempt[];
    observations: readonly { head: MetricObservationHead; revision: MetricObservationRevision }[];
    protocols?: readonly MeasurementProtocol[];
    bodyMassOptions?: ResolveSameDayBodyMassOptions;
    unreadableAttemptsCount?: number;
    unreadableObservationsCount?: number;
}

export function determineSourceKind(
    revision: MetricObservationRevision,
): 'trial-derived' | 'summary-only historical assessment' {
    if (
        revision.source === 'derived'
        && revision.derivedFromEvidenceRefs
        && revision.derivedFromEvidenceRefs.length > 0
    ) {
        return 'trial-derived';
    }
    return 'summary-only historical assessment';
}

/**
 * Pure builder joining catalog test definitions, attempts, and canonical observations
 * into the athlete-facing Assessment History read model.
 */
export function buildAssessmentHistory(input: BuildAssessmentHistoryInput): AssessmentHistoryModel {
    const definitions = input.definitions ?? PERFORMANCE_TEST_DEFINITIONS;
    const bodyMassOptions = input.bodyMassOptions ?? {};

    // Map observation heads/revisions by attemptId and metricId
    const observationsByAttempt = new Map<string, { head: MetricObservationHead; revision: MetricObservationRevision }[]>();
    for (const obs of input.observations) {
        const list = observationsByAttempt.get(obs.revision.assessmentAttemptId) ?? [];
        list.push(obs);
        observationsByAttempt.set(obs.revision.assessmentAttemptId, list);
    }

    const testHistories: AssessmentTestHistory[] = [];

    for (const definition of definitions) {
        const protocolId = definition.protocol.id;
        const family = getPerformanceTestFamily(definition);

        // Find all attempts matching this test's protocol ID (across all revisions)
        const testAttempts = input.attempts.filter(a => a.protocolRef.id === protocolId);
        const completedAttempts = testAttempts.filter(a => a.state === 'completed');
        const abandonedCount = testAttempts.filter(a => a.state === 'abandoned').length;

        // Group observations by (protocolRevision, comparisonSeriesKey)
        const seriesMap = new Map<string, {
            protocolRevision: number;
            comparisonSeriesKey: string;
            resolvedContext: ComparisonContext;
            seriesObservations: AssessmentSeriesObservation[];
        }>();

        const completedWithBenchmarkAttemptIds = new Set<string>();

        for (const attempt of completedAttempts) {
            const obsList = observationsByAttempt.get(attempt.id) ?? [];
            if (obsList.length > 0) {
                completedWithBenchmarkAttemptIds.add(attempt.id);
            }

            for (const { head, revision } of obsList) {
                // Must match the attempt's protocol revision
                if (revision.protocolRef.id !== protocolId || revision.protocolRef.revision !== attempt.protocolRef.revision) {
                    continue;
                }

                const seriesKey = revision.comparisonSeriesKey;
                const compositeKey = `${attempt.protocolRef.revision}::${seriesKey}`;
                const existing = seriesMap.get(compositeKey) ?? {
                    protocolRevision: attempt.protocolRef.revision,
                    comparisonSeriesKey: seriesKey,
                    resolvedContext: (revision.context as ComparisonContext) ?? {},
                    seriesObservations: [],
                };
                existing.seriesObservations.push({ head, revision, attempt });
                seriesMap.set(compositeKey, existing);
            }
        }

        const completedWithoutBenchmarkCount = completedAttempts.filter(
            a => !completedWithBenchmarkAttemptIds.has(a.id),
        ).length;

        // Process each series
        const seriesList: AssessmentHistorySeries[] = [];

        for (const { protocolRevision, comparisonSeriesKey, resolvedContext, seriesObservations } of seriesMap.values()) {
            // Sort series observations chronologically
            seriesObservations.sort((a, b) =>
                a.revision.observedAt.localeCompare(b.revision.observedAt)
                || compareCodeUnits(a.revision.observationKey, b.revision.observationKey),
            );

            // Compute series-level progress
            // (Use primary metric or first metric of definition protocol)
            const primaryMetricId = definition.protocol.metricIds[0] ?? seriesObservations[0]?.revision.metricId;
            const identity: AssessmentSeriesIdentity = {
                protocolId,
                protocolRevision,
                metricId: primaryMetricId,
                comparisonSeriesKey,
            };

            const seriesProgressResult = computeSeriesProgress(identity, seriesObservations);
            const baselineObs = seriesProgressResult.baseline;

            // Map each observation to an AssessmentHistoryRow
            const rows: AssessmentHistoryRow[] = seriesObservations.map(obs => {
                const metricDef = getMetricDefinition(obs.revision.metricId);
                const localDate = getLocalDateString(new Date(obs.revision.observedAt));
                const sameDayBodyMass = resolveSameDayBodyMass(localDate, bodyMassOptions);
                const relativeContext = computeBodyMassRelativeContext(
                    obs.revision.metricId,
                    obs.revision.value,
                    sameDayBodyMass,
                );
                const rowProgress = computeObservationRowProgress(obs, baselineObs);

                return {
                    observationKey: obs.revision.observationKey,
                    attemptId: obs.attempt.id,
                    attemptPurpose: obs.attempt.purpose,
                    attemptState: obs.attempt.state,
                    localDate,
                    observedAt: obs.revision.observedAt,
                    metricId: obs.revision.metricId,
                    displayName: metricDef.displayName,
                    value: obs.revision.value,
                    unit: obs.revision.unit,
                    validity: obs.revision.validity,
                    sourceKind: determineSourceKind(obs.revision),
                    relativeContext,
                    rowProgress,
                    attempt: obs.attempt,
                    head: obs.head,
                    revision: obs.revision,
                };
            });

            const baselineRow = baselineObs
                ? rows.find(r => r.observationKey === baselineObs.revision.observationKey) ?? null
                : null;
            const latestRow = seriesProgressResult.latest
                ? rows.find(r => r.observationKey === seriesProgressResult.latest?.revision.observationKey) ?? null
                : null;

            seriesList.push({
                protocolRevision,
                comparisonSeriesKey,
                resolvedContext,
                observations: rows,
                baseline: baselineRow,
                latest: latestRow,
                progress: seriesProgressResult.progress,
            });
        }

        // Determine active series vs other series:
        // Active series is the newest series (by latest observation date or highest revision)
        // If series exist for current definition protocol revision, prefer the newest series of that revision
        let activeSeries: AssessmentHistorySeries | null = null;
        let otherSeries: AssessmentHistorySeries[] = [];

        if (seriesList.length > 0) {
            // Sort series by newest observation observedAt descending, tie-break revision desc
            const sortedSeries = [...seriesList].sort((a, b) => {
                const latestDateA = a.observations[a.observations.length - 1]?.observedAt ?? '';
                const latestDateB = b.observations[b.observations.length - 1]?.observedAt ?? '';
                return latestDateB.localeCompare(latestDateA) || b.protocolRevision - a.protocolRevision;
            });

            activeSeries = sortedSeries[0];
            otherSeries = sortedSeries.slice(1).map(other => ({
                ...other,
                nonComparableReason: explainNonComparability(other, activeSeries!),
            }));
        }

        testHistories.push({
            definitionId: definition.id,
            protocolId,
            title: definition.protocol.title,
            family,
            definition,
            activeSeries,
            otherSeries,
            completedWithoutBenchmarkCount,
            abandonedCount,
            unreadableCount: 0, // Protocol-specific errors if any, aggregate in total
        });
    }

    const totalUnreadableCount = (input.unreadableAttemptsCount ?? 0) + (input.unreadableObservationsCount ?? 0);

    return {
        tests: testHistories,
        totalUnreadableCount,
    };
}
