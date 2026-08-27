/** Replay-oriented identity provenance for ADR-0010 recommendation audits (PI6/ADR-0028). */

import type {
    AutomaticIdentityAssessment,
    EffectiveIdentityDecision,
    IdentityDecisionProvenance,
    IdentityReasonCode,
} from '../observations/identityModels';

export function buildIdentityDecisionProvenance(params: {
    assessment: AutomaticIdentityAssessment;
    decision: EffectiveIdentityDecision;
    selectedEffectiveSource: { provider: string; transport: string } | null;
    fallbackReason: IdentityReasonCode | null;
}): IdentityDecisionProvenance {
    if (params.decision.assessmentId !== params.assessment.id) {
        throw new Error('Effective identity decision does not belong to the supplied assessment');
    }
    if (
        params.decision.effectiveStatus !== 'USER' &&
        params.selectedEffectiveSource?.provider === params.assessment.sharedSource.provider &&
        params.selectedEffectiveSource.transport === params.assessment.sharedSource.transport
    ) {
        throw new Error('An identity-ineligible shared source cannot be selected as effective evidence');
    }

    return {
        identityAssessmentId: params.assessment.id,
        automaticStatus: params.assessment.automaticStatus,
        effectiveStatus: params.decision.effectiveStatus,
        reviewEventId: params.decision.reviewEventId ?? null,
        identityPolicyVersion: params.assessment.policyVersion,
        featureSchemaVersion: params.assessment.featureSchemaVersion,
        passportVersion: params.assessment.passportVersion,
        sharedBundleRef: { ...params.assessment.sharedBundleRef },
        anchorBundleRefs: params.assessment.anchorBundleRefs.map((ref) => ({ ...ref })),
        selectedEffectiveSource: params.selectedEffectiveSource
            ? { ...params.selectedEffectiveSource }
            : null,
        fallbackReason: params.fallbackReason,
    };
}

export function identityDecisionProvenanceReplayErrors(
    provenance: IdentityDecisionProvenance | undefined,
): string[] {
    if (!provenance) return [];
    const errors: string[] = [];
    if (!provenance.identityAssessmentId) errors.push('Identity assessment ID is missing.');
    if (!provenance.identityPolicyVersion) errors.push('Identity policy version is missing.');
    if (!provenance.featureSchemaVersion) errors.push('Identity feature schema version is missing.');
    if (provenance.sharedBundleRef.revision < 1) errors.push('Shared identity bundle revision is invalid.');
    if (!provenance.sharedBundleRef.sourcePayloadHash) errors.push('Shared identity bundle hash is missing.');
    if (!provenance.sharedBundleRef.lineageKey) errors.push('Shared identity bundle lineage is missing.');
    if (
        provenance.anchorBundleRefs.length === 0 &&
        provenance.fallbackReason !== 'ANCHOR_MISSING'
    ) {
        errors.push('Identity audit has no anchor bundle evidence.');
    }
    for (const ref of provenance.anchorBundleRefs) {
        if (ref.revision < 1 || !ref.sourcePayloadHash || !ref.lineageKey) {
            errors.push(`Identity anchor bundle ${ref.id} has incomplete replay metadata.`);
        }
    }
    if (
        provenance.automaticStatus !== provenance.effectiveStatus &&
        provenance.reviewEventId === null
    ) {
        errors.push('Effective identity differs from automatic identity without a review event.');
    }
    if (
        provenance.effectiveStatus !== 'USER' &&
        provenance.selectedEffectiveSource?.provider === provenance.sharedBundleRef.provider &&
        provenance.selectedEffectiveSource.transport === provenance.sharedBundleRef.transport
    ) {
        errors.push('Identity-ineligible shared source was recorded as effective evidence.');
    }
    return errors;
}
