import { describe, expect, it } from 'vitest';
import {
    deriveEffectiveIdentityDecision,
    type AutomaticIdentityAssessment,
    type IdentityReviewEvent,
} from '../observations/identityModels';
import type { HealthObservationDayBundle } from '../observations/models';
import { healthObservationBundleId, type EffectiveBundleIdentityProjection } from './identityEligibility';
import type { SourceMetricBaseline } from './multisourceBaselines';
import { evaluateMultisourceFusion } from './multisourceFusion';

/** PI9 (ADR-0028) identity-gate fixture helper -- mirrors identityEligibility.test.ts's `projection`. */
function identityProjectionFor(
    sourceBundle: HealthObservationDayBundle,
    overrides: {
        automaticStatus?: AutomaticIdentityAssessment['automaticStatus'];
        reasonCodes?: AutomaticIdentityAssessment['reasonCodes'];
        reviewEvents?: readonly IdentityReviewEvent[];
    } = {},
): EffectiveBundleIdentityProjection {
    const assessment: AutomaticIdentityAssessment = {
        id: `assessment-${sourceBundle.logicalDate}`,
        sourceNightKey: sourceBundle.logicalDate,
        sharedSource: { provider: sourceBundle.provider, transport: sourceBundle.transport },
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
            lineageKey: 'eight_sleep:pod-side:a',
        },
        anchorBundleRefs: [],
    };
    return {
        assessment,
        decision: deriveEffectiveIdentityDecision(assessment, overrides.reviewEvents ?? []),
    };
}

