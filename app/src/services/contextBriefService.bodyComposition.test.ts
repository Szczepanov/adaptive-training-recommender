import { describe, expect, it } from 'vitest';
import { buildBodyCompositionBriefInput } from './contextBriefService';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { DailyRecoverySnapshot } from '../engine/models';
import {
    ANTHROPOMETRY_PROTOCOL_V1,
    type AnthropometryEntry,
    type AnthropometryMeasurementItem,
} from '../anthropometry/models';

const AS_OF = '2026-08-15';

/**
 * `weightDate` defaults to `date` -- a genuinely fresh weigh-in on the day the snapshot
 * itself covers -- so existing callers exercising body mass/fat get a trustworthy record
 * without having to think about provenance. Pass an explicit `weightDate` (or `null`) to
 * exercise the stale/unprovenanced paths `buildBodyCompositionBriefInput` must reject.
 */
function snapshot(
    date: string,
    overrides: Partial<DailyRecoverySnapshot['raw']> = {},
    weightDate: string | null = date,
): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: {
            garminSyncedAt: `${date}T06:15:00Z`,
            sourceSchemaVersion: 3,
            ...(weightDate !== null ? { metricDates: { weight: weightDate } } : {}),
        },
        raw: {
            sleepScore: 78, sleepDurationSec: 27000, restingHr: 48, hrvOvernightAvg: 62,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 71, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 1, yesterdayTraining: null, ...overrides,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 71, sleepScore28dAvg: 74,
            restingHr7dAvg: 50, restingHr28dAvg: 49,
            hrv7dAvg: 58, hrv28dAvg: 61,
            respiration7dAvg: 13, respiration28dAvg: 13,
            deltas: {
                sleepScoreVs7d: 7, sleepScoreVs28d: 4,
                restingHrVs7d: -2, restingHrVs28d: -1,
                hrvVs7d: 4, hrvVs28d: 1,
                respirationVs7d: 0, respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady: true,
        },
    };
}

function entry(date: string, measurements: AnthropometryMeasurementItem[], overrides: Partial<AnthropometryEntry> = {}): AnthropometryEntry {
    return {
        id: `e-${date}`,
        userId: 'u1',
        date,
        observedAt: `${date}T06:00:00Z`,
        protocol: ANTHROPOMETRY_PROTOCOL_V1,
        context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
        measurements,
        schemaVersion: 1,
        revision: 1,
        createdAt: `${date}T06:00:00Z`,
        updatedAt: `${date}T06:00:00Z`,
        ...overrides,
    };
}

