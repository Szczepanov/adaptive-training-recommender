import { EXERCISES_BY_ID } from '../workouts/exercises';
import { getMetricDefinition } from '../observations/registry';
import { getPerformanceTestDefinition } from '../observations/performanceTestingCatalog';
import type { MetricDefinition } from '../observations/models';
import {
    getPerformanceTargetPolicy,
    type GoalPerformanceTarget,
    type PerformanceGoalFamily,
} from './performanceTargetPolicy';

/**
 * Semantic validators for a typed performance target. Split out of
 * engine/performanceTargetPolicy.ts (Stage 2/PG5.1): this file imports the observations
 * metric/performance-test registries and the workouts exercise catalog, which must never
 * become reachable from production selection/ranking modules (see
 * observations/architecture.test.ts's OV1.4 boundary and performanceTargetPolicy.ts's
 * module doc comment). Only services/goalService.ts (not reachable from any
 * selection module) and the Goals.tsx UI import this module.
 */
export type PerformanceTargetValidationReasonCode =
    | 'unknown_metric'
    | 'metric_not_target_eligible'
    | 'wrong_subject_kind'
    | 'unknown_exercise'
    | 'exercise_not_eligible_for_metric'
    | 'unknown_performance_test'
    | 'test_protocol_does_not_declare_metric'
    | 'target_value_not_finite'
    | 'target_value_out_of_range'
    | 'domain_family_mismatch';

export interface PerformanceTargetValidationFailure {
    isValid: false;
    reasonCode: PerformanceTargetValidationReasonCode;
    message: string;
}

export interface PerformanceTargetValidationSuccess {
    isValid: true;
    metric: MetricDefinition;
    family: PerformanceGoalFamily;
}

export type PerformanceTargetValidationResult = PerformanceTargetValidationFailure | PerformanceTargetValidationSuccess;

function fail(reasonCode: PerformanceTargetValidationReasonCode, message: string): PerformanceTargetValidationFailure {
    return { isValid: false, reasonCode, message };
}

/**
 * Semantic validation boundary for a typed performance target (PG1.4). `getMetricDefinition`
 * and `getPerformanceTestDefinition` throw for an unknown id by design elsewhere in the
 * observations layer; this is the one place that exception boundary is caught and
 * translated into a typed, non-throwing result, so a malformed/unknown persisted target
 * can never escape as an unhandled exception -- and, per ADR-0041, can never silently
 * fall back to legacy free-text authority either.
 */
export function validatePerformanceTarget(target: GoalPerformanceTarget): PerformanceTargetValidationResult {
    if (typeof target.targetValue !== 'number' || !Number.isFinite(target.targetValue)) {
        return fail('target_value_not_finite', 'Target value must be a finite number');
    }

    let metric: MetricDefinition;
    try {
        metric = getMetricDefinition(target.metricId);
    } catch {
        return fail('unknown_metric', `Unknown metric id: ${target.metricId}`);
    }

    const policy = getPerformanceTargetPolicy(target.metricId);
    if (!policy) {
        return fail('metric_not_target_eligible', `Metric ${target.metricId} is not eligible for a performance goal target`);
    }

    if (target.subjectRef.kind !== policy.subjectKind) {
        return fail('wrong_subject_kind', `Metric ${target.metricId} requires a ${policy.subjectKind} subject`);
    }

    if (policy.targetRange && (target.targetValue < policy.targetRange.min || target.targetValue > policy.targetRange.max)) {
        return fail('target_value_out_of_range', `Target value must be between ${policy.targetRange.min} and ${policy.targetRange.max}`);
    }

    if (target.subjectRef.kind === 'exercise') {
        const exercise = EXERCISES_BY_ID.get(target.subjectRef.exerciseId);
        if (!exercise) {
            return fail('unknown_exercise', `Unknown exercise id: ${target.subjectRef.exerciseId}`);
        }
        if (policy.eligibleExerciseIds && !policy.eligibleExerciseIds.includes(target.subjectRef.exerciseId)) {
            return fail('exercise_not_eligible_for_metric', `Exercise ${target.subjectRef.exerciseId} is not eligible for metric ${target.metricId}`);
        }
    } else {
        let test;
        try {
            test = getPerformanceTestDefinition(target.subjectRef.performanceTestId);
        } catch {
            return fail('unknown_performance_test', `Unknown performance test id: ${target.subjectRef.performanceTestId}`);
        }
        if (!test.protocol.metricIds.includes(target.metricId)) {
            return fail('test_protocol_does_not_declare_metric', `Performance test ${target.subjectRef.performanceTestId} does not declare metric ${target.metricId}`);
        }
    }

    return { isValid: true, metric, family: policy.family };
}

const REQUIRED_DOMAIN_FOR_FAMILY: Record<PerformanceGoalFamily, string> = { strength: 'strength', speed: 'speed', power: 'power' };

/**
 * Composes `validatePerformanceTarget` with the domain/family consistency rule (PG2.2:
 * "typed target family must match domain for strength/speed/power goals"). Kept in this
 * observations-touching module, never in engine/validationCore.ts: validationCore.ts is
 * reachable from production selection/ranking modules via the engine/validation.ts
 * barrel, and this module's dependency on the observations metric/performance-test
 * registries must never become reachable from there (see
 * observations/architecture.test.ts's OV1.4 boundary). Callers that need the full
 * semantic+domain check -- goalService.ts's create/update/read boundary and the
 * Goals.tsx UI -- import it from here.
 */
export function validatePerformanceTargetForDomain(
    target: GoalPerformanceTarget,
    domain: string,
): PerformanceTargetValidationResult {
    const result = validatePerformanceTarget(target);
    if (!result.isValid) return result;
    const requiredDomain = REQUIRED_DOMAIN_FOR_FAMILY[result.family];
    if (domain !== requiredDomain) {
        return fail('domain_family_mismatch', `Domain must be ${requiredDomain} for a ${result.family} performance target`);
    }
    return result;
}
