import { describe, expect, it } from 'vitest';
import {
    deriveEffectiveIdentityDecision,
    findEffectiveReviewEvent,
    type AutomaticIdentityAssessment,
    type IdentityReviewEvent,
} from './identityModels';

function assessment(
    automaticStatus: AutomaticIdentityAssessment['automaticStatus'] = 'UNCERTAIN',
): AutomaticIdentityAssessment {
    return {
        id: 'assessment-1',
        sourceNightKey: '2026-08-27',
        sharedSource: { provider: 'shared_bed', transport: 'health_aggregator' },
        automaticStatus,
        identityScore: 0.5,
        confidenceTier: 'LOW',
        reasonCodes: [],
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-27T06:00:00.000Z',
        sharedBundleRef: {
            id: 'shared-1',
            provider: 'shared_bed',
            transport: 'health_aggregator',
            revision: 1,
            sourcePayloadHash: 'sha256:shared',
            lineageKey: 'shared:lineage',
        },
        anchorBundleRefs: [],
    };
}

function review(overrides: Partial<IdentityReviewEvent> = {}): IdentityReviewEvent {
    return {
        id: 'review-1',
        assessmentId: 'assessment-1',
        schemaVersion: 1,
        label: 'USER',
        occupancyAttestation: 'EXCLUSIVE',
        supersedesReviewEventId: null,
        recordedAt: '2026-08-27T08:00:00.000Z',
        source: 'user_ui',
        ...overrides,
    };
}

describe('identity review chain fail-closed resolution', () => {
    it('ignores an orphan rather than treating it as the effective head', () => {
        const orphan = review({ supersedesReviewEventId: 'missing-review' });
        expect(findEffectiveReviewEvent([orphan])).toBeNull();
        expect(deriveEffectiveIdentityDecision(assessment(), [orphan])).toMatchObject({
            effectiveStatus: 'UNCERTAIN',
            authority: 'AUTOMATIC',
        });
    });

    it('ignores a cyclic chain rather than falling back to a cyclic event', () => {
        const first = review({ id: 'review-1', supersedesReviewEventId: 'review-2' });
        const second = review({
            id: 'review-2',
            supersedesReviewEventId: 'review-1',
            recordedAt: '2026-08-27T09:00:00.000Z',
        });
        expect(findEffectiveReviewEvent([first, second])).toBeNull();
        expect(deriveEffectiveIdentityDecision(assessment(), [first, second]).effectiveStatus)
            .toBe('UNCERTAIN');
    });

    it('ignores non-monotonic and structurally invalid corrections', () => {
        const root = review({
            id: 'review-1',
            label: 'NOT_USER',
            occupancyAttestation: 'UNKNOWN',
        });
        const olderCorrection = review({
            id: 'review-2',
            supersedesReviewEventId: 'review-1',
            recordedAt: '2026-08-27T07:00:00.000Z',
        });
        const invalidCorrection = review({
            id: 'review-3',
            schemaVersion: 2,
            supersedesReviewEventId: 'review-1',
            recordedAt: '2026-08-27T09:00:00.000Z',
        });
        expect(findEffectiveReviewEvent([root, olderCorrection, invalidCorrection])?.id).toBe('review-1');
    });

    it('keeps admin USER identity separate from MIXED occupancy eligibility', () => {
        const mixed = review({ source: 'admin_replay', occupancyAttestation: 'MIXED' });
        const decision = deriveEffectiveIdentityDecision(assessment(), [mixed]);
        expect(decision.effectiveStatus).toBe('USER');
        expect(decision.eligibility.baselineLearning).toBe(false);
        expect(decision.eligibility.passportLearning).toBe(false);
    });

    it('rejects a user-ui USER review without the exclusive attestation required by rules', () => {
        const invalidUserReview = review({ occupancyAttestation: 'MIXED' });
        expect(findEffectiveReviewEvent([invalidUserReview])).toBeNull();
    });

    it('drops duplicate review IDs so ambiguous evidence cannot authorize USER', () => {
        const duplicateA = review({ id: 'duplicate', label: 'USER' });
        const duplicateB = review({
            id: 'duplicate',
            label: 'NOT_USER',
            occupancyAttestation: 'UNKNOWN',
        });
        expect(findEffectiveReviewEvent([duplicateA, duplicateB])).toBeNull();
        expect(deriveEffectiveIdentityDecision(assessment(), [duplicateA, duplicateB]).effectiveStatus)
            .toBe('UNCERTAIN');
    });
});
