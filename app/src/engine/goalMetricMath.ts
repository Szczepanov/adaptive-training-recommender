import type { MetricDirection } from '../observations/models';

/**
 * PG4.5.3/ADR-0041: the one shared sign convention for "how much change does this target
 * still require", used by both goalProgress.ts (current-evidence display) and
 * goalFeasibility.ts (advisory required-change calculation). Direction always comes from
 * MetricDefinition.direction, never from a metric label or UI guess.
 */
export function improvementSignForDirection(direction: MetricDirection): 1 | -1 | null {
    if (direction === 'higher_is_better') return 1;
    if (direction === 'lower_is_better') return -1;
    return null; // target_range/context_only metrics are never target-eligible (see performanceTargetPolicy.ts)
}

export interface RequiredChange {
    /** Positive: improvement still required. Zero: exactly at target. Negative: current
     *  result is already beyond the target (see PG4.5.3's `already_achieved` rule). */
    absolute: number;
    /** Undefined convention (null) rather than +/-Infinity or NaN when currentValue is 0. */
    relativePct: number | null;
    alreadyAchieved: boolean;
}

export function computeRequiredChange(
    direction: MetricDirection,
    targetValue: number,
    currentValue: number,
): RequiredChange | null {
    const sign = improvementSignForDirection(direction);
    if (sign === null) return null;
    const absolute = sign * (targetValue - currentValue);
    const relativePct = currentValue === 0 ? null : (absolute / Math.abs(currentValue)) * 100;
    return { absolute, relativePct, alreadyAchieved: absolute <= 0 };
}
