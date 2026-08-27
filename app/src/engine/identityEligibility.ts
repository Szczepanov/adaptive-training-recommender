/**
 * Pre-baseline effective-identity eligibility boundary (PI5, ADR-0028 D-PID-PREBASE).
 *
 * Raw health bundles stay preserved, but a configured shared source can enter recovery,
 * baseline, or passport learning only through an exact, replayable projection joining the
 * immutable automatic assessment to its derived EffectiveIdentityDecision. Missing, stale, or
 * ambiguous projections fail closed. Personal-device sources not configured as identity-gated
 * remain available without manufacturing identity assessments for them.
 */

import type {
    AutomaticIdentityAssessment,
    EffectiveIdentityDecision,
    ObservationEligibility,
} from '../observations/identityModels';
import type { HealthObservationDayBundle } from '../observations/models';

export interface IdentityRequiredSource {
    provider: string;
    transport: string;
}

export interface IdentityEligibilityPolicy {
    /** Provider-neutral deployment policy; no provider is intrinsically shared/personal here. */
    identityRequiredSources: readonly IdentityRequiredSource[];
}

export interface EffectiveBundleIdentityProjection {
    assessment: AutomaticIdentityAssessment;
    decision: EffectiveIdentityDecision;
}

export type IdentityEligibilityRequirement = Exclude<keyof ObservationEligibility, 'display'>;

export function healthObservationBundleId(bundle: HealthObservationDayBundle): string {
    return `${bundle.logicalDate}_${bundle.provider}_${bundle.transport}`;
}

function requiresIdentityDecision(
    bundle: HealthObservationDayBundle,
    policy: IdentityEligibilityPolicy,
): boolean {
    return policy.identityRequiredSources.some(
        (source) => source.provider === bundle.provider && source.transport === bundle.transport,
    );
}

function projectionMatchesBundle(
    bundle: HealthObservationDayBundle,
    projection: EffectiveBundleIdentityProjection,
): boolean {
    const { assessment, decision } = projection;
    return (
        decision.assessmentId === assessment.id &&
        assessment.sourceNightKey === bundle.logicalDate &&
        assessment.sharedSource.provider === bundle.provider &&
        assessment.sharedSource.transport === bundle.transport &&
        assessment.sharedBundleRef.id === healthObservationBundleId(bundle) &&
        assessment.sharedBundleRef.provider === bundle.provider &&
        assessment.sharedBundleRef.transport === bundle.transport &&
        assessment.sharedBundleRef.revision === bundle.revision &&
        assessment.sharedBundleRef.sourcePayloadHash === bundle.sourcePayloadHash
    );
}

/**
 * Selects an already-authorised projection for downstream computation. For an identity-gated
 * source, exactly one exact-bundle projection must resolve to effective USER and grant the
 * requested eligibility flag. This function never mutates or deletes the raw input bundles.
 */
export function selectEligibleHealthObservationBundles(params: {
    bundles: readonly HealthObservationDayBundle[];
    userId: string;
    effectiveIdentityProjections: readonly EffectiveBundleIdentityProjection[];
    identityPolicy: IdentityEligibilityPolicy;
    requireEligibility: IdentityEligibilityRequirement;
}): readonly HealthObservationDayBundle[] {
    return params.bundles.filter((bundle) => {
        if (bundle.userId !== params.userId) {
            return false;
        }
        if (!requiresIdentityDecision(bundle, params.identityPolicy)) {
            return true;
        }

        const matches = params.effectiveIdentityProjections.filter((projection) =>
            projectionMatchesBundle(bundle, projection),
        );
        if (matches.length !== 1) {
            return false;
        }

        const { decision } = matches[0];
        return decision.effectiveStatus === 'USER' && decision.eligibility[params.requireEligibility];
    });
}
