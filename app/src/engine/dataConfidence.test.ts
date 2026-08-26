import { describe, it, expect } from 'vitest';
import { evaluateDataConfidence } from './dataConfidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';

const EVALUATED_AT = '2026-08-26T09:00:00Z';

function createMockCheckin(overrides?: Partial<DailySubjectiveCheckin>): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date: '2026-08-26',
        readiness: 8,
        fatigue: 3,
        soreness: 2,
        mentalStress: 3,
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
        ...overrides,
    };
}

function createMockSnapshot(overrides?: Partial<DailyRecoverySnapshot['raw']>, derivedOverrides?: Partial<DailyRecoverySnapshot['derived']>): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: '2026-08-26',
        schemaVersion: 3,
        source: {
            garminSyncedAt: '2026-08-26T08:00:00Z',
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
            metricDates: {
                sleep: '2026-08-26',
                hrv: '2026-08-26',
                restingHr: '2026-08-26',
                bodyBatteryWake: '2026-08-26',
                steps: '2026-08-25',
            },
        },
        raw: {
            hrvOvernightAvg: 65,
            restingHr: 48,
            sleepScore: 85,
            sleepDurationSec: 28800, // 8h
            totalSteps: 8500,
            respirationAvg: 14.5,
            bodyBatteryWake: 90,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
            ...overrides,
        },
        derived: {
            baselineComputationVersion: 3,
            hrv7dAvg: 63,
            hrv28dAvg: 64,
            hrv28dStdev: 6.2,
            restingHr7dAvg: 49,
            restingHr28dAvg: 48.5,
            restingHr28dStdev: 2.1,
            sleepScore7dAvg: 82,
            sleepScore28dAvg: 80,
            sleepScore28dStdev: 7.5,
            respiration7dAvg: 14.2,
            respiration28dAvg: 14.1,
            respiration28dMad: 0.8,
            steps7dAvg: 9000,
            steps28dAvg: 8800,
            deltas: {
                hrvVs7d: 2,
                hrvVs28d: 1,
                restingHrVs7d: -1,
                restingHrVs28d: -0.5,
                sleepScoreVs7d: 3,
                sleepScoreVs28d: 5,
                respirationVs7d: 0.3,
                respirationVs28d: 0.4,
                stepsVs7d: -500,
                stepsVs28d: -300,
            },
            ...derivedOverrides,
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    } as unknown as DailyRecoverySnapshot;
}

function createDecisionInput(snapshot: DailyRecoverySnapshot | null, checkin: DailySubjectiveCheckin | null): DailyDecisionInput {
    return {
        userId: 'u1',
        date: '2026-08-26',
        recoverySnapshot: snapshot,
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
        dataQuality: {
            hasRecoverySnapshot: snapshot !== null,
            hasSubjectiveCheckin: checkin !== null,
            subjectiveCheckinComplete: checkin !== null,
            profileReady: true,
        },
    };
}

