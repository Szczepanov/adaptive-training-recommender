import { describe, expect, it } from 'vitest';
import {
    IDENTITY_REASON_CODES,
    IDENTITY_REASON_CODE_SCHEMA_VERSION,
    deriveEffectiveIdentityDecision,
    deriveObservationEligibility,
    findEffectiveReviewEvent,
    freezeAutomaticIdentityAssessment,
    isKnownIdentityReasonCode,
    type AutomaticIdentityAssessment,
    type IdentityReviewEvent,
} from './identityModels';

function makeAssessment(
    overrides: Partial<AutomaticIdentityAssessment> = {},
): AutomaticIdentityAssessment {
    return {
        id: 'assessment-2026-08-27',
        sourceNightKey: '2026-08-27',
        sharedSource: { provider: 'eight_sleep', transport: 'google_health' },
        automaticStatus: 'UNCERTAIN',
        identityScore: 0.42,
        confidenceTier: 'LOW',
        reasonCodes: ['SESSION_TIMING_DISCORDANT'],
        passportVersion: '2026-08-27.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-27T06:30:00Z',
        sharedBundleRef: {
            id: '2026-08-27_eight_sleep_google_health',
            provider: 'eight_sleep',
            transport: 'google_health',
            revision: 1,
            sourcePayloadHash: 'sha256:shared',
            lineageKey: 'eight_sleep:pod-side:abc',
        },
        anchorBundleRefs: [
            {
                id: '2026-08-27_garmin_garmin_direct',
                provider: 'garmin',
                transport: 'garmin_direct',
                revision: 1,
                sourcePayloadHash: 'sha256:anchor',
                lineageKey: 'garmin:device:xyz',
            },
        ],
        ...overrides,
    };
}

function makeReviewEvent(overrides: Partial<IdentityReviewEvent> = {}): IdentityReviewEvent {
    return {
        id: 'review-1',
        assessmentId: 'assessment-2026-08-27',
        schemaVersion: 1,
        label: 'USER',
        occupancyAttestation: 'EXCLUSIVE',
        supersedesReviewEventId: null,
        recordedAt: '2026-08-27T08:00:00Z',
        source: 'user_ui',
        ...overrides,
    };
}

