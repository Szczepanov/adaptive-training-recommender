import type { AssessmentAttempt, MetricDefinition, MetricObservationRevision } from '../observations/models';
import { benchmarkEligibleAttemptIds } from '../observations/assessmentEvidenceEligibility';
import { getMetricDefinition } from '../observations/registry';
import { getPerformanceTestDefinition } from '../observations/performanceTestingCatalog';
import type { AthletePerformanceProfile, TargetSource } from '../workouts/models';
import type { GoalPerformanceTarget } from './performanceTargetPolicy';
import { computeRequiredChange } from './goalMetricMath';

/**
 * PG4/ADR-0041: family-specific current evidence projected through one honest UI
 * contract. This module is a pure evaluator -- it never reaches Firestore itself; callers
 * resolve `AthletePerformanceProfile` and any candidate observations first.
 *
 * Issue #897 WP8: for `performance_test` targets, only observations from a completed,
 * non-familiarization assessment attempt may become the current value (the same rule the
 * History read model uses, `isBenchmarkEligibleAttempt`). Callers supply the attempts; an
 * observation whose attempt is not supplied fails closed and is not eligible -- attempts are
 * always created by the testing workflow, so an unknown attempt is a read gap, not evidence.
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
 * analysis remains deferred to PG8's formal outcome evaluation. Observations from
 * familiarization, abandoned or unknown attempts are never candidates (#897 WP8).
 */
function resolveTestCurrentObservation(
    metricId: string,
    performanceTestId: string,
    observations: readonly MetricObservationRevision[],
    attempts: readonly AssessmentAttempt[],
): MetricObservationRevision | null {
    const protocol = getPerformanceTestDefinition(performanceTestId).protocol;
    const eligibleAttemptIds = benchmarkEligibleAttemptIds(attempts);
    const candidates = observations
        .filter(observation => observation.validity === 'valid')
        .filter(observation => eligibleAttemptIds.has(observation.assessmentAttemptId))
        .filter(observation => observation.metricId === metricId)
        .filter(observation =>
            observation.protocolRef.id === protocol.id
            && observation.protocolRef.revision === protocol.revision)
        .slice()
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return candidates.at(-1) ?? null;
}

/**
 * Ids a loader must fetch so `resolveGoalProgress` can resolve `performance_test` targets:
 * observation metric ids and the protocol ids whose attempts back those observations.
 * Exercise (e1RM) targets need neither. Results are sorted and de-duplicated.
 */
export function goalProgressEvidenceQuery(
    targets: readonly GoalPerformanceTarget[],
): { metricIds: string[]; protocolIds: string[] } {
    const metricIds = new Set<string>();
    const protocolIds = new Set<string>();
    for (const target of targets) {
        if (target.subjectRef.kind !== 'performance_test') continue;
        metricIds.add(target.metricId);
        protocolIds.add(getPerformanceTestDefinition(target.subjectRef.performanceTestId).protocol.id);
    }
    return { metricIds: Array.from(metricIds).sort(), protocolIds: Array.from(protocolIds).sort() };
}

export function resolveGoalProgress(
    target: GoalPerformanceTarget,
    options: {
        athletePerformanceProfile?: AthletePerformanceProfile | null;
        comparableObservations?: readonly MetricObservationRevision[];
        /** Attempts backing `comparableObservations`; unknown attempts fail closed. */
        assessmentAttempts?: readonly AssessmentAttempt[];
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
            options.assessmentAttempts ?? [],
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
