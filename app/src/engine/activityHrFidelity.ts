import type {
    HrMeasurement,
    HrMeasurementConfidence,
    NormalizedGarminActivity,
} from './models';

export const HR_FIDELITY_AUTHORITY_POLICY_VERSION = 'hrf5-shadow-v1' as const;

export type HrUseCase =
    | 'DISPLAY_AVERAGE'
    | 'DISPLAY_TRACE'
    | 'ZONE_DISTRIBUTION'
    | 'TRAINING_LOAD'
    | 'TRAINING_EFFECT'
    | 'AEROBIC_DECOUPLING'
    | 'INTERVAL_RESPONSE'
    | 'MAX_HR_UPDATE'
    | 'THRESHOLD_HR_UPDATE'
    | 'WORKOUT_COMPLIANCE'
    | 'HEALTH_ANOMALY';
export type HrAuthorityStatus = 'ALLOWED' | 'BOUNDED' | 'OBSERVATIONAL' | 'BLOCKED';
export type HrAuthorityReason =
    | 'MEASUREMENT_UNAVAILABLE'
    | 'MEASUREMENT_UNKNOWN'
    | 'MEASUREMENT_UNRELIABLE'
    | 'LOW_MEASUREMENT_CONFIDENCE'
    | 'MODERATE_MEASUREMENT_CONFIDENCE'
    | 'SUMMARY_LINEAGE_UNVERIFIED'
    | 'SUMMARY_LINEAGE_DISCORDANT'
    | 'INPUT_LINEAGE_UNVERIFIED'
    | 'SEGMENT_CONTEXT_UNVERIFIED'
    | 'PEAK_CONTEXT_UNVERIFIED'
    | 'PEAK_ARTIFACT'
    | 'THRESHOLD_PROTOCOL_UNVERIFIED'
    | 'HEALTH_CORROBORATION_REQUIRED';

/**
 * Evidence that only the eventual HRF6 consumer adapter can establish.
 *
 * `hrMeasurement` owns trace quality/provenance. These flags deliberately cover facts
 * that an activity-level trace classifier cannot infer safely: whether the exact child
 * metric descends from the assessed trace, whether a selected segment/peak/protocol is
 * valid, and whether health-anomaly evidence has independent corroboration.
 */
export interface HrUseAuthorityContext {
    inputLineageVerified?: boolean;
    segmentContextVerified?: boolean;
    peakContextVerified?: boolean;
    thresholdProtocolVerified?: boolean;
    healthAnomalyCorroborated?: boolean;
}

export interface HrUseAuthority {
    status: HrAuthorityStatus;
    reasons: readonly HrAuthorityReason[];
    policyVersion: typeof HR_FIDELITY_AUTHORITY_POLICY_VERSION;
}

interface HrUsePolicy {
    unavailableStatus: HrAuthorityStatus;
    confidence: Record<HrMeasurementConfidence, HrAuthorityStatus>;
    requiresInputLineage?: boolean;
    requiresSegmentContext?: boolean;
    requiresPeakContext?: boolean;
    requiresThresholdProtocol?: boolean;
    requiresHealthCorroboration?: boolean;
}

const USE_CASE_POLICY: Record<HrUseCase, HrUsePolicy> = {
    DISPLAY_AVERAGE: {
        unavailableStatus: 'OBSERVATIONAL',
        confidence: { high: 'ALLOWED', moderate: 'ALLOWED', low: 'OBSERVATIONAL', unreliable: 'OBSERVATIONAL', unknown: 'OBSERVATIONAL' },
    },
    DISPLAY_TRACE: {
        unavailableStatus: 'OBSERVATIONAL',
        confidence: { high: 'ALLOWED', moderate: 'ALLOWED', low: 'OBSERVATIONAL', unreliable: 'OBSERVATIONAL', unknown: 'OBSERVATIONAL' },
    },
    ZONE_DISTRIBUTION: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BOUNDED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
    },
    TRAINING_LOAD: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BOUNDED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
    },
    TRAINING_EFFECT: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BOUNDED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
    },
    AEROBIC_DECOUPLING: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BLOCKED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
        requiresSegmentContext: true,
    },
    INTERVAL_RESPONSE: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BOUNDED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
        requiresSegmentContext: true,
    },
    MAX_HR_UPDATE: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BLOCKED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
        requiresPeakContext: true,
    },
    THRESHOLD_HR_UPDATE: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BLOCKED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresInputLineage: true,
        requiresThresholdProtocol: true,
    },
    WORKOUT_COMPLIANCE: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'BOUNDED', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
    },
    HEALTH_ANOMALY: {
        unavailableStatus: 'BLOCKED',
        confidence: { high: 'ALLOWED', moderate: 'OBSERVATIONAL', low: 'BLOCKED', unreliable: 'BLOCKED', unknown: 'BLOCKED' },
        requiresHealthCorroboration: true,
    },
};