describe('evaluateDataConfidence', () => {
    it('evaluates HIGH confidence with full valid biometrics and check-in', () => {
        const snapshot = createMockSnapshot();
        const checkin = createMockCheckin();
        const input = createDecisionInput(snapshot, checkin);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.rating).toBe('HIGH');
        expect(confidence.sensorTier).toBe('FULL_WEARABLE');
        expect(confidence.score).toBeGreaterThanOrEqual(80);
        expect(confidence.breakdown.completenessScore).toBe(100);
        expect(confidence.breakdown.plausibilityScore).toBe(100);
        expect(confidence.signals.hrv.status).toBe('PRESENT');
        expect(confidence.signals.rhr.status).toBe('PRESENT');
    });

    it('evaluates MODERATE confidence when HRV is missing but Sleep and RHR are present', () => {
        const snapshot = createMockSnapshot({ hrvOvernightAvg: null });
        const checkin = createMockCheckin();
        const input = createDecisionInput(snapshot, checkin);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.rating).toBe('MODERATE');
        expect(confidence.sensorTier).toBe('BASIC_WEARABLE');
        expect(confidence.signals.hrv.status).toBe('MISSING');
        expect(confidence.signals.rhr.status).toBe('PRESENT');
    });

    it('evaluates LOW confidence for subjective checkin only (no Garmin snapshot)', () => {
        const checkin = createMockCheckin();
        const input = createDecisionInput(null, checkin);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.rating).toBe('LOW');
        expect(confidence.sensorTier).toBe('SUBJECTIVE_ONLY');
        expect(confidence.signals.hrv.status).toBe('MISSING');
        expect(confidence.activeSafeguards).toContain('Subjective-only coverage: wearable telemetry is absent or unusable.');
    });

    it('evaluates INSUFFICIENT confidence when subjective checkin is missing', () => {
        const snapshot = createMockSnapshot();
        const input = createDecisionInput(snapshot, null);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.rating).toBe('INSUFFICIENT');
        expect(confidence.signals.subjectiveCheckin.status).toBe('MISSING');
        expect(confidence.activeSafeguards.some(s => s.includes('Missing check-in'))).toBe(true);
    });

    it('evaluates INSUFFICIENT confidence when current check-in values are invalid', () => {
        const checkin = createMockCheckin({ fatigue: 14 });

        const confidence = evaluateDataConfidence(createDecisionInput(createMockSnapshot(), checkin), EVALUATED_AT);

        expect(confidence.rating).toBe('INSUFFICIENT');
        expect(confidence.signals.subjectiveCheckin.status).toBe('INVALID');
    });

    it('detects and flags physiologically implausible biometric values', () => {
        const snapshot = createMockSnapshot({
            restingHr: 220, // Cadence lock or sensor fault
            respirationAvg: 52, // Sensor fault
            hrvOvernightAvg: 450, // Impossible rMSSD
        });
        const checkin = createMockCheckin();
        const input = createDecisionInput(snapshot, checkin);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.signals.rhr.status).toBe('INVALID');
        expect(confidence.signals.respiration.status).toBe('INVALID');
        expect(confidence.signals.hrv.status).toBe('INVALID');
        expect(confidence.breakdown.plausibilityScore).toBeLessThan(100);
        expect(confidence.activeSafeguards.some(s => s.includes('physiologically implausible'))).toBe(true);
    });

    it('applies conservative safeguard when RHR is elevated but HRV is missing', () => {
        const snapshot = createMockSnapshot(
            { hrvOvernightAvg: null, restingHr: 54 },
            { deltas: { restingHrVs7d: 5, hrvVs7d: null, restingHrVs28d: null, hrvVs28d: null, sleepScoreVs7d: null, sleepScoreVs28d: null, respirationVs7d: null, respirationVs28d: null } } as unknown as DailyRecoverySnapshot['derived']
        );
        const checkin = createMockCheckin();
        const input = createDecisionInput(snapshot, checkin);

        const confidence = evaluateDataConfidence(input, EVALUATED_AT);

        expect(confidence.activeSafeguards.some(s => s.includes('HRV is unavailable while RHR is elevated'))).toBe(true);
    });

    it('does not mistake undefined legacy baseline fields for mature 28-day history', () => {
        const snapshot = createMockSnapshot({}, {
            hrv28dAvg: undefined,
            hrv28dStdev: undefined,
            restingHr28dAvg: undefined,
            restingHr28dStdev: undefined,
            sleepScore28dAvg: undefined,
            sleepScore28dStdev: undefined,
        });

        const confidence = evaluateDataConfidence(createDecisionInput(snapshot, createMockCheckin()), EVALUATED_AT);

        expect(confidence.breakdown.baselineMaturityScore).toBe(60);
        expect(confidence.rating).toBe('MODERATE');
        expect(confidence.signals.hrv.historyDays).toBe(7);
    });

    it('marks a prior-date HRV observation stale even when the snapshot was synced recently', () => {
        const snapshot = createMockSnapshot();
        snapshot.source.metricDates = { ...snapshot.source.metricDates, hrv: '2026-08-25' };

        const confidence = evaluateDataConfidence(createDecisionInput(snapshot, createMockCheckin()), EVALUATED_AT);

        expect(confidence.signals.hrv.status).toBe('STALE');
        expect(confidence.rating).toBe('MODERATE');
    });

    it('rejects an out-of-range sleep score even when duration is plausible', () => {
        const snapshot = createMockSnapshot({ sleepScore: 140 });

        const confidence = evaluateDataConfidence(createDecisionInput(snapshot, createMockCheckin()), EVALUATED_AT);

        expect(confidence.signals.sleep.status).toBe('INVALID');
        expect(confidence.signals.sleep.issues).toContain('Sleep score 140 is outside 0-100.');
    });

    it('uses the Warsaw D-1 metric date for ambient steps', () => {
        const snapshot = createMockSnapshot();
        snapshot.source.metricDates = { ...snapshot.source.metricDates, steps: '2026-08-26' };

        const confidence = evaluateDataConfidence(createDecisionInput(snapshot, createMockCheckin()), EVALUATED_AT);

        expect(confidence.signals.steps.expectedDate).toBe('2026-08-25');
        expect(confidence.signals.steps.status).toBe('STALE');
    });

    it('rejects an invalid evaluation timestamp instead of falling back to wall-clock time', () => {
        const input = createDecisionInput(createMockSnapshot(), createMockCheckin());

        expect(() => evaluateDataConfidence(input, 'not-a-date')).toThrow('valid ISO date-time');
    });
});
