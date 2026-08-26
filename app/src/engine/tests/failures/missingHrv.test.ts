import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from '../../dataConfidence';
import { evaluateReadinessAndSafetyEnvelope } from '../../rules';
import type { DailyDecisionInput, DailyReadiness, DailyRecoverySnapshot, DailySubjectiveCheckin, UserContext } from '../../models';

describe('Failure Mode 4: Missing HRV While Other Signals Remain Present', () => {
    const mockSubjective = {
        userId: 'u1',
        date: '2026-08-26',
        readiness: 7,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        sleepQuality: 7,
        motivation: 7,
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

    const mockContext: UserContext = {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            maxTimeMinutes: 60,
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
        },
        preferences: {
            preferredModalities: ['Running'],
            avoidedModalities: [],
            deprioritizedModalities: [],
            conservativeBias: false,
        },
    };

    it('applies conservative safeguard without throwing when HRV is null but RHR and Sleep are valid', () => {
        const snapshot = {
            userId: 'u1',
            date: '2026-08-26',
            schemaVersion: 3,
            source: { garminSyncedAt: new Date().toISOString(), sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            raw: {
                hrvOvernightAvg: null, // Watch dropped HRV
                restingHr: 56,
                sleepScore: 78,
                sleepDurationSec: 27000,
                totalSteps: 7000,
            },
            derived: {
                baselineComputationVersion: 3,
                restingHr7dAvg: 49,
                restingHr28dAvg: 49,
                restingHr28dStdev: 1.5,
                deltas: { restingHrVs7d: 7, restingHrVs28d: 7, hrvVs7d: null, hrvVs28d: null },
            },
            dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: false, baseline7dReady: true, baseline28dReady: true },
        } as unknown as DailyRecoverySnapshot;

        const input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: snapshot,
            subjectiveCheckin: mockSubjective,
            activeGoals: [],
            trainingSettings: mockSettings,
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };

        const confidence = evaluateDataConfidence(input);
        expect(confidence.signals.hrv.status).toBe('MISSING');
        expect(confidence.signals.rhr.status).toBe('PRESENT');
        expect(confidence.activeSafeguards.some(s => s.includes('HRV is unavailable while RHR is elevated'))).toBe(true);

        const readiness: DailyReadiness = {
            subjective: {
                readiness: 7,
                fatigue: 4,
                soreness: 3,
                stress: 4,
                sleepQuality: 7,
                motivation: 7,
                timeAvailable: 60,
                painFlag: false,
                alreadyTrainedToday: false,
                preferredModalityToday: null,
            },
            objective: {
                total_steps: 7000,
                sleep_score: 78,
                sleep_duration_min: 450,
                rhr: 56,
                rhr_7d_avg: 49,
                rhr_delta: 7,
                hrv_weekly_avg: null,
                hrv_last_night: null,
                hrv_delta: null,
                hrv_delta_28d: null,
                hrv_stdev_28d: null,
                rhr_delta_28d: 7,
                rhr_stdev_28d: 1.5,
                sleep_score_delta_7d: null,
                sleep_score_delta_28d: null,
                sleep_score_stdev_28d: null,
                respiration: 14,
                body_battery_wake: 70,
                last_3_days_hard_sessions_count: 0,
                yesterday_training: null,
                today_training: null,
            },
        };

        const result = evaluateReadinessAndSafetyEnvelope(readiness, mockContext, '2026-08-26');
        expect(result.mode).toBeDefined();
        // RHR +7 bpm acute elevation triggers acuteBiometricStrainFloor -> 'modify' mode
        expect(result.mode).toBe('modify');
    });
});
