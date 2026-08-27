import { describe, expect, it } from 'vitest';
import type { HealthObservationDayBundle } from '../observations/models';
import {
    calculateMad,
    calculateMedian,
    computeSourceMetricBaseline,
    evaluateBaselineMaturity,
} from './multisourceBaselines';

describe('multisourceBaselines', () => {
    it('calculates median and MAD correctly', () => {
        const values = [60, 62, 64, 66, 68];
        const med = calculateMedian(values);
        expect(med).toBe(64);

        const mad = calculateMad(values, med);
        expect(mad).toBeCloseTo(2 * 1.4826, 4);
    });

    it('evaluates baseline maturity transitions', () => {
        expect(evaluateBaselineMaturity(10, '2026-08-26', '2026-08-27')).toBe('INSUFFICIENT_HISTORY');
        expect(evaluateBaselineMaturity(20, '2026-08-26', '2026-08-27')).toBe('PROVISIONAL');
        expect(evaluateBaselineMaturity(30, '2026-08-26', '2026-08-27')).toBe('MATURE');
        expect(evaluateBaselineMaturity(30, '2026-08-20', '2026-08-27')).toBe('STALE');
    });

    it('computes source metric baseline from bundles', () => {
        const bundles: HealthObservationDayBundle[] = [];
        for (let i = 1; i <= 28; i++) {
            const dateStr = `2026-08-${String(i).padStart(2, '0')}`;
            bundles.push({
                userId: 'user1',
                logicalDate: dateStr,
                provider: 'garmin',
                transport: 'google_health',
                observations: [
                    {
                        observationId: `obs_${i}`,
                        metric: 'hrv_rmssd_ms',
                        value: 60 + (i % 5),
                    },
                ],
                sourcePayloadHash: 'hash',
                schemaVersion: 1,
                normalizerVersion: 1,
                revision: 1,
                ingestedAt: '2026-08-28T00:00:00Z',
                effectiveAt: '2026-08-28T00:00:00Z',
            });
        }

        const baseline = computeSourceMetricBaseline(
            bundles,
            'hrv_rmssd_ms',
            'garmin',
            'google_health',
            '2026-08-28',
        );

        expect(baseline.count28d).toBe(28);
        expect(baseline.count7d).toBe(7);
        expect(baseline.maturity).toBe('MATURE');
        expect(baseline.median28d).not.toBeNull();
    });
});
