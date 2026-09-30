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
    metricId: string;
    protocolRevision: number;
    comparisonSeriesKey: string;
    resolvedContext: ComparisonContext;
    observations: readonly AssessmentHistoryRow[];
    baseline: AssessmentHistoryRow | null;
    latest: AssessmentHistoryRow | null;
    progress: ReturnType<typeof computeSeriesProgress>['progress'];
    nonComparableReason?: string;
}

export interface AssessmentMetricHistory {
    metricId: string;
    displayName: string;
    activeSeries: AssessmentHistorySeries | null;
    otherSeries: readonly AssessmentHistorySeries[];
    completedWithoutBenchmarkCount: number;
}

export interface AssessmentTestHistory {
    definitionId: string;
    protocolId: string;
    title: string;
    family: 'cycling' | 'strength' | 'field';
    definition: PerformanceTestDefinition;
    metrics: readonly AssessmentMetricHistory[];
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

function benchmarkTimestamp(series: AssessmentHistorySeries): string {
    const eligibleRows = series.observations.filter(row =>
        row.validity === 'valid' && row.attemptPurpose !== 'familiarization'
    );
    return eligibleRows.at(-1)?.observedAt
        ?? series.observations.at(-1)?.observedAt
        ?? '';
}

function selectActiveSeries(
    seriesList: readonly AssessmentHistorySeries[],
    currentProtocolRevision: number,
): { activeSeries: AssessmentHistorySeries | null; otherSeries: AssessmentHistorySeries[] } {
    if (seriesList.length === 0) {
        return { activeSeries: null, otherSeries: [] };
    }

    const sortNewest = (a: AssessmentHistorySeries, b: AssessmentHistorySeries): number =>
        benchmarkTimestamp(b).localeCompare(benchmarkTimestamp(a))
        || b.protocolRevision - a.protocolRevision
        || compareCodeUnits(a.comparisonSeriesKey, b.comparisonSeriesKey);

    // Prefer a series from the currently bundled protocol revision when one exists.
    // A late import/correction on an older immutable revision must not silently make
    // that historical protocol the athlete-facing active series.
    const currentRevisionSeries = seriesList
        .filter(series => series.protocolRevision === currentProtocolRevision)
        .sort(sortNewest);
    const sortedAll = [...seriesList].sort(sortNewest);
    const activeSeries = currentRevisionSeries[0] ?? sortedAll[0];

    const otherSeries = sortedAll
        .filter(series => series !== activeSeries)
        .map(other => ({
            ...other,
            nonComparableReason: explainNonComparability(other, activeSeries),
        }));

    return { activeSeries, otherSeries };
}

/**
 * Pure builder joining catalog test definitions, attempts, and canonical observations
 * into the athlete-facing Assessment History read model.
 *
 * D1 is enforced structurally: every displayed series represents exactly one
 * (protocolId, protocolRevision, metricId, comparisonSeriesKey) identity.
 */
export function buildAssessmentHistory(input: BuildAssessmentHistoryInput): AssessmentHistoryModel {
    const definitions = input.definitions ?? PERFORMANCE_TEST_DEFINITIONS;
    const bodyMassOptions = input.bodyMassOptions ?? {};

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
        const testAttempts = input.attempts.filter(attempt => attempt.protocolRef.id === protocolId);
        const completedAttempts = testAttempts.filter(attempt => attempt.state === 'completed');
        const abandonedCount = testAttempts.filter(attempt => attempt.state === 'abandoned').length;

        const metricIds = new Set(definition.protocol.metricIds);
        for (const attempt of completedAttempts) {
            for (const { revision } of observationsByAttempt.get(attempt.id) ?? []) {
                if (
                    revision.protocolRef.id === protocolId
                    && revision.protocolRef.revision === attempt.protocolRef.revision
                ) {
                    metricIds.add(revision.metricId);
                }
            }
        }

        const completedWithAnyBenchmark = new Set<string>();
        const metricHistories: AssessmentMetricHistory[] = [];

        for (const metricId of metricIds) {
            const seriesMap = new Map<string, {
                protocolRevision: number;
                comparisonSeriesKey: string;
                resolvedContext: ComparisonContext;
                seriesObservations: AssessmentSeriesObservation[];
            }>();
            const completedWithMetricBenchmark = new Set<string>();

            for (const attempt of completedAttempts) {
                const obsList = observationsByAttempt.get(attempt.id) ?? [];
                for (const { head, revision } of obsList) {
                    if (
                        revision.metricId !== metricId
                        || revision.protocolRef.id !== protocolId
                        || revision.protocolRef.revision !== attempt.protocolRef.revision
                    ) {
                        continue;
                    }

                    completedWithAnyBenchmark.add(attempt.id);
                    completedWithMetricBenchmark.add(attempt.id);

                    const seriesKey = revision.comparisonSeriesKey;
                    const compositeKey = `${attempt.protocolRef.revision}::${metricId}::${seriesKey}`;
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

            const seriesList: AssessmentHistorySeries[] = [];
            for (const { protocolRevision, comparisonSeriesKey, resolvedContext, seriesObservations } of seriesMap.values()) {
                seriesObservations.sort((a, b) =>
                    a.revision.observedAt.localeCompare(b.revision.observedAt)
                    || compareCodeUnits(a.revision.observationKey, b.revision.observationKey)
                );

                const identity: AssessmentSeriesIdentity = {
                    protocolId,
                    protocolRevision,
                    metricId,
                    comparisonSeriesKey,
                };
                const seriesProgressResult = computeSeriesProgress(identity, seriesObservations);
                const baselineObs = seriesProgressResult.baseline;

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
                    ? rows.find(row => row.observationKey === baselineObs.revision.observationKey) ?? null
                    : null;
                const latestRow = seriesProgressResult.latest
                    ? rows.find(row => row.observationKey === seriesProgressResult.latest?.revision.observationKey) ?? null
                    : null;

                seriesList.push({
                    metricId,
                    protocolRevision,
                    comparisonSeriesKey,
                    resolvedContext,
                    observations: rows,
                    baseline: baselineRow,
                    latest: latestRow,
                    progress: seriesProgressResult.progress,
                });
            }

            const { activeSeries, otherSeries } = selectActiveSeries(
                seriesList,
                definition.protocol.revision,
            );
            metricHistories.push({
                metricId,
                displayName: getMetricDefinition(metricId).displayName,
                activeSeries,
                otherSeries,
                completedWithoutBenchmarkCount: completedAttempts.filter(
                    attempt => !completedWithMetricBenchmark.has(attempt.id),
                ).length,
            });
        }

        metricHistories.sort((a, b) => {
            const aIndex = definition.protocol.metricIds.indexOf(a.metricId);
            const bIndex = definition.protocol.metricIds.indexOf(b.metricId);
            const aRank = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
            const bRank = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
            return aRank - bRank || compareCodeUnits(a.metricId, b.metricId);
        });

        testHistories.push({
            definitionId: definition.id,
            protocolId,
            title: definition.protocol.title,
            family,
            definition,
            metrics: metricHistories,
            completedWithoutBenchmarkCount: completedAttempts.filter(
                attempt => !completedWithAnyBenchmark.has(attempt.id),
            ).length,
            abandonedCount,
            unreadableCount: 0,
        });
    }

    return {
        tests: testHistories,
        totalUnreadableCount: (input.unreadableAttemptsCount ?? 0) + (input.unreadableObservationsCount ?? 0),
    };
}