describe('buildBodyCompositionBriefInput', () => {
    it('returns an empty, non-authoritative shape when there is no anthropometry or provider data', () => {
        const result = buildBodyCompositionBriefInput(AS_OF, [], []);
        expect(result).toEqual({ bodyMass: null, circumferences: [], bodyFatPct: null });
    });

    it('falls back to manual body mass when no provider weight is recorded', () => {
        const entries = [
            entry(addDaysToLocalDateString(AS_OF, -1), [
                { metricId: 'body_mass_kg', unit: 'kg', readings: [78.2], value: 78.2 },
            ]),
            entry(AS_OF, [
                { metricId: 'body_mass_kg', unit: 'kg', readings: [78.0], value: 78.0 },
            ]),
        ];
        const result = buildBodyCompositionBriefInput(AS_OF, entries, []);
        expect(result.bodyMass).toMatchObject({ source: 'manual', latestKg: 78.0, latestDate: AS_OF });
    });

    it('prefers a synced provider weight over a manually logged one on the same day', () => {
        const entries = [entry(AS_OF, [{ metricId: 'body_mass_kg', unit: 'kg', readings: [78.0], value: 78.0 }])];
        const snapshots = [snapshot(AS_OF, { weightKg: 77.4 })];
        const result = buildBodyCompositionBriefInput(AS_OF, entries, snapshots);
        expect(result.bodyMass).toMatchObject({ source: 'provider', latestKg: 77.4, latestDate: AS_OF });
    });

    it('computes a week-over-week trend once both 7-day windows have at least 4 recorded days', () => {
        const priorWeekStart = addDaysToLocalDateString(AS_OF, -13);
        const snapshots = [
            // Prior 7d window (days -13..-7): mean 80
            ...[0, 2, 4, 6].map(offset => snapshot(addDaysToLocalDateString(priorWeekStart, offset), { weightKg: 80 })),
            // Current 7d window (days -6..0): mean 78
            ...[1, 3, 5, 6].map(offset => snapshot(addDaysToLocalDateString(AS_OF, -6 + offset), { weightKg: 78 })),
        ];
        const result = buildBodyCompositionBriefInput(AS_OF, [], snapshots);
        expect(result.bodyMass?.current7dMeanKg).toBe(78);
        expect(result.bodyMass?.prior7dMeanKg).toBe(80);
        expect(result.bodyMass?.weekOverWeekKg).toBe(-2);
    });

    it('collapses a stale weigh-in echoed onto several snapshot days to a single recorded day, keyed by its real measurement date', () => {
        // Garmin can carry the same underlying weigh-in forward onto every snapshot until a
        // fresh one arrives. All four snapshots below report the identical reading, actually
        // measured once on 2026-08-01 -- dating by the snapshot's own `date` would wrongly
        // count this as 4 distinct recorded days and could satisfy the mean threshold on
        // fabricated coverage.
        const staleWeighInDate = '2026-08-01';
        const snapshots = ['2026-08-01', '2026-08-05', '2026-08-10', AS_OF]
            .map(date => snapshot(date, { weightKg: 82 }, staleWeighInDate));
        const result = buildBodyCompositionBriefInput(AS_OF, [], snapshots);
        expect(result.bodyMass).toMatchObject({ latestKg: 82, latestDate: staleWeighInDate });
        // Only 1 distinct day recorded (2026-08-01, outside both 7-day windows), so neither
        // window clears the 4-day floor and no week-over-week trend is fabricated.
        expect(result.bodyMass?.current7dMeanKg).toBeNull();
        expect(result.bodyMass?.weekOverWeekKg).toBeNull();
    });

    it('omits a provider weight or body-fat reading that carries no recorded metric date, rather than trusting the snapshot date', () => {
        const snapshots = [snapshot(AS_OF, { weightKg: 78, bodyFatPct: 15 }, null)];
        const result = buildBodyCompositionBriefInput(AS_OF, [], snapshots);
        expect(result.bodyMass).toBeNull();
        expect(result.bodyFatPct).toBeNull();
    });

    it('reports circumferences with a delta against the previous reading of the same metric, laterality and protocol', () => {
        const entries = [
            entry(addDaysToLocalDateString(AS_OF, -14), [
                { metricId: 'waist_minimum_cm', unit: 'cm', readings: [82, 82.2], value: 82.1 },
            ]),
            entry(AS_OF, [
                { metricId: 'waist_minimum_cm', unit: 'cm', readings: [80.5, 80.7], value: 80.6 },
            ]),
        ];
        const result = buildBodyCompositionBriefInput(AS_OF, entries, []);
        expect(result.circumferences).toHaveLength(1);
        expect(result.circumferences[0]).toMatchObject({
            label: 'Waist minimum',
            latestCm: 80.6,
            latestDate: AS_OF,
            deltaCm: -1.5,
            repeatabilityWarning: false,
        });
    });

    it('labels a laterality-specific limb measurement distinctly from its unspecified counterpart', () => {
        const entries = [
            entry(AS_OF, [
                { metricId: 'upper_arm_relaxed_mid_cm', unit: 'cm', laterality: 'left', readings: [32], value: 32 },
                { metricId: 'upper_arm_relaxed_mid_cm', unit: 'cm', laterality: 'right', readings: [32.5], value: 32.5 },
            ]),
        ];
        const result = buildBodyCompositionBriefInput(AS_OF, entries, []);
        const labels = result.circumferences.map(c => c.label).sort();
        expect(labels).toEqual(['Relaxed upper arm (left)', 'Relaxed upper arm (right)']);
    });

    it('surfaces device body-fat percentage from snapshots independently of body mass', () => {
        const snapshots = [snapshot(AS_OF, { bodyFatPct: 15.2 })];
        const result = buildBodyCompositionBriefInput(AS_OF, [], snapshots);
        expect(result.bodyFatPct).toMatchObject({ latestPct: 15.2, latestDate: AS_OF, recordedDays7d: 1 });
        expect(result.bodyMass).toBeNull();
    });

    it('carries recorded-day coverage through even when it falls short of the 4-day mean threshold', () => {
        const snapshots = [
            snapshot(AS_OF, { bodyFatPct: 15.2 }),
            snapshot(addDaysToLocalDateString(AS_OF, -1), { bodyFatPct: 15.4 }),
        ];
        const result = buildBodyCompositionBriefInput(AS_OF, [], snapshots);
        expect(result.bodyFatPct?.mean7dPct).toBeNull();
        expect(result.bodyFatPct?.recordedDays7d).toBe(2);
    });
});