describe('identityModels (PI1, ADR-0028)', () => {
    describe('reason codes', () => {
        it('are stable and versioned', () => {
            expect(IDENTITY_REASON_CODE_SCHEMA_VERSION).toBe('identity-reason-codes-v1');
            expect(IDENTITY_REASON_CODES).toMatchInlineSnapshot(`
              [
                "ANCHOR_MISSING",
                "ANCHOR_QUALITY_INSUFFICIENT",
                "EVIDENCE_LINEAGE_DEPENDENT",
                "INSUFFICIENT_PASSPORT_HISTORY",
                "MULTIPLE_PAIRING_CANDIDATES",
                "SESSION_TIMING_CONCORDANT",
                "SESSION_TIMING_DISCORDANT",
                "RHR_RELATION_CONCORDANT",
                "RHR_RELATION_DISCORDANT",
                "RESPIRATION_RELATION_CONCORDANT",
                "RESPIRATION_RELATION_DISCORDANT",
                "HRV_RELATION_CONCORDANT",
                "HRV_RELATION_DISCORDANT",
                "MIXED_OCCUPANCY_SUSPECTED",
                "SESSION_INTERVAL_INVALID",
              ]
            `);
        });

        it('rejects unknown codes via the type guard', () => {
            expect(isKnownIdentityReasonCode('ANCHOR_MISSING')).toBe(true);
            expect(isKnownIdentityReasonCode('IMPOSTER_REJECTED')).toBe(false);
            expect(isKnownIdentityReasonCode('NOT_A_REAL_CODE')).toBe(false);
        });
    });

    describe('serialization', () => {
        it('serializes all three automatic statuses deterministically', () => {
            for (const automaticStatus of ['USER', 'NOT_USER', 'UNCERTAIN'] as const) {
                const assessment = makeAssessment({ automaticStatus });
                const roundTripped = JSON.parse(JSON.stringify(assessment));
                expect(roundTripped).toEqual(assessment);
                // Re-serializing twice must be byte-identical (stable key order, no Date objects).
                expect(JSON.stringify(assessment)).toBe(JSON.stringify(roundTripped));
            }
        });

        it('serializes review events and effective decisions deterministically', () => {
            const assessment = makeAssessment();
            const event = makeReviewEvent();
            const decision = deriveEffectiveIdentityDecision(assessment, [event]);

            expect(JSON.parse(JSON.stringify(event))).toEqual(event);
            expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
        });
    });

    describe('immutability (P-PI-14)', () => {
        it('freezes the automatic assessment so it cannot be mutated', () => {
            const assessment = freezeAutomaticIdentityAssessment(makeAssessment());
            expect(Object.isFrozen(assessment)).toBe(true);
            expect(Object.isFrozen(assessment.reasonCodes)).toBe(true);
            expect(Object.isFrozen(assessment.sharedSource)).toBe(true);
            expect(Object.isFrozen(assessment.sharedBundleRef)).toBe(true);
            expect(Object.isFrozen(assessment.anchorBundleRefs)).toBe(true);
            expect(Object.isFrozen(assessment.anchorBundleRefs[0])).toBe(true);

            expect(() => {
                // @ts-expect-error -- intentionally attempting a forbidden mutation
                assessment.automaticStatus = 'USER';
            }).toThrow();
            expect(() => {
                // The canonical contract is runtime-frozen as well as top-level immutable.
                assessment.sharedSource.provider = 'forged_provider';
            }).toThrow();
        });

        it('a manual correction never mutates the automatic assessment fields', () => {
            const assessment = freezeAutomaticIdentityAssessment(
                makeAssessment({ automaticStatus: 'UNCERTAIN' }),
            );
            const before = JSON.parse(JSON.stringify(assessment));

            deriveEffectiveIdentityDecision(assessment, [
                makeReviewEvent({ label: 'USER', occupancyAttestation: 'EXCLUSIVE' }),
            ]);

            expect(JSON.parse(JSON.stringify(assessment))).toEqual(before);
            expect(assessment.automaticStatus).toBe('UNCERTAIN'); // unchanged historical model output
        });

        it('identity status derivation never touches bundle refs / provenance fields', () => {
            const assessment = makeAssessment();
            const decision = deriveEffectiveIdentityDecision(assessment, [
                makeReviewEvent({ label: 'NOT_USER', occupancyAttestation: 'UNKNOWN' }),
            ]);

            // The effective decision carries no raw bundle/observation payload or hash fields --
            // identity classification cannot alter, and does not even reference, raw bytes.
            expect(decision).not.toHaveProperty('sourcePayloadHash');
            expect(decision).not.toHaveProperty('observations');
            expect(assessment.sharedBundleRef.sourcePayloadHash).toBe('sha256:shared');
            expect(assessment.anchorBundleRefs[0].sourcePayloadHash).toBe('sha256:anchor');
        });
    });

    describe('review supersession (PI6, scenario L)', () => {
        it('the latest valid superseding review produces the effective decision', () => {
            const first = makeReviewEvent({
                id: 'review-1',
                label: 'NOT_USER',
                occupancyAttestation: 'UNKNOWN',
                supersedesReviewEventId: null,
                recordedAt: '2026-08-27T08:00:00Z',
            });
            const correction = makeReviewEvent({
                id: 'review-2',
                label: 'USER',
                occupancyAttestation: 'EXCLUSIVE',
                supersedesReviewEventId: 'review-1',
                recordedAt: '2026-08-28T09:00:00Z',
            });

            const decision = deriveEffectiveIdentityDecision(makeAssessment(), [first, correction]);

            expect(decision.effectiveStatus).toBe('USER');
            expect(decision.reviewEventId).toBe('review-2');
            expect(decision.authority).toBe('MANUAL_REVIEW');
            // Both events remain preserved by the caller (append-only) -- this module never
            // deletes/mutates either; it only picks which one is currently effective.
            expect(findEffectiveReviewEvent([first, correction])).toEqual(correction);
        });

        it('resolves a longer supersession chain to the final head deterministically', () => {
            const events: IdentityReviewEvent[] = [
                makeReviewEvent({
                    id: 'r1',
                    label: 'UNCERTAIN',
                    occupancyAttestation: 'UNKNOWN',
                    supersedesReviewEventId: null,
                    recordedAt: '2026-08-27T08:00:00Z',
                }),
                makeReviewEvent({
                    id: 'r2',
                    label: 'NOT_USER',
                    occupancyAttestation: 'UNKNOWN',
                    supersedesReviewEventId: 'r1',
                    recordedAt: '2026-08-27T09:00:00Z',
                }),
                makeReviewEvent({
                    id: 'r3',
                    label: 'USER',
                    occupancyAttestation: 'EXCLUSIVE',
                    supersedesReviewEventId: 'r2',
                    recordedAt: '2026-08-27T10:00:00Z',
                }),
            ];

            expect(findEffectiveReviewEvent(events)?.id).toBe('r3');
            // Order-independence: shuffling the input array must not change the resolved head.
            expect(findEffectiveReviewEvent([events[2], events[0], events[1]])?.id).toBe('r3');
        });
    });

    describe('eligibility mapping', () => {
        it('UNCERTAIN maps to baselineLearning=false and passportLearning=false', () => {
            const eligibility = deriveObservationEligibility('UNCERTAIN', 'UNKNOWN', false);
            expect(eligibility.baselineLearning).toBe(false);
            expect(eligibility.passportLearning).toBe(false);
        });

        it('NOT_USER maps to recovery=false, baselineLearning=false, passportLearning=false', () => {
            const eligibility = deriveObservationEligibility('NOT_USER', 'UNKNOWN', false);
            expect(eligibility.recovery).toBe(false);
            expect(eligibility.baselineLearning).toBe(false);
            expect(eligibility.passportLearning).toBe(false);
        });

        it('a mixed-occupancy attestation cannot become baseline/passport eligible even with label USER', () => {
            const eligibility = deriveObservationEligibility('USER', 'MIXED', true);
            expect(eligibility.recovery).toBe(false);
            expect(eligibility.baselineLearning).toBe(false);
            expect(eligibility.passportLearning).toBe(false);
            expect(eligibility.display).toBe(true); // still preserved, never deleted (P-PI-5)
        });

        it('USER + EXCLUSIVE attestation over suspected mixed occupancy is fully eligible (P-PI-15)', () => {
            const eligibility = deriveObservationEligibility('USER', 'EXCLUSIVE', true);
            expect(eligibility).toEqual({
                display: true,
                recovery: true,
                baselineLearning: true,
                passportLearning: true,
            });
        });

        it('raw observation display eligibility never depends on identity status', () => {
            for (const status of ['USER', 'NOT_USER', 'UNCERTAIN'] as const) {
                expect(deriveObservationEligibility(status, 'UNKNOWN', false).display).toBe(true);
            }
        });
    });

    describe('acceptance scenarios (identity/eligibility subset)', () => {
        it('D. user confirms wrong person: automatic UNCERTAIN -> manual NOT_USER -> effective NOT_USER', () => {
            const assessment = makeAssessment({ automaticStatus: 'UNCERTAIN' });
            const decision = deriveEffectiveIdentityDecision(assessment, [
                makeReviewEvent({ label: 'NOT_USER', occupancyAttestation: 'UNKNOWN' }),
            ]);

            expect(decision.effectiveStatus).toBe('NOT_USER');
            expect(decision.eligibility).toEqual({
                display: true,
                recovery: false,
                baselineLearning: false,
                passportLearning: false,
            });
        });

        it('E. user confirms unusual-but-exclusive night: manual USER + EXCLUSIVE -> effective USER', () => {
            const assessment = makeAssessment({ automaticStatus: 'UNCERTAIN' });
            const decision = deriveEffectiveIdentityDecision(assessment, [
                makeReviewEvent({ label: 'USER', occupancyAttestation: 'EXCLUSIVE' }),
            ]);

            expect(decision.effectiveStatus).toBe('USER');
            expect(decision.eligibility.recovery).toBe(true);
            expect(decision.eligibility.baselineLearning).toBe(true);
        });

        it('J. user confirms mixed occupancy: manual USER + MIXED stays baseline/passport ineligible', () => {
            const assessment = makeAssessment({
                automaticStatus: 'UNCERTAIN',
                reasonCodes: ['MIXED_OCCUPANCY_SUSPECTED'],
            });
            const decision = deriveEffectiveIdentityDecision(assessment, [
                makeReviewEvent({ label: 'USER', occupancyAttestation: 'MIXED' }),
            ]);

            expect(decision.eligibility.recovery).toBe(false);
            expect(decision.eligibility.baselineLearning).toBe(false);
            expect(decision.eligibility.passportLearning).toBe(false);
        });

        it('no review yet: effective decision falls back to the automatic assessment (AUTOMATIC authority)', () => {
            const assessment = makeAssessment({ automaticStatus: 'USER', reasonCodes: [] });
            const decision = deriveEffectiveIdentityDecision(assessment, []);

            expect(decision.authority).toBe('AUTOMATIC');
            expect(decision.reviewEventId).toBeUndefined();
            expect(decision.effectiveStatus).toBe('USER');
            expect(decision.eligibility.recovery).toBe(true);
        });
    });
});
