import { describe, expect, it } from 'vitest';
import {
    computeBodyMassRelativeContext,
    extractProviderWeightRecords,
    formatBodyMassRelativeContext,
    isBodyMassRelativeMetric,
    resolveSameDayBodyMass,
} from './bodyMass';
import type { DailyRecoverySnapshot } from '../engine/models';
import type { AnthropometryEntry } from './models';

function makeSnapshot(
    date: string,
    weightKg: number | undefined,
    weightMetricDate: string | undefined,
): DailyRecoverySnapshot {
    return {
        date,
        raw: {
            weightKg,
        },
        source: {
            metricDates: weightMetricDate ? { weight: weightMetricDate } : {},
        },
    } as unknown as DailyRecoverySnapshot;
}

function makeManualEntry(
    id: string,
    date: string,
    weightKg: number,
    observedAt: string,
    morningPostVoidPreIntake = true,
): AnthropometryEntry {
    return {
        id,
        date,
        observedAt,
        protocol: 'home_anthropometry@1',
        context: {
            morningPostVoidPreIntake,
            trainingBeforeMeasurement: false,
        },
        measurements: [
            {
                metricId: 'body_mass_kg',
                value: weightKg,
                unit: 'kg',
                readings: [weightKg],
            },
        ],
    } as unknown as AnthropometryEntry;
}

describe('bodyMass utilities', () => {
    describe('extractProviderWeightRecords', () => {
        it('keys weight on source.metricDates.weight, not snapshot date', () => {
            const snapshots = [
                makeSnapshot('2026-10-21', 75.5, '2026-10-20'),
                makeSnapshot('2026-10-22', 75.5, '2026-10-20'), // stale carry forward
                makeSnapshot('2026-10-23', undefined, undefined), // missing
                makeSnapshot('2026-10-24', 76.0, '2026-10-24'), // fresh
            ];

            const records = extractProviderWeightRecords(snapshots);
            expect(records).toEqual([
                { date: '2026-10-20', weightKg: 75.5 },
                { date: '2026-10-20', weightKg: 75.5 },
                { date: '2026-10-24', weightKg: 76.0 },
            ]);
        });
    });

    describe('resolveSameDayBodyMass (D8 invariants)', () => {
        const snapshots = [
            makeSnapshot('2026-10-21', 75.2, '2026-10-20'), // stale carry forward on snapshot date 2026-10-21
            makeSnapshot('2026-10-22', 75.0, '2026-10-22'), // valid provider on 2026-10-22
        ];
        const manualEntries = [
            makeManualEntry('m1', '2026-10-21', 74.8, '2026-10-21T07:00:00+02:00'),
            makeManualEntry('m2', '2026-10-22', 74.5, '2026-10-22T07:15:00+02:00'),
        ];

        it('defaults to provider-first when no preference is stored', () => {
            const res = resolveSameDayBodyMass('2026-10-22', {
                snapshots,
                manualEntries,
            });
            expect(res).toEqual({
                bodyMassKg: 75.0,
                source: 'provider',
                date: '2026-10-22',
            });
        });

        it('falls back to manual only when no usable provider series exists and no source was explicitly chosen', () => {
            const res = resolveSameDayBodyMass('2026-10-21', {
                snapshots: [],
                manualEntries,
            });
            expect(res).toEqual({
                bodyMassKg: 74.8,
                source: 'manual',
                date: '2026-10-21',
            });
        });

        it('ignores stale provider carry-forward on snapshot date', () => {
            // On 2026-10-21, provider snapshot has weight 75.2 but metricDates.weight is 2026-10-20
            const res = resolveSameDayBodyMass('2026-10-21', {
                snapshots,
                manualEntries,
            });
            // Provider has no point for 2026-10-21, and we never fall back to manual!
            expect(res).toBeNull();
        });

        it('honours explicit manual preference without provider substitution', () => {
            const res = resolveSameDayBodyMass('2026-10-22', {
                snapshots,
                manualEntries,
                preferredSource: 'manual',
            });
            expect(res).toEqual({
                bodyMassKg: 74.5,
                source: 'manual',
                date: '2026-10-22',
            });

            // Missing manual date returns null even when provider point exists
            const resMissing = resolveSameDayBodyMass('2026-10-25', {
                snapshots,
                manualEntries,
                preferredSource: 'manual',
            });
            expect(resMissing).toBeNull();
        });

        it('never averages between provider and manual', () => {
            const res = resolveSameDayBodyMass('2026-10-22', {
                snapshots,
                manualEntries,
                preferredSource: 'provider',
            });
            expect(res?.bodyMassKg).toBe(75.0); // Not (75.0 + 74.5) / 2
        });
    });

    describe('computeBodyMassRelativeContext and format', () => {
        it('identifies relative metrics correctly', () => {
            expect(isBodyMassRelativeMetric('cycling_sprint_1s_peak_power_w')).toBe(true);
            expect(isBodyMassRelativeMetric('cycling_sprint_5s_mean_power_w')).toBe(true);
            expect(isBodyMassRelativeMetric('cycling_5s_peak_power_w')).toBe(true);
            expect(isBodyMassRelativeMetric('strength_1rm_kg')).toBe(true);
            expect(isBodyMassRelativeMetric('standing_broad_jump_distance_cm')).toBe(false);
            expect(isBodyMassRelativeMetric('cycling_tt_20m_mean_power_w')).toBe(false);
        });

        it('computes sprint W/kg', () => {
            const ctx = computeBodyMassRelativeContext('cycling_sprint_1s_peak_power_w', 1200, {
                bodyMassKg: 75.0,
                source: 'provider',
                date: '2026-10-22',
            });
            expect(ctx).toEqual({
                bodyMassKg: 75.0,
                bodyMassSource: 'provider',
                bodyMassDate: '2026-10-22',
                relativeValue: 16.0,
                relativeUnit: 'W/kg',
            });
            expect(formatBodyMassRelativeContext('cycling_sprint_1s_peak_power_w', ctx))
                .toBe('16 W/kg (provider · 2026-10-22)');
        });

        it('computes strength kg/kg relative 1RM', () => {
            const ctx = computeBodyMassRelativeContext('strength_1rm_kg', 150, {
                bodyMassKg: 75.0,
                source: 'manual',
                date: '2026-10-22',
            });
            expect(ctx).toEqual({
                bodyMassKg: 75.0,
                bodyMassSource: 'manual',
                bodyMassDate: '2026-10-22',
                relativeValue: 2.0,
                relativeUnit: 'kg/kg',
            });
            expect(formatBodyMassRelativeContext('strength_1rm_kg', ctx))
                .toBe('2 kg/kg (manual · 2026-10-22)');
        });

        it('returns unavailable string when body mass is null for relative metric', () => {
            const ctx = computeBodyMassRelativeContext('strength_1rm_kg', 150, null);
            expect(ctx).toEqual({});
            expect(formatBodyMassRelativeContext('strength_1rm_kg', ctx)).toBe('unavailable');
        });

        it('returns null format for non-relative metric', () => {
            const ctx = computeBodyMassRelativeContext('standing_broad_jump_distance_cm', 240, {
                bodyMassKg: 75.0,
                source: 'provider',
                date: '2026-10-22',
            });
            expect(ctx).toEqual({});
            expect(formatBodyMassRelativeContext('standing_broad_jump_distance_cm', ctx)).toBeNull();
        });
    });
});
