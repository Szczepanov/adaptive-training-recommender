import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from '../../dataConfidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../models';

describe('Failure Mode 10: Different Users Having Different Sensor Availability', () => {
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

    it('correctly classifies Tier 1 (Full Wearable), Tier 2 (Basic Wearable), and Tier 3 (Subjective Only)', () => {
        // Tier 3: Subjective only
        const tier3Input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: null,
            subjectiveCheckin: mockCheckin,
            activeGoals: [],
            trainingSettings: mockSettings,
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: false, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };
        const tier3Confidence = evaluateDataConfidence(tier3Input, '2026-08-26T09:00:00Z');
        expect(tier3Confidence.sensorTier).toBe('SUBJECTIVE_ONLY');

        // Tier 2: Basic Wearable (RHR + Steps only, no HRV)
        const tier2Input: DailyDecisionInput = {
            ...tier3Input,
            recoverySnapshot: {
                userId: 'u1',
                date: '2026-08-26',
                schemaVersion: 3,
                source: { garminSyncedAt: '2026-08-26T08:00:00Z', sourceSchemaVersion: 3 },
                raw: { totalSteps: 7500, restingHr: 50, hrvOvernightAvg: null, sleepScore: null, sleepDurationSec: 28000 },
                derived: { baselineComputationVersion: 3, restingHr7dAvg: 49, deltas: { restingHrVs7d: 1 } },
                dataQuality: { sleepScoreAvailable: false, restingHrAvailable: true, hrvAvailable: false, baseline7dReady: true, baseline28dReady: false },
            } as unknown as DailyRecoverySnapshot,
        };
        const tier2Confidence = evaluateDataConfidence(tier2Input, '2026-08-26T09:00:00Z');
        expect(tier2Confidence.sensorTier).toBe('BASIC_WEARABLE');

        // Tier 1: Full Wearable (HRV + RHR + Sleep)
        const tier1Input: DailyDecisionInput = {
            ...tier3Input,
            recoverySnapshot: {
                userId: 'u1',
                date: '2026-08-26',
                schemaVersion: 3,
                source: { garminSyncedAt: '2026-08-26T08:00:00Z', sourceSchemaVersion: 3 },
                raw: { totalSteps: 7500, restingHr: 50, hrvOvernightAvg: 65, sleepScore: 85, sleepDurationSec: 28000 },
                derived: { baselineComputationVersion: 3, hrv7dAvg: 63, hrv28dStdev: 5.0, restingHr7dAvg: 49, restingHr28dStdev: 2.0, deltas: { hrvVs7d: 2, restingHrVs7d: 1 } },
                dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
            } as unknown as DailyRecoverySnapshot,
        };
        const tier1Confidence = evaluateDataConfidence(tier1Input, '2026-08-26T09:00:00Z');
        expect(tier1Confidence.sensorTier).toBe('FULL_WEARABLE');
    });
});
