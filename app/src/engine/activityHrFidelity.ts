import type { HrMeasurement, NormalizedGarminActivity } from './models';

export const HR_FIDELITY_AUTHORITY_POLICY_VERSION = 'hrf5-shadow-v1' as const;

export type HrUseCase =
    | 'DISPLAY_AVERAGE' | 'DISPLAY_TRACE' | 'ZONE_DISTRIBUTION' | 'TRAINING_LOAD'
    | 'AEROBIC_DECOUPLING' | 'INTERVAL_RESPONSE' | 'MAX_HR_UPDATE'
    | 'THRESHOLD_HR_UPDATE' | 'WORKOUT_COMPLIANCE' | 'HEALTH_ANOMALY';
export type HrAuthorityStatus = 'ALLOWED' | 'BOUNDED' | 'OBSERVATIONAL' | 'BLOCKED';
export type HrAuthorityReason = 'MEASUREMENT_UNAVAILABLE' | 'MEASUREMENT_UNKNOWN'
    | 'MEASUREMENT_UNRELIABLE' | 'LOW_MEASUREMENT_CONFIDENCE'
    | 'SUMMARY_LINEAGE_UNVERIFIED' | 'SUMMARY_LINEAGE_DISCORDANT'
    | 'PEAK_ARTIFACT' | 'HEALTH_CORROBORATION_REQUIRED';

export interface HrUseAuthority {
    status: HrAuthorityStatus;
    reasons: readonly HrAuthorityReason[];
    policyVersion: typeof HR_FIDELITY_AUTHORITY_POLICY_VERSION;
}

const result = (status: HrAuthorityStatus, ...reasons: HrAuthorityReason[]): HrUseAuthority => ({
    status, reasons, policyVersion: HR_FIDELITY_AUTHORITY_POLICY_VERSION,
});

function unavailable(measurement: HrMeasurement | undefined): HrUseAuthority | undefined {
    if (!measurement) return result('OBSERVATIONAL', 'MEASUREMENT_UNAVAILABLE');
    if (measurement.measurementConfidence === 'unknown') return result('OBSERVATIONAL', 'MEASUREMENT_UNKNOWN');
    if (measurement.measurementConfidence === 'unreliable') return result('OBSERVATIONAL', 'MEASUREMENT_UNRELIABLE');
    if (measurement.measurementConfidence === 'low') return result('OBSERVATIONAL', 'LOW_MEASUREMENT_CONFIDENCE');
    return undefined;
}

function lineage(measurement: HrMeasurement): HrUseAuthority | undefined {
    if (measurement.summaryCompatibility === 'discordant') return result('BLOCKED', 'SUMMARY_LINEAGE_DISCORDANT');
    if (measurement.summaryCompatibility !== 'verified_same_effective_trace') return result('BLOCKED', 'SUMMARY_LINEAGE_UNVERIFIED');
    return undefined;
}

/** Shadow-only HR evidence authority. No live consumer invokes this until HRF6/HRF9. */
export function getHrUseAuthority(activity: NormalizedGarminActivity, useCase: HrUseCase): HrUseAuthority {
    const measurement = activity.hrMeasurement;
    const unavailableResult = unavailable(measurement);
    if (useCase === 'DISPLAY_AVERAGE' || useCase === 'DISPLAY_TRACE') {
        if (!unavailableResult) return result('ALLOWED');
        return unavailableResult;
    }
    if (!measurement) return result('BLOCKED', 'MEASUREMENT_UNAVAILABLE');
    if (measurement.measurementConfidence === 'unknown') return result('BLOCKED', 'MEASUREMENT_UNKNOWN');
    if (measurement.measurementConfidence === 'unreliable') return result('BLOCKED', 'MEASUREMENT_UNRELIABLE');
    if (measurement.measurementConfidence === 'low') return result('BLOCKED', 'LOW_MEASUREMENT_CONFIDENCE');

    if (useCase === 'HEALTH_ANOMALY') return result('OBSERVATIONAL', 'HEALTH_CORROBORATION_REQUIRED');
    if (useCase === 'WORKOUT_COMPLIANCE') return measurement.measurementConfidence === 'high' ? result('ALLOWED') : result('BOUNDED');

    const lineageResult = lineage(measurement);
    if (lineageResult) return lineageResult;
    if (useCase === 'MAX_HR_UPDATE' && measurement.artifactFlags.includes('ISOLATED_SPIKE')) {
        return result('BLOCKED', 'PEAK_ARTIFACT');
    }
    if (useCase === 'AEROBIC_DECOUPLING' || useCase === 'THRESHOLD_HR_UPDATE' || useCase === 'MAX_HR_UPDATE') {
        return measurement.measurementConfidence === 'high' ? result('ALLOWED') : result('BLOCKED', 'LOW_MEASUREMENT_CONFIDENCE');
    }
    return measurement.measurementConfidence === 'high' ? result('ALLOWED') : result('BOUNDED');
}
