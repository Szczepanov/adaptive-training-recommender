import type { MetricDefinition, MetricObservationRevision } from '../observations/models';
import { getMetricDefinition } from '../observations/registry';
import { getPerformanceTestDefinition } from '../observations/performanceTestingCatalog';
import type { AthletePerformanceProfile, TargetSource } from '../workouts/models';
import type { GoalPerformanceTarget } from './performanceTargetPolicy';
import { computeRequiredChange } from './goalMetricMath';

/**
 * PG4/ADR-0041: family-specific current evidence projected through one honest UI
 * contract. This module is a pure evaluator -- it never reaches Firestore itself; callers
 * resolve `AthletePerformanceProfile` and any candidate observations first.
 */
export type GoalCurrentEvidenceKind = 'estimated_1rm' | 'measured_observation';

export interface GoalProgressResult {
    metricId: string;
    unit: string;
    direction: MetricDefinition['direction'];
    targetValue: number;
    currentValue: number | null;
    currentEvidenceKind: GoalCurrentEvidenceKind | null;
    currentObservedAt: string | null;
    currentSource?: TargetSource;
    /** Positive: improvement still required. Zero/negative: target reached or exceeded. */
    gap: number | null;
    alreadyAchieved: boolean;
    hasComparableEvidence: boolean;
    reasonCode: 'ok' | 'no_baseline' | 'no_comparable_observation';
}

function resolveStrengthCurrentValue(
    exerciseId: string,
    profile: AthletePerformanceProfile | null | undefined,
): { value: number; source?: TargetSource } | null {
    const value = profile?.strength?.estimated1RmKg?.[exerciseId] ?? profile?.estimated1RmKg?.[exerciseId] ?? null;
    if (value === null || value === undefined) return null;
    const source = profile?.estimated1RmSources?.[exerciseId]?.source;
    return { value, source };
}

/**
 * Picks the most recent valid observation for the declared metric and performance-test
 * protocol identity. Matching on protocol id + revision (rather than the full
 * comparisonSeriesKey) keeps results from a superseded protocol revision from satisfying
 * a target bound to a different locked test definition. Full comparison-series trend
 * analysis remains deferred to PG8's formal outcome evaluation.
 */
function resolveTestCurrentObservation(
    metricId: string,
    performanceTestId: string,
    observations: readonly MetricObservationRevision[],
): MetricObservationRevision | null {
    const protocol = getPerformanceTestDefinition(performanceTestId).protocol;
    const candidates = observations
        .filter(observation => observation.validity === 'valid')
        .filter(observation => observation.metricId === metricId)
        .filter(observation =>
            observation.protocolRef.id === protocol.id
            && observation.protocolRef.revision === protocol.revision)
        .slice()
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return candidates.at(-1) ?? null;
}

export function resolveGoalProgress(
    target: GoalPerformanceTarget,
    options: {
        athletePerformanceProfile?: AthletePerformanceProfile | null;
        comparableObservations?: readonly MetricObservationRevision[];
    } = {},
): GoalProgressResult {
    const metric = getMetricDefinition(target.metricId);
    const base = {
        metricId: target.metricId,
        unit: metric.unit,
        direction: metric.direction,
        targetValue: target.targetValue,
    };

    let currentValue: number | null = null;
    let currentEvidenceKind: GoalCurrentEvidenceKind | null = null;
    let currentObservedAt: string | null = null;
    let currentSource: TargetSource | undefined;

    if (target.subjectRef.kind === 'exercise') {
        const resolved = resolveStrengthCurrentValue(target.subjectRef.exerciseId, options.athletePerformanceProfile);
        if (resolved) {
            currentValue = resolved.value;
            currentEvidenceKind = 'estimated_1rm';
            currentSource = resolved.source;
        }
    } else {
        const observation = resolveTestCurrentObservation(
            target.metricId,
            target.subjectRef.performanceTestId,
            options.comparableObservations ?? [],
        );
        if (observation) {
            currentValue = observation.value;
            currentEvidenceKind = 'measured_observation';
            currentObservedAt = observation.observedAt;
        }
    }

    if (currentValue === null) {
        return {
            ...base,
            currentValue: null,
            currentEvidenceKind: null,
            currentObservedAt: null,
            gap: null,
            alreadyAchieved: false,
            hasComparableEvidence: false,
            reasonCode: target.subjectRef.kind === 'exercise' ? 'no_baseline' : 'no_comparable_observation',
        };
    }

    const required = computeRequiredChange(metric.direction, target.targetValue, currentValue);

    return {
        ...base,
        currentValue,
        currentEvidenceKind,
        currentObservedAt,
        ...(currentSource ? { currentSource } : {}),
        gap: required?.absolute ?? null,
        alreadyAchieved: required?.alreadyAchieved ?? false,
        hasComparableEvidence: true,
        reasonCode: 'ok',
    };
}
