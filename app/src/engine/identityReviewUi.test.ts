import { describe, expect, it } from 'vitest';
import type { AutomaticIdentityAssessment, IdentityReasonCode, ObservationBundleRef } from '../observations/identityModels';
import type { EffectiveBundleIdentityProjection } from './identityEligibility';
import {
    identityReviewCopyVariant,
    identityReviewEventFields,
    needsSuspiciousNightReview,
    selectMostRecentSuspiciousNightForReview,
} from './identityReviewUi';

function bundleRef(id: string): ObservationBundleRef {
    return {
        id,
        provider: 'eight_sleep',
        transport: 'google_health',
        revision: 1,
        sourcePayloadHash: 'sha256:x',
        lineageKey: 'eight_sleep:pod-side:a',
    };
}

function assessment(overrides: Partial<AutomaticIdentityAssessment> = {}): AutomaticIdentityAssessment {
    return {
        id: 'assessment-1',
        sourceNightKey: '2026-08-20',
        sharedSource: { provider: 'eight_sleep', transport: 'google_health' },
        automaticStatus: 'UNCERTAIN',
        identityScore: 0.4,
        confidenceTier: 'LOW',
        reasonCodes: ['SESSION_TIMING_DISCORDANT'],
        passportVersion: '2026-08-20.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-20T06:00:00Z',
        sharedBundleRef: bundleRef('2026-08-20_eight_sleep_google_health'),
        anchorBundleRefs: [],
        ...overrides,
    };
}

function projection(overrides: Partial<AutomaticIdentityAssessment> = {}): EffectiveBundleIdentityProjection {
    const a = assessment(overrides);
    return {
        assessment: a,
        decision: {
            assessmentId: a.id,
            effectiveStatus: a.automaticStatus,
            eligibility: { display: true, recovery: false, baselineLearning: false, passportLearning: false },
            authority: 'AUTOMATIC',
        },
    };
}

describe('needsSuspiciousNightReview (PI7, ADR-0028)', () => {
    it('flags a discordant UNCERTAIN night', () => {
        expect(needsSuspiciousNightReview(assessment({ reasonCodes: ['RHR_RELATION_DISCORDANT'] }))).toBe(true);
    });

    it('flags a missing-anchor UNCERTAIN night', () => {
        expect(needsSuspiciousNightReview(assessment({ reasonCodes: ['ANCHOR_MISSING'] }))).toBe(true);
    });

    it('flags a suspected mixed-occupancy UNCERTAIN night', () => {
        expect(needsSuspiciousNightReview(assessment({ reasonCodes: ['MIXED_OCCUPANCY_SUSPECTED'] }))).toBe(true);
    });

    it('does not flag an UNCERTAIN night that only lacks passport maturity', () => {
        expect(needsSuspiciousNightReview(assessment({ reasonCodes: ['INSUFFICIENT_PASSPORT_HISTORY'] }))).toBe(false);
    });

    it('does not flag an UNCERTAIN night whose only issue is pairing ambiguity', () => {
        expect(needsSuspiciousNightReview(assessment({ reasonCodes: ['MULTIPLE_PAIRING_CANDIDATES'] }))).toBe(false);
    });

    it('does not flag an automatic USER night even with a concordant reason code', () => {
        expect(
            needsSuspiciousNightReview(
                assessment({ automaticStatus: 'USER', reasonCodes: ['SESSION_TIMING_CONCORDANT'] }),
            ),
        ).toBe(false);
    });
});

describe('identityReviewCopyVariant (PI7, ADR-0028)', () => {
    it('prefers ANCHOR_MISSING copy over other codes', () => {
        expect(
            identityReviewCopyVariant(['ANCHOR_MISSING', 'SESSION_TIMING_DISCORDANT'] as IdentityReasonCode[]),
        ).toBe('ANCHOR_MISSING');
    });

    it('falls back to ANCHOR_QUALITY_INSUFFICIENT copy when present without ANCHOR_MISSING', () => {
        expect(
            identityReviewCopyVariant(['ANCHOR_QUALITY_INSUFFICIENT', 'RHR_RELATION_DISCORDANT']),
        ).toBe('ANCHOR_QUALITY_INSUFFICIENT');
    });

    it('uses the default discordant-evidence copy otherwise', () => {
        expect(identityReviewCopyVariant(['MIXED_OCCUPANCY_SUSPECTED'])).toBe('DEFAULT');
    });
});

describe('selectMostRecentSuspiciousNightForReview (PI7, ADR-0028)', () => {
    it('returns null when nothing needs review', () => {
        const projections = [projection({ reasonCodes: ['INSUFFICIENT_PASSPORT_HISTORY'] })];
        expect(selectMostRecentSuspiciousNightForReview(projections)).toBeNull();
    });

    it('picks the most recent candidate by sourceNightKey', () => {
        const older = projection({ sourceNightKey: '2026-08-18', reasonCodes: ['RHR_RELATION_DISCORDANT'] });
        const newer = projection({ sourceNightKey: '2026-08-20', reasonCodes: ['ANCHOR_MISSING'] });
        const notCandidate = projection({ sourceNightKey: '2026-08-21', reasonCodes: ['INSUFFICIENT_PASSPORT_HISTORY'] });
        const result = selectMostRecentSuspiciousNightForReview([older, newer, notCandidate]);
        expect(result?.assessment.sourceNightKey).toBe('2026-08-20');
    });
});

describe('identityReviewEventFields (PI7, ADR-0028)', () => {
    it('maps Only me to USER + EXCLUSIVE', () => {
        expect(identityReviewEventFields('ONLY_ME')).toEqual({ label: 'USER', occupancyAttestation: 'EXCLUSIVE' });
    });

    it('maps Shared / mixed to UNCERTAIN + MIXED', () => {
        expect(identityReviewEventFields('SHARED_MIXED')).toEqual({ label: 'UNCERTAIN', occupancyAttestation: 'MIXED' });
    });

    it('maps Not me to NOT_USER + UNKNOWN', () => {
        expect(identityReviewEventFields('NOT_ME')).toEqual({ label: 'NOT_USER', occupancyAttestation: 'UNKNOWN' });
    });

    it('maps Unsure to UNCERTAIN + UNKNOWN without forcing a label', () => {
        expect(identityReviewEventFields('UNSURE')).toEqual({ label: 'UNCERTAIN', occupancyAttestation: 'UNKNOWN' });
    });
});
