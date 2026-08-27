import { describe, expect, it } from 'vitest';
import {
    deriveEffectiveIdentityDecision,
    type AutomaticIdentityAssessment,
    type IdentityReviewEvent,
} from '../observations/identityModels';
import type { HealthObservationDayBundle } from '../observations/models';
import {
    healthObservationBundleId,
    selectEligibleHealthObservationBundles,
    type EffectiveBundleIdentityProjection,
} from './identityEligibility';
import { computeSourceMetricBaseline } from './multisourceBaselines';

const IDENTITY_POLICY = {
    identityRequiredSources: [{ provider: 'shared_bed', transport: 'health_aggregator' }],
};

function bundle(overrides: Partial<HealthObservationDayBundle> = {}): HealthObservationDayBundle {
    return {
        userId: 'user-1',
        logicalDate: '2026-08-27',
        provider: 'shared_bed',
        transport: 'health_aggregator',
        observations: [{ observationId: 'obs-1', metric: 'hrv_rmssd_ms', value: 60 }],
        sourcePayloadHash: 'sha256:shared',
        schemaVersion: 1,
        normalizerVersion: 1,
        revision: 1,
        ingestedAt: '2026-08-27T06:00:00Z',
        effectiveAt: '2026-08-27T06:00:00Z',
        ...overrides,
    };
}

function review(
    assessmentId: string,
    overrides: Partial<IdentityReviewEvent> = {},
): IdentityReviewEvent {
    return {
        id: `review-${assessmentId}`,
        assessmentId,
        schemaVersion: 1,
        label: 'USER',
        occupancyAttestation: 'EXCLUSIVE',
        supersedesReviewEventId: null,
        recordedAt: '2026-08-27T08:00:00Z',
        source: 'user_ui',
        ...overrides,
    };
}

function projection(
    sourceBundle: HealthObservationDayBundle,
    overrides: {
        automaticStatus?: AutomaticIdentityAssessment['automaticStatus'];
        reasonCodes?: AutomaticIdentityAssessment['reasonCodes'];
        reviewEvents?: readonly IdentityReviewEvent[];
        assessmentId?: string;
    } = {},
): EffectiveBundleIdentityProjection {
    const assessmentId = overrides.assessmentId ?? `assessment-${sourceBundle.logicalDate}`;
    const assessment: AutomaticIdentityAssessment = {
        id: assessmentId,
        sourceNightKey: sourceBundle.logicalDate,
        sharedSource: {
            provider: sourceBundle.provider,
            transport: sourceBundle.transport,
        },
        automaticStatus: overrides.automaticStatus ?? 'USER',
        identityScore: 0.95,
        confidenceTier: 'HIGH',
        reasonCodes: overrides.reasonCodes ?? ['SESSION_TIMING_CONCORDANT'],
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-27T06:30:00Z',
        sharedBundleRef: {
            id: healthObservationBundleId(sourceBundle),
            provider: sourceBundle.provider,
            transport: sourceBundle.transport,
            revision: sourceBundle.revision,
            sourcePayloadHash: sourceBundle.sourcePayloadHash,
            lineageKey: 'shared-bed:side:a',
        },
        anchorBundleRefs: [],
    };
    return {
        assessment,
        decision: deriveEffectiveIdentityDecision(assessment, overrides.reviewEvents ?? []),
    };
}

function baseline(
    bundles: readonly HealthObservationDayBundle[],
    projections: readonly EffectiveBundleIdentityProjection[],
) {
    return computeSourceMetricBaseline({
        bundles,
        userId: 'user-1',
        effectiveIdentityProjections: projections,
        identityPolicy: IDENTITY_POLICY,
        metric: 'hrv_rmssd_ms',
        provider: 'shared_bed',
        transport: 'health_aggregator',
        referenceDate: '2026-08-28',
    });
}

