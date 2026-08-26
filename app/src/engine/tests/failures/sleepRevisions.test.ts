import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from '../../dataConfidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../models';

describe('Failure Mode 1: Sleep Arriving Late or Being Revised', () => {
    const mockCheckin = {
        userId: 'u1',
        date: '2026-08-26',
        readiness: 7,
        fatigue: 4,
        soreness: 3,
        mentalStress: 3,
        sleepQuality: 6,
        motivation: 7,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: '2026-08-26T06:00:00Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-08-26T06:00:00Z',
        updatedAt: '2026-08-26T06:00:00Z',
    } as DailySubjectiveCheckin;

    const mockSettings = {
        userId: 'u1',
        schemaVersion: 2 as const,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment: 'either' as const },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: '2026-08-01' },
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
    };

    it('evaluates lower confidence when sleep is missing or provisional at early morning sync', () => {
        const earlySnapshot = {
            userId: 'u1',
            date: '2026-08-26',
            schemaVersion: 3,
            source: { garminSyncedAt: '2026-08-26T05:30:00Z', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            raw: {
                hrvOvernightAvg: null,
                restingHr: 52,
                sleepScore: null,
                sleepDurationSec: 10800, // Partial/provisional 3h recorded so far
                totalSteps: 200,
                respirationAvg: 14.0,
                bodyBatteryWake: 45,
                last3DaysHardSessionsCount: 0,
                yesterdayTraining: null,
                todayTraining: null,
            },
            derived: {
                baselineComputationVersion: 3,
                hrv7dAvg: 60,
                hrv28dAvg: 61,
                hrv28dStdev: 5.0,
                restingHr7dAvg: 50,
                restingHr28dAvg: 49.5,
                restingHr28dStdev: 2.0,
                deltas: { restingHrVs7d: 2, hrvVs7d: null },
            },
            dataQuality: { sleepScoreAvailable: false, restingHrAvailable: true, hrvAvailable: false, baseline7dReady: true, baseline28dReady: true },
        } as unknown as DailyRecoverySnapshot;

        const input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: earlySnapshot,
            subjectiveCheckin: mockCheckin,
            activeGoals: [],
            trainingSettings: mockSettings,
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };

        const earlyConfidence = evaluateDataConfidence(input, '2026-08-26T09:00:00Z');
        expect(earlyConfidence.rating).toBe('MODERATE');
        expect(earlyConfidence.signals.hrv.status).toBe('MISSING');
        expect(earlyConfidence.signals.sleep.value).toContain('180m');
    });

    it('upgrades confidence to HIGH when finalized sleep revision is synced later', () => {
        const finalizedSnapshot = {
            userId: 'u1',
            date: '2026-08-26',
            schemaVersion: 3,
            source: { garminSyncedAt: '2026-08-26T08:15:00Z', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            raw: {
                hrvOvernightAvg: 62,
                restingHr: 49,
                sleepScore: 84,
                sleepDurationSec: 28200, // Final 7.8h
                totalSteps: 1200,
                respirationAvg: 13.8,
                bodyBatteryWake: 88,
                last3DaysHardSessionsCount: 0,
                yesterdayTraining: null,
                todayTraining: null,
            },
            derived: {
                baselineComputationVersion: 3,
                hrv7dAvg: 60,
                hrv28dAvg: 61,
                hrv28dStdev: 5.0,
                restingHr7dAvg: 50,
                restingHr28dAvg: 49.5,
                restingHr28dStdev: 2.0,
                sleepScore7dAvg: 80,
                sleepScore28dAvg: 79,
                sleepScore28dStdev: 6.0,
                deltas: { restingHrVs7d: -1, hrvVs7d: 2, restingHrVs28d: -0.5, hrvVs28d: 1 },
            },
            dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
        } as unknown as DailyRecoverySnapshot;

        const input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: finalizedSnapshot,
            subjectiveCheckin: mockCheckin,
            activeGoals: [],
            trainingSettings: mockSettings,
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };

        const finalConfidence = evaluateDataConfidence(input, '2026-08-26T09:00:00Z');
        expect(finalConfidence.rating).toBe('HIGH');
        expect(finalConfidence.sensorTier).toBe('FULL_WEARABLE');
        expect(finalConfidence.signals.hrv.status).toBe('PRESENT');
        expect(finalConfidence.signals.sleep.value).toContain('470m (Score: 84)');
    });
});
