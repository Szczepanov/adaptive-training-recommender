import { describe, expect, it } from 'vitest';
import type { HealthObservationDayBundle } from '../observations/models';
import type { SourceMetricBaseline } from './multisourceBaselines';
import { evaluateMultisourceFusion } from './multisourceFusion';

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

        // Co-presence should detect imposter and discard Eight Sleep
        expect(result.coPresenceVerdict?.verifiedAthlete).toBe(false);
        expect(result.coPresenceVerdict?.status).toBe('IMPOSTER_REJECTED');

        // HRV evidence should fall back 100% to Garmin Direct single source
        const hrv = result.fusedMetrics['hrv_rmssd_ms'];
        expect(hrv.effectiveSource).toBe('garmin_garmin_direct');
        expect(hrv.agreementStatus).toBe('SINGLE_SOURCE');
        expect(hrv.fusedZScore).toBe(1.0); // Genuine athlete's Garmin z-score
    });
});
