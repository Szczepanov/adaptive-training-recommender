import type { NormalizedGarminActivity } from './models';
import { getHrUseAuthority } from './activityHrFidelity';
import { normalizeModality } from './performedTrainingFacts';

export const COMPARABLE_DURATION_MAX_RATIO = 1.25;
export const STEADY_MAX_VARIABILITY_INDEX = 1.05;

export type Confidence = 'high' | 'moderate' | 'low';
export type ThresholdProvenance = 'same' | 'changed' | 'unknown';
export type ResponseFeatureFamily =
    | 'interval_response'
    | 'cycling_steady_power_hr'
    | 'running_steady_pace_hr'
    | 'strength_set_response'
    | 'next_day_response';
export type ComparisonState = 'comparable' | 'not_comparable' | 'insufficient_evidence';
export type ComparisonMatchBasis =
    | 'exact_prescription_identity'
    | 'authored_protocol_family'
    | 'semantic_protocol_match'
    | 'controlled_steady_match'
    | 'provider_fallback';

export interface ResponseSessionIdentity {
    performedOccurrenceId?: string;
    prescriptionHash?: string;
    protocolFamily?: string;
    sourceCompleteness?: 'canonical' | 'provider_fallback' | 'partial' | 'ambiguous' | 'unavailable';
}

export interface ComparableSession {
    activity?: NormalizedGarminActivity;
    identity?: ResponseSessionIdentity;
}

export interface ComparisonDecision {
    state: ComparisonState;
    featureFamily: ResponseFeatureFamily;
    matchBasis?: ComparisonMatchBasis;
    hardRejections: string[];
    limitations: string[];
    provenance: {
        occurrenceIdentity: 'distinct' | 'same' | 'unknown';
        protocolIdentity: 'exact' | 'family' | 'provider_fingerprint' | 'semantic' | 'unknown';
        measurementSensorEvidence: 'sufficient' | 'missing' | 'observational';
        thresholdUnitEvidence: ThresholdProvenance | 'not_required';
        venueEnvironmentEvidence: 'known' | 'unknown';
        sourceCompleteness: 'canonical' | 'provider_fallback' | 'partial' | 'ambiguous' | 'unavailable';
    };
    confidenceCeiling?: Confidence;
}

const STEADY_DOMAINS = new Set(['endurance', 'recovery']);
const WITHHOLDING_HR_REASONS = new Set(['MEASUREMENT_UNRELIABLE', 'LOW_MEASUREMENT_CONFIDENCE', 'SUMMARY_LINEAGE_DISCORDANT']);

function measurementSensorEvidence(
    a: NormalizedGarminActivity | undefined,
    b: NormalizedGarminActivity | undefined,
): ComparisonDecision['provenance']['measurementSensorEvidence'] {
    if (!a || !b || a.normalizedPower === undefined || b.normalizedPower === undefined
        || a.normalizedPower <= 0 || b.normalizedPower <= 0
        || a.averageHr === null || b.averageHr === null || a.averageHr <= 0 || b.averageHr <= 0) {
        return 'missing';
    }
    const authorities = [a, b].map(activity => getHrUseAuthority(activity, 'AEROBIC_DECOUPLING'));
    if (authorities.some(authority => authority.reasons.some(reason => WITHHOLDING_HR_REASONS.has(reason)))) {
        return 'missing';
    }
    return authorities.every(authority => authority.status === 'ALLOWED' || authority.status === 'BOUNDED')
        ? 'sufficient'
        : 'observational';
}

export function thresholdProvenance(a: NormalizedGarminActivity, b: NormalizedGarminActivity): ThresholdProvenance {
    const signature = (activity: NormalizedGarminActivity) => {
        const bounds = (activity.powerInZones ?? [])
            .filter(zone => zone.lowBoundary !== undefined)
            .sort((x, y) => x.zoneNumber - y.zoneNumber)
            .map(zone => String(zone.zoneNumber) + ':' + String(Math.round(zone.lowBoundary as number)));
        return bounds.length > 0 ? bounds.join(',') : null;
    };
    const left = signature(a);
    const right = signature(b);
    if (left === null || right === null) return 'unknown';
    return left === right ? 'same' : 'changed';
}

