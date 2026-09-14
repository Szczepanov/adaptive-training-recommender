import { describe, expect, it } from 'vitest';
import type { AnthropometryEntry } from './models';
import {
    compute7dBodyMassSummary,
    computeBodyMassTrend,
    computeCircumferenceTrends,
    computeHungerRetrospectiveSummary,
    computeProviderCompositionSummary,
    reduceDailyManualBodyMass,
} from './trends';

function sampleEntry(
    id: string,
    date: string,
    observedAt: string,
    weightKg?: number,
    preferredContext: boolean = true,
    trainingBefore: boolean = false,
): AnthropometryEntry {
    return {
        id,
        userId: 'u1',
        date,
        observedAt,
        protocol: 'home_anthropometry@1',
        context: {
            morningPostVoidPreIntake: preferredContext,
            trainingBeforeMeasurement: trainingBefore,
        },
        measurements: weightKg !== undefined
            ? [{ metricId: 'body_mass_kg', unit: 'kg', readings: [weightKg], value: weightKg }]
            : [],
        schemaVersion: 1,
        revision: 1,
        createdAt: observedAt,
        updatedAt: observedAt,
    };
}

describe('anthropometry trend math', () => {
    describe('reduceDailyManualBodyMass', () => {
        it('prefers morning_post_void_pre_intake without prior training over other same-day entries', () => {
            const e1 = sampleEntry('e1', '2026-09-14', '2026-09-14T06:00:00Z', 75.5, false, false);
            const e2 = sampleEntry('e2', '2026-09-14', '2026-09-14T07:00:00Z', 75.0, true, false);
            const map = reduceDailyManualBodyMass([e1, e2]);

            expect(map.size).toBe(1);
            const pt = map.get('2026-09-14');
            expect(pt?.entryId).toBe('e2');
            expect(pt?.weightKg).toBe(75.0);
            expect(pt?.isPreferredContext).toBe(true);
        });

        it('chooses earliest observation when multiple entries share preferred status', () => {
            const e1 = sampleEntry('e1', '2026-09-14', '2026-09-14T08:00:00Z', 75.2, true, false);
            const e2 = sampleEntry('e2', '2026-09-14', '2026-09-14T06:30:00Z', 75.0, true, false);
            const map = reduceDailyManualBodyMass([e1, e2]);

            const pt = map.get('2026-09-14');
            expect(pt?.entryId).toBe('e2');
            expect(pt?.weightKg).toBe(75.0);
        });

        it('multiple same-day sessions count as exactly one coverage date', () => {
            const e1 = sampleEntry('e1', '2026-09-14', '2026-09-14T06:30:00Z', 75.0);
            const e2 = sampleEntry('e2', '2026-09-14', '2026-09-14T18:30:00Z', 75.8);
            const map = reduceDailyManualBodyMass([e1, e2]);

            expect(map.size).toBe(1);
        });
    });

    describe('compute7dBodyMassSummary', () => {
        const dates = [
            '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
            '2026-09-12', '2026-09-13', '2026-09-14',
        ];

        it('returns mean and qualifies when at least 4 of 7 dates have readings', () => {
            const points = new Map([
                ['2026-09-08', { date: '2026-09-08', weightKg: 75.0, source: 'manual' as const }],
                ['2026-09-09', { date: '2026-09-09', weightKg: 75.2, source: 'manual' as const }],
                ['2026-09-11', { date: '2026-09-11', weightKg: 74.8, source: 'manual' as const }],
                ['2026-09-14', { date: '2026-09-14', weightKg: 75.0, source: 'manual' as const }],
            ]);

            const summary = compute7dBodyMassSummary(dates, points);
            expect(summary.distinctRecordedDates).toBe(4);
            expect(summary.qualifiesForMean).toBe(true);
            expect(summary.meanWeightKg).toBe(75.0);
        });

        it('returns null mean when fewer than 4 dates have readings (sparse history)', () => {
            const points = new Map([
                ['2026-09-08', { date: '2026-09-08', weightKg: 75.0, source: 'manual' as const }],
                ['2026-09-09', { date: '2026-09-09', weightKg: 75.2, source: 'manual' as const }],
                ['2026-09-11', { date: '2026-09-11', weightKg: 74.8, source: 'manual' as const }],
            ]);

            const summary = compute7dBodyMassSummary(dates, points);
            expect(summary.distinctRecordedDates).toBe(3);
            expect(summary.qualifiesForMean).toBe(false);
            expect(summary.meanWeightKg).toBeNull();
        });
    });

    describe('computeBodyMassTrend WoW change', () => {
        const prior7d = [
            '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
            '2026-09-05', '2026-09-06', '2026-09-07',
        ];
        const current7d = [
            '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
            '2026-09-12', '2026-09-13', '2026-09-14',
        ];

        it('computes WoW absolute and % change only when both windows qualify', () => {
            const points = new Map([
                ['2026-09-01', { date: '2026-09-01', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-02', { date: '2026-09-02', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-03', { date: '2026-09-03', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-04', { date: '2026-09-04', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-08', { date: '2026-09-08', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-09', { date: '2026-09-09', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-10', { date: '2026-09-10', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-11', { date: '2026-09-11', weightKg: 75.0, source: 'provider' as const }],
            ]);

            const trend = computeBodyMassTrend('provider', current7d, prior7d, points);
            expect(trend.weekOverWeekAbsoluteKg).toBe(-1.0);
            expect(trend.weekOverWeekPercent).toBe(-1.3);
        });

        it('returns null WoW change when one window fails coverage threshold', () => {
            const points = new Map([
                ['2026-09-01', { date: '2026-09-01', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-02', { date: '2026-09-02', weightKg: 76.0, source: 'provider' as const }],
                ['2026-09-08', { date: '2026-09-08', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-09', { date: '2026-09-09', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-10', { date: '2026-09-10', weightKg: 75.0, source: 'provider' as const }],
                ['2026-09-11', { date: '2026-09-11', weightKg: 75.0, source: 'provider' as const }],
            ]);

            const trend = computeBodyMassTrend('provider', current7d, prior7d, points);
            expect(trend.current7d.qualifiesForMean).toBe(true);
            expect(trend.prior7d.qualifiesForMean).toBe(false);
            expect(trend.weekOverWeekAbsoluteKg).toBeNull();
            expect(trend.weekOverWeekPercent).toBeNull();
        });
    });

    describe('computeCircumferenceTrends', () => {
        it('tracks deltas strictly within identical metric, laterality, and protocol', () => {
            const e1: AnthropometryEntry = {
                id: 'e1',
                userId: 'u1',
                date: '2026-09-01',
                observedAt: '2026-09-01T06:00:00Z',
                protocol: 'home_anthropometry@1',
                context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
                measurements: [
                    { metricId: 'waist_minimum_cm', unit: 'cm', readings: [83.0, 83.2], value: 83.1 },
                    { metricId: 'thigh_mid_cm', laterality: 'left', unit: 'cm', readings: [56.0, 56.2], value: 56.1 },
                    { metricId: 'thigh_mid_cm', laterality: 'right', unit: 'cm', readings: [56.4, 56.6], value: 56.5 },
                ],
                schemaVersion: 1,
                revision: 1,
                createdAt: '2026-09-01T06:00:00Z',
                updatedAt: '2026-09-01T06:00:00Z',
            };

            const e2: AnthropometryEntry = {
                id: 'e2',
                userId: 'u1',
                date: '2026-09-08',
                observedAt: '2026-09-08T06:00:00Z',
                protocol: 'home_anthropometry@1',
                context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
                measurements: [
                    { metricId: 'waist_minimum_cm', unit: 'cm', readings: [82.0, 82.2], value: 82.1 },
                    { metricId: 'thigh_mid_cm', laterality: 'left', unit: 'cm', readings: [55.5, 55.7], value: 55.6 },
                ],
                schemaVersion: 1,
                revision: 1,
                createdAt: '2026-09-08T06:00:00Z',
                updatedAt: '2026-09-08T06:00:00Z',
            };

            const trends = computeCircumferenceTrends([e1, e2]);

            const waistTrend = trends.get('waist_minimum_cm:unspecified:home_anthropometry@1');
            expect(waistTrend?.deltaCm).toBe(-1.0);

            const leftThighTrend = trends.get('thigh_mid_cm:left:home_anthropometry@1');
            expect(leftThighTrend?.deltaCm).toBe(-0.5);

            const rightThighTrend = trends.get('thigh_mid_cm:right:home_anthropometry@1');
            expect(rightThighTrend?.latestPoint?.value).toBe(56.5);
            expect(rightThighTrend?.previousPoint).toBeNull();
            expect(rightThighTrend?.deltaCm).toBeNull();
        });

        it('uses entry identity as a stable tie-break when same-day observations share observedAt', () => {
            const makeWaistEntry = (id: string, value: number): AnthropometryEntry => ({
                id,
                userId: 'u1',
                date: '2026-09-14',
                observedAt: '2026-09-14T12:00:00.000Z',
                protocol: 'home_anthropometry@1',
                context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
                measurements: [{ metricId: 'waist_minimum_cm', unit: 'cm', readings: [value, value], value }],
                schemaVersion: 1,
                revision: 1,
                createdAt: '2026-09-14T12:00:00.000Z',
                updatedAt: '2026-09-14T12:00:00.000Z',
            });

            const e1 = makeWaistEntry('e1', 82.0);
            const e2 = makeWaistEntry('e2', 81.5);
            const forward = computeCircumferenceTrends([e1, e2]).get('waist_minimum_cm:unspecified:home_anthropometry@1');
            const reversed = computeCircumferenceTrends([e2, e1]).get('waist_minimum_cm:unspecified:home_anthropometry@1');

            expect(forward?.latestPoint?.entryId).toBe('e2');
            expect(reversed?.latestPoint?.entryId).toBe('e2');
            expect(forward?.previousPoint?.entryId).toBe('e1');
            expect(reversed?.previousPoint?.entryId).toBe('e1');
        });
    });

    describe('computeHungerRetrospectiveSummary', () => {
        it('isolates morning_pre_breakfast and computes 7d/28d arithmetic summaries', () => {
            const dates7d = ['2026-09-12', '2026-09-13', '2026-09-14'];
            const dates28d = ['2026-09-01', '2026-09-05', ...dates7d];

            const records = [
                { date: '2026-09-12', hunger1To10: 6, hungerTiming: 'morning_pre_breakfast' as const },
                { date: '2026-09-13', hunger1To10: 4, hungerTiming: 'morning_pre_breakfast' as const },
                { date: '2026-09-14', hunger1To10: 8, hungerTiming: 'other' as const },
                { date: '2026-09-01', hunger1To10: 5, hungerTiming: 'morning_pre_breakfast' as const },
            ];

            const summary = computeHungerRetrospectiveSummary(records, 'morning_pre_breakfast', dates7d, dates28d);
            expect(summary.recordedDays7d).toBe(2);
            expect(summary.mean7d).toBe(5.0);
            expect(summary.recordedDays28d).toBe(3);
            expect(summary.mean28d).toBe(5.0);
            expect(summary.latestValue).toBe(4);
            expect(summary.latestDate).toBe('2026-09-13');
        });
    });

    describe('computeProviderCompositionSummary', () => {
        it('summarizes provider body fat without cross-source substitution', () => {
            const dates7d = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'];
            const records = [
                { date: '2026-09-08', bodyFatPct: 15.2 },
                { date: '2026-09-09', bodyFatPct: 15.4 },
                { date: '2026-09-10', bodyFatPct: 15.0 },
                { date: '2026-09-11', bodyFatPct: 15.2 },
            ];

            const summary = computeProviderCompositionSummary(records, dates7d);
            expect(summary.recordedDays7d).toBe(4);
            expect(summary.mean7d).toBe(15.2);
            expect(summary.latestBodyFatPct).toBe(15.2);
            expect(summary.latestDate).toBe('2026-09-11');
        });
    });
});
