import { describe, expect, it } from 'vitest';
import type { HealthObservationDayBundle } from '../observations/models';
import { computeCrossSourceTelemetry } from './crossSourceTelemetry';
import type { SourceMetricBaseline } from './multisourceBaselines';

describe('crossSourceTelemetry', () => {
    it('computes agreement on normalized deviations', () => {
        const bundles: HealthObservationDayBundle[] = [
            {
                userId: 'user1',
                logicalDate: '2026-08-27',
                provider: 'garmin',
                transport: 'garmin_direct',
                observations: [
                    { observationId: '1', metric: 'hrv_rmssd_ms', value: 70 },
                    { observationId: '2', metric: 'sleep_duration_seconds', value: 28800 },
                ],
                sourcePayloadHash: 'h1',
                schemaVersion: 1,
                normalizerVersion: 1,
                revision: 1,
                ingestedAt: '',
                effectiveAt: '',
            },
            {
                userId: 'user1',
                logicalDate: '2026-08-27',
                provider: 'eight_sleep',
                transport: 'google_health',
                observations: [
                    { observationId: '3', metric: 'hrv_rmssd_ms', value: 75 },
                    { observationId: '4', metric: 'sleep_duration_seconds', value: 28200 },
                ],
                sourcePayloadHash: 'h2',
                schemaVersion: 1,
                normalizerVersion: 1,
                revision: 1,
                ingestedAt: '',
                effectiveAt: '',
            },
        ];

        const baselines: SourceMetricBaseline[] = [
            {
                metric: 'hrv_rmssd_ms',
                provider: 'garmin',
                transport: 'garmin_direct',
                count7d: 7,
                count28d: 28,
                median7d: 65,
                median28d: 60,
                mad28d: 5,
                maturity: 'MATURE',
                latestObservedDate: '2026-08-27',
            },
            {
                metric: 'hrv_rmssd_ms',
                provider: 'eight_sleep',
                transport: 'google_health',
                count7d: 7,
                count28d: 28,
                median7d: 70,
                median28d: 65,
                mad28d: 5,
                maturity: 'MATURE',
                latestObservedDate: '2026-08-27',
            },
        ];

        const telemetry = computeCrossSourceTelemetry('2026-08-27', bundles, baselines);

        // Both are above baseline median (70 > 60 and 75 > 65) -> agree = true
        expect(telemetry.hrvDirectionAgreement).toBe(true);
        expect(telemetry.sleepDurationDifferenceMinutes).toBe(10); // 480 min vs 470 min -> 10 min
    });
});