function matchBasis(current: ComparableSession, prior: ComparableSession): ComparisonMatchBasis {
    if (current.identity?.prescriptionHash && current.identity.prescriptionHash === prior.identity?.prescriptionHash) {
        return 'exact_prescription_identity';
    }
    if (current.identity?.protocolFamily && current.identity.protocolFamily === prior.identity?.protocolFamily) {
        return 'authored_protocol_family';
    }
    if (current.activity?.fitWorkoutFingerprint
        && current.activity.fitWorkoutFingerprint === prior.activity?.fitWorkoutFingerprint) {
        return 'provider_fallback';
    }
    return 'controlled_steady_match';
}

function decision(
    state: ComparisonState,
    current: ComparableSession,
    prior: ComparableSession,
    hardRejections: string[] = [],
    featureFamily: ResponseFeatureFamily = 'cycling_steady_power_hr',
): ComparisonDecision {
    const a = current.activity;
    const b = prior.activity;
    const threshold = a && b ? thresholdProvenance(a, b) : 'not_required';
    const basis = state === 'comparable' ? matchBasis(current, prior) : undefined;
    const sourceCompleteness: ComparisonDecision['provenance']['sourceCompleteness'] = !a || !b
        || current.identity?.sourceCompleteness === 'unavailable' || prior.identity?.sourceCompleteness === 'unavailable' ? 'unavailable'
        : current.identity?.sourceCompleteness === 'ambiguous' || prior.identity?.sourceCompleteness === 'ambiguous' ? 'ambiguous'
            : current.identity?.sourceCompleteness === 'partial' || prior.identity?.sourceCompleteness === 'partial' ? 'partial'
                : current.identity?.sourceCompleteness === 'canonical' && prior.identity?.sourceCompleteness === 'canonical' ? 'canonical'
                    : 'provider_fallback';
    const measurement = measurementSensorEvidence(a, b);
    const limits: string[] = [];
    if (threshold === 'unknown') limits.push('power-zone threshold signature unknown');
    if (measurement === 'observational') limits.push('measurement/sensor authority observational');
    // No current provider activity exposes stable venue/environment evidence. Matching
    // duration or a device fingerprint therefore cannot earn high confidence alone.
    limits.push('venue/environment context unknown');
    const decision: ComparisonDecision = {
        state,
        featureFamily,
        ...(basis ? { matchBasis: basis } : {}),
        hardRejections,
        limitations: limits,
        provenance: {
            occurrenceIdentity: current.identity?.performedOccurrenceId && prior.identity?.performedOccurrenceId
                ? current.identity.performedOccurrenceId === prior.identity.performedOccurrenceId ? 'same' : 'distinct'
                : 'unknown',
            protocolIdentity: basis === 'exact_prescription_identity' ? 'exact'
                : basis === 'authored_protocol_family' ? 'family'
                    : basis === 'provider_fallback' ? 'provider_fingerprint'
                        : basis === 'semantic_protocol_match' ? 'semantic' : 'unknown',
            measurementSensorEvidence: measurement,
            thresholdUnitEvidence: threshold,
            venueEnvironmentEvidence: 'unknown',
            sourceCompleteness,
        },
        ...(state === 'comparable'
            ? {
                confidenceCeiling: threshold !== 'same'
                    || sourceCompleteness !== 'canonical'
                    || measurement !== 'sufficient'
                    ? 'low'
                    : 'moderate',
            }
            : {}),
    };
    return decision;
}

/** Central longitudinal decision for response features. Session-level measurement
 * derivation remains feature-owned; cross-session eligibility and confidence do not. */
