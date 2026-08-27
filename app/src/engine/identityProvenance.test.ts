import { describe, expect, it } from 'vitest';
import type {
    AutomaticIdentityAssessment,
    EffectiveIdentityDecision,
} from '../observations/identityModels';
import {
    buildIdentityDecisionProvenance,
    identityDecisionProvenanceReplayErrors,
} from './identityProvenance';

function assessment(
    overrides: Partial<AutomaticIdentityAssessment> = {},
): AutomaticIdentityAssessment {
    return {
        id: 'assessment-2026-08-27',
        sourceNightKey: '2026-08-27',
        sharedSource: { provider: 'eight_sleep', transport: 'google_health' },
        automaticStatus: 'UNCERTAIN',
        identityScore: 0.73,
        confidenceTier: 'MODERATE',
        reasonCodes: ['SESSION_TIMING_DISCORDANT'],
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-27T06:00:00.000Z',
        sharedBundleRef: {
            id: '2026-08-27_eight_sleep_google_health',
            provider: 'eight_sleep',
            transport: 'google_health',
            revision: 2,
            sourcePayloadHash: 'sha256:shared',
            lineageKey: 'eight_sleep:pod-side:a',
        },
        anchorBundleRefs: [{
            id: '2026-08-27_garmin_garmin_direct',
            provider: 'garmin',
            transport: 'garmin_direct',
            revision: 1,
            sourcePayloadHash: 'sha256:anchor',
            lineageKey: 'garmin:device:athlete',
        }],
        ...overrides,
    };
}

function decision(
    overrides: Partial<EffectiveIdentityDecision> = {},
): EffectiveIdentityDecision {
    return {
        assessmentId: 'assessment-2026-08-27',
        effectiveStatus: 'USER',
        eligibility: {
            display: true,
            recovery: true,
            baselineLearning: true,
            passportLearning: true,
        },
        authority: 'MANUAL_REVIEW',
        reviewEventId: 'review-1',
        ...overrides,
    };
}

describe('identity recommendation provenance (PI6)', () => {
    it('captures every automatic/effective decision and bundle replay input', () => {
        const provenance = buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision(),
            selectedEffectiveSource: { provider: 'eight_sleep', transport: 'google_health' },
            fallbackReason: null,
        });

        expect(provenance).toEqual(expect.objectContaining({
            identityAssessmentId: 'assessment-2026-08-27',
            automaticStatus: 'UNCERTAIN',
            effectiveStatus: 'USER',
            reviewEventId: 'review-1',
            identityPolicyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            passportVersion: '2026-08-27.1',
        }));
        expect(provenance.sharedBundleRef.revision).toBe(2);
        expect(provenance.anchorBundleRefs).toHaveLength(1);
        expect(identityDecisionProvenanceReplayErrors(provenance)).toEqual([]);
    });

    it('rejects an effective decision belonging to another assessment', () => {
        expect(() => buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision({ assessmentId: 'another-assessment' }),
            selectedEffectiveSource: null,
            fallbackReason: 'SESSION_TIMING_DISCORDANT',
        })).toThrow('does not belong');
    });

    it('never records a non-USER shared source as selected effective evidence', () => {
        expect(() => buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision({
                effectiveStatus: 'UNCERTAIN',
                authority: 'AUTOMATIC',
                reviewEventId: undefined,
            }),
            selectedEffectiveSource: { provider: 'eight_sleep', transport: 'google_health' },
            fallbackReason: 'SESSION_TIMING_DISCORDANT',
        })).toThrow('identity-ineligible shared source');
    });

    it('allows an empty anchor list only for an explicit ANCHOR_MISSING fallback', () => {
        const missingAnchor = buildIdentityDecisionProvenance({
            assessment: assessment({
                anchorBundleRefs: [],
                reasonCodes: ['ANCHOR_MISSING'],
            }),
            decision: decision({
                effectiveStatus: 'UNCERTAIN',
                authority: 'AUTOMATIC',
                reviewEventId: undefined,
            }),
            selectedEffectiveSource: { provider: 'garmin', transport: 'garmin_direct' },
            fallbackReason: 'ANCHOR_MISSING',
        });
        expect(identityDecisionProvenanceReplayErrors(missingAnchor)).toEqual([]);

        expect(identityDecisionProvenanceReplayErrors({
            ...missingAnchor,
            fallbackReason: 'ANCHOR_QUALITY_INSUFFICIENT',
        })).toContain('Identity audit has no anchor bundle evidence.');
    });

    it('makes passport-version and bundle-lineage changes visible to replay checks', () => {
        const provenance = buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision(),
            selectedEffectiveSource: null,
            fallbackReason: null,
        });
        const changedPassport = { ...provenance, passportVersion: '2026-08-28.1' };
        expect(changedPassport).not.toEqual(provenance);
        expect(identityDecisionProvenanceReplayErrors({
            ...provenance,
            anchorBundleRefs: [{ ...provenance.anchorBundleRefs[0], lineageKey: '' }],
        })).toContain('Identity anchor bundle 2026-08-27_garmin_garmin_direct has incomplete replay metadata.');
    });

    it('rejects a shared bundle reference with an empty id', () => {
        const provenance = buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision(),
            selectedEffectiveSource: null,
            fallbackReason: null,
        });
        expect(identityDecisionProvenanceReplayErrors({
            ...provenance,
            sharedBundleRef: { ...provenance.sharedBundleRef, id: '' },
        })).toContain('Shared identity bundle ID is missing.');
    });

    it('rejects an anchor bundle reference with an empty id', () => {
        const provenance = buildIdentityDecisionProvenance({
            assessment: assessment(),
            decision: decision(),
            selectedEffectiveSource: null,
            fallbackReason: null,
        });
        expect(identityDecisionProvenanceReplayErrors({
            ...provenance,
            anchorBundleRefs: [{ ...provenance.anchorBundleRefs[0], id: '' }],
        })).toContain('Identity anchor bundle  has incomplete replay metadata.');
    });
});
