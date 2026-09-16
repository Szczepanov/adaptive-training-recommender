import { describe, expect, it } from 'vitest';
import { buildBodyCompositionBriefInput } from './contextBriefService';
import type { DailyRecoverySnapshot } from '../engine/models';
import { ANTHROPOMETRY_PROTOCOL_V1, type AnthropometryEntry } from '../anthropometry/models';

const AS_OF = '2026-08-15';

function staleProviderSnapshot(): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: AS_OF,
        source: {
            garminSyncedAt: `${AS_OF}T06:15:00Z`,
            sourceSchemaVersion: 3,
            metricDates: { weight: '2026-07-20' },
        },
        raw: {
            sleepScore: 78,
            sleepDurationSec: 27000,
            restingHr: 48,
            hrvOvernightAvg: 62,
            hrvStatus: 'balanced',
            respirationAvg: 13,
            bodyBatteryWake: 71,
            bodyBatteryChange: 40,
            totalSteps: 9000,
            last3DaysHardSessionsCount: 1,
            yesterdayTraining: null,
            weightKg: 82,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 71,
            sleepScore28dAvg: 74,
            restingHr7dAvg: 50,
            restingHr28dAvg: 49,
            hrv7dAvg: 58,
            hrv28dAvg: 61,
            respiration7dAvg: 13,
            respiration28dAvg: 13,
            deltas: {
                sleepScoreVs7d: 7,
                sleepScoreVs28d: 4,
                restingHrVs7d: -2,
                restingHrVs28d: -1,
                hrvVs7d: 4,
                hrvVs28d: 1,
                respirationVs7d: 0,
                respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    };
}

function manualEntry(date: string, weightKg: number): AnthropometryEntry {
    return {
        id: `manual-${date}`,
        userId: 'u1',
        date,
        observedAt: `${date}T06:00:00Z`,
        protocol: ANTHROPOMETRY_PROTOCOL_V1,
        context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
        measurements: [{ metricId: 'body_mass_kg', unit: 'kg', readings: [weightKg], value: weightKg }],
        schemaVersion: 1,
        revision: 1,
        createdAt: `${date}T06:00:00Z`,
        updatedAt: `${date}T06:00:00Z`,
    };
}

describe('buildBodyCompositionBriefInput body-mass source freshness', () => {
    it('uses recent manual data when the only provider weight is a stale carry-forward', () => {
        const result = buildBodyCompositionBriefInput(
            AS_OF,
            [manualEntry('2026-08-14', 78.1), manualEntry(AS_OF, 78)],
            [staleProviderSnapshot()],
        );

        expect(result.bodyMass).toMatchObject({
            source: 'manual',
            latestKg: 78,
            latestDate: AS_OF,
        });
    });

    it('keeps provider priority when provider and manual both have data in the trend horizon', () => {
        const freshProvider = staleProviderSnapshot();
        freshProvider.source.metricDates = { weight: AS_OF };
        freshProvider.raw.weightKg = 77.4;

        const result = buildBodyCompositionBriefInput(
            AS_OF,
            [manualEntry(AS_OF, 78)],
            [freshProvider],
        );

        expect(result.bodyMass).toMatchObject({
            source: 'provider',
            latestKg: 77.4,
            latestDate: AS_OF,
        });
    });
});