describe('identityEligibility (PI5, ADR-0028 D-PID-PREBASE)', () => {
    it('fails closed when a configured shared-source bundle has no effective decision', () => {
        const sourceBundle = bundle();
        expect(
            selectEligibleHealthObservationBundles({
                bundles: [sourceBundle],
                userId: 'user-1',
                effectiveIdentityProjections: [],
                identityPolicy: IDENTITY_POLICY,
                requireEligibility: 'baselineLearning',
            }),
        ).toEqual([]);
        expect(baseline([sourceBundle], []).count28d).toBe(0);
    });

    it('does not require identity assessments for sources not configured as shared', () => {
        const personal = bundle({
            provider: 'personal_watch',
            transport: 'watch_direct',
            sourcePayloadHash: 'sha256:personal',
        });
        const selected = selectEligibleHealthObservationBundles({
            bundles: [personal],
            userId: 'user-1',
            effectiveIdentityProjections: [],
            identityPolicy: IDENTITY_POLICY,
            requireEligibility: 'baselineLearning',
        });

        expect(selected).toEqual([personal]);
    });

    it('UNCERTAIN and NOT_USER nights never change the shared-source baseline', () => {
        const uncertainBundle = bundle({ logicalDate: '2026-08-26', sourcePayloadHash: 'sha256:u' });
        const notUserBundle = bundle({ logicalDate: '2026-08-27', sourcePayloadHash: 'sha256:n' });
        const uncertainProjection = projection(uncertainBundle, {
            automaticStatus: 'UNCERTAIN',
        });
        const notUserAssessmentId = 'assessment-not-user';
        const notUserProjection = projection(notUserBundle, {
            automaticStatus: 'UNCERTAIN',
            assessmentId: notUserAssessmentId,
            reviewEvents: [
                review(notUserAssessmentId, {
                    label: 'NOT_USER',
                    occupancyAttestation: 'UNKNOWN',
                }),
            ],
        });

        const result = baseline(
            [uncertainBundle, notUserBundle],
            [uncertainProjection, notUserProjection],
        );
        expect(result.count28d).toBe(0);
        expect(result.median28d).toBeNull();
    });

    it('manual USER + EXCLUSIVE can enter baseline learning', () => {
        const sourceBundle = bundle();
        const assessmentId = 'assessment-exclusive';
        const effectiveProjection = projection(sourceBundle, {
            automaticStatus: 'UNCERTAIN',
            assessmentId,
            reviewEvents: [review(assessmentId)],
        });

        const result = baseline([sourceBundle], [effectiveProjection]);
        expect(result.count28d).toBe(1);
        expect(result.median28d).toBe(60);
    });

    it('manual USER + MIXED remains baseline-ineligible for a suspected mixed night', () => {
        const sourceBundle = bundle();
        const assessmentId = 'assessment-mixed';
        const mixedProjection = projection(sourceBundle, {
            automaticStatus: 'UNCERTAIN',
            reasonCodes: ['MIXED_OCCUPANCY_SUSPECTED'],
            assessmentId,
            reviewEvents: [
                review(assessmentId, {
                    label: 'USER',
                    occupancyAttestation: 'MIXED',
                }),
            ],
        });

        expect(mixedProjection.decision.effectiveStatus).toBe('USER');
        expect(mixedProjection.decision.eligibility.baselineLearning).toBe(false);
        expect(baseline([sourceBundle], [mixedProjection]).count28d).toBe(0);
    });

    it('keeps an unusual but identity-concordant USER night eligible', () => {
        const anomalous = bundle({
            observations: [{ observationId: 'obs-anomaly', metric: 'hrv_rmssd_ms', value: 5 }],
        });
        const result = baseline([anomalous], [projection(anomalous)]);

        expect(result.count28d).toBe(1);
        expect(result.median28d).toBe(5);
    });

    it('rejects stale bundle revision/hash projections and ambiguous duplicate projections', () => {
        const sourceBundle = bundle();
        const stale = projection(
            bundle({ revision: 0, sourcePayloadHash: 'sha256:stale' }),
        );
        const exact = projection(sourceBundle);
        const duplicate = projection(sourceBundle, { assessmentId: 'assessment-duplicate' });

        expect(baseline([sourceBundle], [stale]).count28d).toBe(0);
        expect(baseline([sourceBundle], [exact, duplicate]).count28d).toBe(0);
    });

    it('filters bundles from another user before any baseline calculation', () => {
        const foreign = bundle({ userId: 'user-2' });
        expect(baseline([foreign], [projection(foreign)]).count28d).toBe(0);
    });
});
