import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from '../../dataConfidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../models';

describe('Data confidence: immature baseline coverage', () => {
    const mockCheckin = {
        userId: 'u1',
        date: '2026-08-26',
        readiness: 8,
        fatigue: 3,
        soreness: 2,
        mentalStress: 2,
        sleepQuality: 8,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: '2026-08-26T07:00:00Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-08-26T07:00:00Z',
        updatedAt: '2026-08-26T07:00:00Z',
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

    it('keeps confidence below HIGH when a shifted signal has only a 7-day baseline', () => {
        const immatureSnapshot = {
            userId: 'u1',
            date: '2026-08-26',
            schemaVersion: 3,
            source: { garminSyncedAt: '2026-08-26T08:00:00Z', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            raw: {
                hrvOvernightAvg: 75, // +15ms jump on new device
                restingHr: 46,
                sleepScore: 88,
                sleepDurationSec: 28800,
                totalSteps: 8000,
            },
            derived: {
                baselineComputationVersion: 3,
                hrv7dAvg: 72,
                hrv28dAvg: null, // New device has not accumulated 28d history yet
                hrv28dStdev: null,
                restingHr7dAvg: 47,
                restingHr28dAvg: null,
                restingHr28dStdev: null,
                deltas: { hrvVs7d: 3, restingHrVs7d: -1 },
            },
            dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: false },
        } as unknown as DailyRecoverySnapshot;

        const input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: immatureSnapshot,
            subjectiveCheckin: mockCheckin,
            activeGoals: [],
            trainingSettings: mockSettings,
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };

        const confidence = evaluateDataConfidence(input, '2026-08-26T09:00:00Z');
        expect(confidence.breakdown.baselineMaturityScore).toBeLessThan(100);
        expect(confidence.rating).toBe('MODERATE');
        expect(confidence.activeSafeguards.some(item => item.includes('baselines are still maturing'))).toBe(true);
    });
});