const result = (status: HrAuthorityStatus, ...reasons: HrAuthorityReason[]): HrUseAuthority => ({
    status,
    reasons: [...new Set(reasons)],
    policyVersion: HR_FIDELITY_AUTHORITY_POLICY_VERSION,
});

function confidenceReason(
    confidence: HrMeasurementConfidence,
    status: HrAuthorityStatus,
): HrAuthorityReason | undefined {
    if (status === 'ALLOWED') return undefined;
    switch (confidence) {
        case 'high': return undefined;
        case 'moderate': return 'MODERATE_MEASUREMENT_CONFIDENCE';
        case 'low': return 'LOW_MEASUREMENT_CONFIDENCE';
        case 'unreliable': return 'MEASUREMENT_UNRELIABLE';
        case 'unknown': return 'MEASUREMENT_UNKNOWN';
    }
}

function inputLineageReason(
    measurement: HrMeasurement,
    context: HrUseAuthorityContext,
): HrAuthorityReason | undefined {
    // A known contradiction is never overridable by caller context.
    if (measurement.summaryCompatibility === 'discordant') return 'SUMMARY_LINEAGE_DISCORDANT';
    if (context.inputLineageVerified === true) return undefined;

    // The persisted scalar is a useful conservative guard, but it cannot prove that an
    // arbitrary HR-derived child metric is the exact value reconciled upstream.
    if (measurement.summaryCompatibility !== 'verified_same_effective_trace') {
        return 'SUMMARY_LINEAGE_UNVERIFIED';
    }
    return 'INPUT_LINEAGE_UNVERIFIED';
}

/**
 * Shadow-only HR evidence authority. No live consumer invokes this until HRF6/HRF9.
 *
 * The optional context is intentionally fail-closed. High trace confidence alone does
 * not prove the validity of a selected interval, peak, threshold protocol, or child
 * metric lineage, and it does not independently corroborate a health anomaly.
 */
export function getHrUseAuthority(
    activity: NormalizedGarminActivity,
    useCase: HrUseCase,
    context: HrUseAuthorityContext = {},
): HrUseAuthority {
    const policy = USE_CASE_POLICY[useCase];
    const measurement = activity.hrMeasurement;
    if (!measurement) return result(policy.unavailableStatus, 'MEASUREMENT_UNAVAILABLE');

    let status = policy.confidence[measurement.measurementConfidence];
    const reasons: HrAuthorityReason[] = [];
    const baseReason = confidenceReason(measurement.measurementConfidence, status);
    if (baseReason) reasons.push(baseReason);

    const confidenceTooWeakForContext =
        measurement.measurementConfidence === 'low'
        || measurement.measurementConfidence === 'unreliable'
        || measurement.measurementConfidence === 'unknown';

    // Preserve peak-specific evidence even when HRF3 has already downgraded the global
    // confidence because of the same spike. This keeps the authority result explainable.
    if (useCase === 'MAX_HR_UPDATE' && measurement.artifactFlags.includes('ISOLATED_SPIKE')) {
        reasons.push('PEAK_ARTIFACT');
        status = 'BLOCKED';
    }

    if (confidenceTooWeakForContext) return result(status, ...reasons);

    const block = (reason: HrAuthorityReason): void => {
        reasons.push(reason);
        status = 'BLOCKED';
    };

    if (policy.requiresInputLineage) {
        const lineageReason = inputLineageReason(measurement, context);
        if (lineageReason) block(lineageReason);
    }
    if (policy.requiresSegmentContext && context.segmentContextVerified !== true) {
        block('SEGMENT_CONTEXT_UNVERIFIED');
    }
    if (policy.requiresPeakContext && context.peakContextVerified !== true) {
        block('PEAK_CONTEXT_UNVERIFIED');
    }
    if (policy.requiresThresholdProtocol && context.thresholdProtocolVerified !== true) {
        block('THRESHOLD_PROTOCOL_UNVERIFIED');
    }
    if (policy.requiresHealthCorroboration && context.healthAnomalyCorroborated !== true) {
        reasons.push('HEALTH_CORROBORATION_REQUIRED');
        if (status === 'ALLOWED') status = 'OBSERVATIONAL';
    }

    return result(status, ...reasons);
}
