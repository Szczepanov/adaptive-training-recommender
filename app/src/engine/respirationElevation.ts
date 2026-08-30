import type {
    RespirationElevationEvidence,
    RespirationElevationInput,
    RespirationElevationPolicy,
    RespirationElevationReasonCode,
} from './healthAnomalyModels';

export const SHADOW_RESPIRATION_ELEVATION_POLICY: RespirationElevationPolicy = Object.freeze({
    policyVersion: 'respiration-elevation/shadow-e2-s1-v1',
    minimumBaselineVersion: 3,
    minimumHistoryCount: 14,
    minimumRecentDayCoverage: 4 / 7,
    elevatedDeltaVs28d: 1,
    elevatedDeltaVs7d: 0.5,
    strongDeltaVs28d: 2,
    strongDeltaVs7d: 1,
});

const MIN_VALID_SLEEP_RESPIRATION = 6;
const MAX_VALID_SLEEP_RESPIRATION = 35;

function finiteOrNull(value: number | null): number | null {
    return value !== null && Number.isFinite(value) ? value : null;
}

function invalidCurrent(value: number | null): boolean {
    return value !== null && (value < MIN_VALID_SLEEP_RESPIRATION || value > MAX_VALID_SLEEP_RESPIRATION);
}

function unavailable(
    input: RespirationElevationInput,
    policy: RespirationElevationPolicy,
    reasonCodes: RespirationElevationReasonCode[],
): RespirationElevationEvidence {
    return {
        status: 'unavailable',
        currentValue: finiteOrNull(input.currentValue),
        baseline7dValue: finiteOrNull(input.baseline7dValue),
        baseline28dValue: finiteOrNull(input.baseline28dValue),
        deltaVs7d: null,
        deltaVs28d: null,
        baselineVersion: input.baselineVersion,
        historyCount: input.historyCount,
        recentDayCoverage: input.recentDayCoverage,
        reasonCodes,
        policyVersion: policy.policyVersion,
    };
}

/**
 * HA9 personal-delta classifier. Absolute respiration is deliberately not a decision boundary;
 * evidence must be elevated against both the recent and longer personal baseline. A non-positive
 * recent delta is resolving evidence and cannot newly tighten training.
 */
export function evaluateRespirationElevation(
    input: RespirationElevationInput,
    policy: RespirationElevationPolicy = SHADOW_RESPIRATION_ELEVATION_POLICY,
): RespirationElevationEvidence {
    const unavailableReasons: RespirationElevationReasonCode[] = [];
    if (!input.measurementEligible) unavailableReasons.push('MEASUREMENT_INELIGIBLE');
    if (input.measurementDate !== input.targetDate) unavailableReasons.push('DATE_PROVENANCE_MISMATCH');
    if (finiteOrNull(input.currentValue) === null) unavailableReasons.push('MISSING_CURRENT');
    else if (invalidCurrent(input.currentValue)) unavailableReasons.push('INVALID_CURRENT');
    if (input.baselineVersion === null || input.baselineVersion < policy.minimumBaselineVersion) {
        unavailableReasons.push('INCOMPATIBLE_BASELINE_VERSION');
    }
    if (!Number.isInteger(input.historyCount) || input.historyCount < policy.minimumHistoryCount) {
        unavailableReasons.push('INSUFFICIENT_HISTORY');
    }
    if (!Number.isFinite(input.recentDayCoverage) || input.recentDayCoverage < policy.minimumRecentDayCoverage) {
        unavailableReasons.push('INSUFFICIENT_RECENT_COVERAGE');
    }
    if (finiteOrNull(input.baseline7dValue) === null) unavailableReasons.push('MISSING_7D_BASELINE');
    if (finiteOrNull(input.baseline28dValue) === null) unavailableReasons.push('MISSING_28D_BASELINE');
    if (unavailableReasons.length > 0) return unavailable(input, policy, unavailableReasons);

    const currentValue = input.currentValue as number;
    const baseline7dValue = input.baseline7dValue as number;
    const baseline28dValue = input.baseline28dValue as number;
    const deltaVs7d = currentValue - baseline7dValue;
    const deltaVs28d = currentValue - baseline28dValue;
    let status: RespirationElevationEvidence['status'];
    let reasonCodes: RespirationElevationReasonCode[];

    if (deltaVs7d <= 0 && deltaVs28d > 0) {
        status = 'resolving';
        reasonCodes = ['RECENT_DELTA_NON_POSITIVE'];
    } else if (
        deltaVs28d >= policy.strongDeltaVs28d
        && deltaVs7d >= policy.strongDeltaVs7d
    ) {
        status = 'strongly_elevated';
        reasonCodes = ['ABOVE_STRONG_PERSONAL_DELTAS'];
    } else if (
        deltaVs28d >= policy.elevatedDeltaVs28d
        && deltaVs7d >= policy.elevatedDeltaVs7d
    ) {
        status = 'elevated';
        reasonCodes = ['ABOVE_ELEVATED_PERSONAL_DELTAS'];
    } else {
        status = 'normal';
        reasonCodes = ['BELOW_ELEVATION_BOUNDARY'];
    }

    return {
        status,
        currentValue,
        baseline7dValue,
        baseline28dValue,
        deltaVs7d,
        deltaVs28d,
        baselineVersion: input.baselineVersion,
        historyCount: input.historyCount,
        recentDayCoverage: input.recentDayCoverage,
        reasonCodes,
        policyVersion: policy.policyVersion,
    };
}
