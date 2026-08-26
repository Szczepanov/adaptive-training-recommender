import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from '../../dataConfidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../models';

describe('Data confidence physiological plausibility bounds', () => {
    it('rejects invalid biometrics and degrades a suspicious-but-bounded step surge', () => {
        const corruptSnapshot = {
            userId: 'u1',
            date: '2026-08-26',
            schemaVersion: 3,
            source: { garminSyncedAt: '2026-08-26T08:00:00Z', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
            raw: {
                hrvOvernightAvg: 350, // Implausible
                restingHr: 165, // Implausible resting HR
                sleepScore: 100,
                sleepDurationSec: 65000, // 18 hours (implausible)
                totalSteps: 98000, // Suspicious
                respirationAvg: 48, // Implausible
                bodyBatteryWake: 150, // Out of 0-100 bounds
            },
            derived: {
                baselineComputationVersion: 3,
                deltas: {},
            },
            dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
        } as unknown as DailyRecoverySnapshot;

        const checkin = {
            userId: 'u1',
            date: '2026-08-26',
            readiness: 7,
            fatigue: 4,
            soreness: 3,
            mentalStress: 3,
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

        const input: DailyDecisionInput = {
            userId: 'u1',
            date: '2026-08-26',
            recoverySnapshot: corruptSnapshot,
            subjectiveCheckin: checkin,
            activeGoals: [],
            trainingSettings: {
                userId: 'u1',
                schemaVersion: 2,
                equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: true },
                guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
                defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment: 'either' },
                preferences: { preferActiveRecovery: false },
                migration: { legacyReviewed: true, migratedAt: '2026-08-01' },
                createdAt: '2026-08-01',
                updatedAt: '2026-08-01',
            },
            preferences: null,
            trainingIntentProfile: null,
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        };

        const confidence = evaluateDataConfidence(input, '2026-08-26T09:00:00Z');

        expect(confidence.signals.hrv.status).toBe('INVALID');
        expect(confidence.signals.rhr.status).toBe('INVALID');
        expect(confidence.signals.sleep.status).toBe('INVALID');
        expect(confidence.signals.respiration.status).toBe('INVALID');
        expect(confidence.signals.bodyBattery.status).toBe('INVALID');
        expect(confidence.signals.steps.status).toBe('DEGRADED');
        expect(confidence.breakdown.plausibilityScore).toBeLessThan(50);
        expect(confidence.activeSafeguards.some(s => s.includes('physiologically implausible'))).toBe(true);
    });
});