export function decideSessionComparability(input: {
    featureFamily: ResponseFeatureFamily;
    current: ComparableSession;
    prior: ComparableSession;
    priorIneligibility?: readonly string[];
}): ComparisonDecision {
    const { current, prior, featureFamily } = input;
    const a = current.activity;
    const b = prior.activity;
    if (current.identity?.performedOccurrenceId
        && current.identity.performedOccurrenceId === prior.identity?.performedOccurrenceId) {
        return decision('not_comparable', current, prior, ['same performed occurrence'], featureFamily);
    }
    if (!a || !b) return decision('insufficient_evidence', current, prior, ['activity evidence unavailable'], featureFamily);
    if (current.identity?.sourceCompleteness === 'ambiguous' || prior.identity?.sourceCompleteness === 'ambiguous') {
        return decision('insufficient_evidence', current, prior, ['multiple provider sources lack a primary selection'], featureFamily);
    }
    if (current.identity?.sourceCompleteness === 'partial' || prior.identity?.sourceCompleteness === 'partial'
        || current.identity?.sourceCompleteness === 'unavailable' || prior.identity?.sourceCompleteness === 'unavailable') {
        return decision('insufficient_evidence', current, prior, ['comparison source graph is incomplete'], featureFamily);
    }
    if (featureFamily !== 'cycling_steady_power_hr') {
        return decision('insufficient_evidence', current, prior, [featureFamily + ' comparison is not wired yet'], featureFamily);
    }
    if (a.type !== b.type) return decision('not_comparable', current, prior, ['different activity type (' + b.type + ')'], featureFamily);
    if (normalizeModality(a.type) !== 'Cycling') {
        return decision('not_comparable', current, prior, ['not a cycling session'], featureFamily);
    }
    for (const [side, activity] of [['current', a], ['prior', b]] as const) {
        if (!STEADY_DOMAINS.has(activity.stimulusDomain ?? 'unknown')) {
            return decision(side === 'prior' ? 'not_comparable' : 'insufficient_evidence', current, prior,
                [side + ' stimulus classified ' + (activity.stimulusDomain ?? 'unknown') + ', not steady endurance'], featureFamily);
        }
        if (activity.variabilityIndex === undefined) {
            return decision('insufficient_evidence', current, prior, [side + ' variability index not reported'], featureFamily);
        }
        if (activity.variabilityIndex > STEADY_MAX_VARIABILITY_INDEX) {
            return decision('not_comparable', current, prior,
                [side + ' variable power (VI ' + String(Math.round(activity.variabilityIndex * 100) / 100) + ')'], featureFamily);
        }
    }
    if (input.priorIneligibility?.length) {
        const reason = input.priorIneligibility[0];
        const ineligibleMatch = reason === 'not a cycling session'
            || reason.startsWith('stimulus classified')
            || reason.startsWith('variable power');
        return decision(ineligibleMatch ? 'not_comparable' : 'insufficient_evidence', current, prior, [reason], featureFamily);
    }
    const measurements = measurementSensorEvidence(a, b);
    if (measurements === 'missing') {
        return decision('insufficient_evidence', current, prior, ['power or HR evidence unavailable or withheld'], featureFamily);
    }
    if ((a.stimulusDomain ?? 'unknown') !== (b.stimulusDomain ?? 'unknown')) {
        return decision('not_comparable', current, prior, ['different stimulus (' + (b.stimulusDomain ?? 'unknown') + ')'], featureFamily);
    }
    const currentDuration = a.durationMin ?? 0;
    const priorDuration = b.durationMin ?? 0;
    if (currentDuration <= 0 || priorDuration <= 0
        || Math.max(currentDuration, priorDuration) / Math.min(currentDuration, priorDuration) > COMPARABLE_DURATION_MAX_RATIO) {
        return decision('not_comparable', current, prior, [
            'different protocol duration (' + String(Math.round(priorDuration)) + ' vs ' + String(Math.round(currentDuration)) + ' min)',
        ], featureFamily);
    }
    const threshold = thresholdProvenance(a, b);
    if (threshold === 'changed') {
        return decision('not_comparable', current, prior, ['power-zone (FTP) definition changed between sessions'], featureFamily);
    }
    return decision('comparable', current, prior, [], featureFamily);
}