describe('multisourceFusion (MS15)', () => {
    const matureGarminHrvBaseline: SourceMetricBaseline = {
        metric: 'hrv_rmssd_ms',
        provider: 'garmin',
        transport: 'garmin_direct',
        count7d: 7,
        count28d: 28,
        median7d: 65,
        median28d: 60,
        mad28d: 5.0,
        maturity: 'MATURE',
        latestObservedDate: '2026-08-27',
    };

    const matureEightSleepHrvBaseline: SourceMetricBaseline = {
        metric: 'hrv_rmssd_ms',
        provider: 'eight_sleep',
        transport: 'google_health',
        count7d: 7,
        count28d: 28,
        median7d: 58,
        median28d: 55,
        mad28d: 6.0,
        maturity: 'MATURE',
        latestObservedDate: '2026-08-27',
    };

    const immatureEightSleepBaseline: SourceMetricBaseline = {
        ...matureEightSleepHrvBaseline,
        count28d: 5,
        maturity: 'INSUFFICIENT_HISTORY',
    };

    it('returns empty fusedMetrics when policy is off', () => {
        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'off',
            bundles: [],
            baselines: [matureGarminHrvBaseline],
        });

        expect(result.policy).toBe('off');
        expect(result.fusedMetrics).toEqual({});
    });

    it('uses Eight Sleep as fallback when Garmin is missing and Eight Sleep is mature', () => {
        const eightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                {
                    observationId: 'obs_1',
                    metric: 'hrv_rmssd_ms',
                    value: 61, // 1 MAD above median 55 -> z = +1.0
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_1',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            bundles: [eightSleepBundle],
            baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
        });

        const hrvEvidence = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrvEvidence).toBeDefined();
        expect(hrvEvidence.agreementStatus).toBe('SINGLE_SOURCE');
        expect(hrvEvidence.effectiveSource).toBe('eight_sleep_google_health');
        expect(hrvEvidence.fusedZScore).toBe(1.0);
    });

    it('excludes immature Eight Sleep baseline from fallback', () => {
        const eightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                {
                    observationId: 'obs_1',
                    metric: 'hrv_rmssd_ms',
                    value: 61,
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_1',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            bundles: [eightSleepBundle],
            baselines: [matureGarminHrvBaseline, immatureEightSleepBaseline],
        });

        const hrvEvidence = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrvEvidence.agreementStatus).toBe('NO_DATA');
        expect(hrvEvidence.fusedZScore).toBeNull();
    });

    it('fuses dual mature streams with elevated confidence when in directional agreement', () => {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [
                {
                    observationId: 'obs_g',
                    metric: 'hrv_rmssd_ms',
                    value: 65, // +1.0 MAD (median 60, mad 5) -> z = 1.0
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_g',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const eightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                {
                    observationId: 'obs_e',
                    metric: 'hrv_rmssd_ms',
                    value: 61, // +1.0 MAD (median 55, mad 6) -> z = 1.0
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_e',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            bundles: [garminBundle, eightSleepBundle],
            baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
        });

        const hrvEvidence = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrvEvidence.agreementStatus).toBe('AGREE');
        expect(hrvEvidence.effectiveSource).toBe('fused_garmin_eight');
        expect(hrvEvidence.fusedZScore).toBe(1.0);
        expect(hrvEvidence.confidenceMultiplier).toBe(1.15);
    });

    it('conservatively preserves Garmin Direct with dampened confidence when sources diverge', () => {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [
                {
                    observationId: 'obs_g',
                    metric: 'hrv_rmssd_ms',
                    value: 65, // +1.0 MAD (elevated)
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_g',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const eightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                {
                    observationId: 'obs_e',
                    metric: 'hrv_rmssd_ms',
                    value: 43, // -2.0 MAD (suppressed)
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_e',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            bundles: [garminBundle, eightSleepBundle],
            baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
        });

        const hrvEvidence = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrvEvidence.agreementStatus).toBe('DIVERGE');
        expect(hrvEvidence.effectiveSource).toBe('garmin_garmin_direct');
        expect(hrvEvidence.fusedZScore).toBe(1.0); // Keeps Garmin's z-score
        expect(hrvEvidence.confidenceMultiplier).toBe(0.85); // Dampened confidence
    });

    it('respects granular metric activation config', () => {
        const eightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                { observationId: 'obs_e1', metric: 'hrv_rmssd_ms', value: 61, unit: 'ms' },
                { observationId: 'obs_e2', metric: 'daily_resting_heart_rate_bpm', value: 45, unit: 'bpm' },
            ],
            sourcePayloadHash: 'hash_e',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const matureEightSleepRhrBaseline: SourceMetricBaseline = {
            metric: 'daily_resting_heart_rate_bpm',
            provider: 'eight_sleep',
            transport: 'google_health',
            count7d: 7,
            count28d: 28,
            median7d: 45,
            median28d: 45,
            mad28d: 2.0,
            maturity: 'MATURE',
            latestObservedDate: '2026-08-27',
        };

        // Case 1: HRV disabled, RHR enabled
        const res1 = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            athleteRhr28dMedian: 45,
            metricActivation: { hrv: false, restingHeartRate: true },
            bundles: [eightSleepBundle],
            baselines: [matureEightSleepHrvBaseline, matureEightSleepRhrBaseline],
        });

        expect(res1.fusedMetrics['hrv_rmssd_ms']).toBeUndefined();
        expect(res1.fusedMetrics['daily_resting_heart_rate_bpm']).toBeDefined();
        expect(res1.fusedMetrics['daily_resting_heart_rate_bpm'].agreementStatus).toBe('SINGLE_SOURCE');
    });

    it('rejects imposter Eight Sleep payload in fusion when child sleeps on bed', () => {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [
                { observationId: 'obs_g1', metric: 'daily_resting_heart_rate_bpm', value: 43, unit: 'bpm' },
                { observationId: 'obs_g2', metric: 'hrv_rmssd_ms', value: 65, unit: 'ms' },
            ],
            sourcePayloadHash: 'hash_g',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const imposterEightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                { observationId: 'obs_e1', metric: 'daily_resting_heart_rate_bpm', value: 85, unit: 'bpm' }, // Child RHR
                { observationId: 'obs_e2', metric: 'hrv_rmssd_ms', value: 30, unit: 'ms' },
            ],
            sourcePayloadHash: 'hash_e',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const result = evaluateMultisourceFusion({
            logicalDate: '2026-08-27',
            policy: 'candidate-v1',
            bundles: [garminBundle, imposterEightSleepBundle],
            baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
        });

        // Co-presence should detect divergence and quarantine Eight Sleep
        expect(result.coPresenceVerdict?.verifiedAthlete).toBe(false);
        expect(result.coPresenceVerdict?.status).toBe('DISCORDANT_SECONDARY');

        // HRV evidence should fall back 100% to Garmin Direct single source
        const hrv = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrv.effectiveSource).toBe('garmin_garmin_direct');
        expect(hrv.agreementStatus).toBe('SINGLE_SOURCE');
        expect(hrv.fusedZScore).toBe(1.0); // Genuine athlete's Garmin z-score
    });

    describe('PI9 identity gate (ADR-0028)', () => {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [
                { observationId: 'obs_g1', metric: 'daily_resting_heart_rate_bpm', value: 43, unit: 'bpm' },
                { observationId: 'obs_g2', metric: 'hrv_rmssd_ms', value: 65, unit: 'ms' },
            ],
            sourcePayloadHash: 'hash_g',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const discordantEightSleepBundle: HealthObservationDayBundle = {
            userId: 'user_1',
            logicalDate: '2026-08-27',
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                { observationId: 'obs_e1', metric: 'daily_resting_heart_rate_bpm', value: 85, unit: 'bpm' },
                { observationId: 'obs_e2', metric: 'hrv_rmssd_ms', value: 30, unit: 'ms' },
            ],
            sourcePayloadHash: 'hash_e',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        it('leaves legacy behaviour unchanged when no identity evidence is supplied', () => {
            const result = evaluateMultisourceFusion({
                logicalDate: '2026-08-27',
                policy: 'candidate-v1',
                bundles: [garminBundle, discordantEightSleepBundle],
                baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
            });

            expect(result.identityGateApplied).toBe(false);
        });

        it('overrides a legacy-discordant verdict once a real USER identity decision is supplied', () => {
            const result = evaluateMultisourceFusion({
                logicalDate: '2026-08-27',
                userId: 'user_1',
                policy: 'candidate-v1',
                bundles: [garminBundle, discordantEightSleepBundle],
                baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
                effectiveIdentityProjections: [identityProjectionFor(discordantEightSleepBundle)],
            });

            // The legacy scalar heuristic still flags this pairing as discordant...
            expect(result.coPresenceVerdict?.status).toBe('DISCORDANT_SECONDARY');
            // ...but the identity gate is authoritative once supplied: Eight Sleep is admitted.
            expect(result.identityGateApplied).toBe(true);
            const hrv = result.fusedMetrics['hrv_rmssd_ms'];
            expect(hrv.contributors.some((c) => c.provider === 'eight_sleep')).toBe(true);
        });

        it('excludes an Eight Sleep bundle the legacy heuristic would accept once identity is UNCERTAIN', () => {
            const concordantEightSleepBundle: HealthObservationDayBundle = {
                ...discordantEightSleepBundle,
                observations: [
                    { observationId: 'obs_e1', metric: 'daily_resting_heart_rate_bpm', value: 44, unit: 'bpm' },
                    { observationId: 'obs_e2', metric: 'hrv_rmssd_ms', value: 63, unit: 'ms' },
                ],
            };
            const legacyResult = evaluateMultisourceFusion({
                logicalDate: '2026-08-27',
                policy: 'candidate-v1',
                bundles: [garminBundle, concordantEightSleepBundle],
                baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
            });
            expect(legacyResult.coPresenceVerdict?.status).toBe('CONCORDANT');
            expect(legacyResult.fusedMetrics['hrv_rmssd_ms'].contributors.some((c) => c.provider === 'eight_sleep')).toBe(true);

            const gatedResult = evaluateMultisourceFusion({
                logicalDate: '2026-08-27',
                userId: 'user_1',
                policy: 'candidate-v1',
                bundles: [garminBundle, concordantEightSleepBundle],
                baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
                effectiveIdentityProjections: [
                    identityProjectionFor(concordantEightSleepBundle, {
                        automaticStatus: 'UNCERTAIN',
                        reasonCodes: ['MIXED_OCCUPANCY_SUSPECTED'],
                    }),
                ],
            });

            expect(gatedResult.identityGateApplied).toBe(true);
            const gatedHrv = gatedResult.fusedMetrics['hrv_rmssd_ms'];
            expect(gatedHrv.contributors.some((c) => c.provider === 'eight_sleep')).toBe(false);
            expect(gatedHrv.agreementStatus).toBe('SINGLE_SOURCE');
            expect(gatedHrv.effectiveSource).toBe('garmin_garmin_direct');
        });

        it('resolves userId from the bundles when the identity gate is used without an explicit userId (single-user convenience)', () => {
            const result = evaluateMultisourceFusion({
                logicalDate: '2026-08-27',
                // userId intentionally omitted -- bundles below all belong to the same user.
                policy: 'candidate-v1',
                bundles: [garminBundle, discordantEightSleepBundle],
                baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
                effectiveIdentityProjections: [identityProjectionFor(discordantEightSleepBundle)],
            });

            expect(result.identityGateApplied).toBe(true);
            expect(result.fusedMetrics['hrv_rmssd_ms'].contributors.some((c) => c.provider === 'eight_sleep')).toBe(true);
        });

        it('throws instead of silently guessing a user when the identity gate is used on multi-user bundles without an explicit userId', () => {
            const otherUserGarminBundle: HealthObservationDayBundle = {
                ...garminBundle,
                userId: 'user_2',
            };

            expect(() =>
                evaluateMultisourceFusion({
                    logicalDate: '2026-08-27',
                    // userId intentionally omitted -- bundles below span two different users.
                    policy: 'candidate-v1',
                    bundles: [garminBundle, discordantEightSleepBundle, otherUserGarminBundle],
                    baselines: [matureGarminHrvBaseline, matureEightSleepHrvBaseline],
                    effectiveIdentityProjections: [identityProjectionFor(discordantEightSleepBundle)],
                }),
            ).toThrow(/requires an explicit `userId`/);
        });
    });
});
