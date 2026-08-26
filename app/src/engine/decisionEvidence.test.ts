import { describe, expect, it } from 'vitest';
import {
    computeDayOverDayDeltas,
    computeRankedEvidence,
    computeDecisionBoundaries,
    computeInvalidationTriggers,
    computeDataConfidence,
    assembleMorningDecisionEvidence,
} from './decisionEvidence';
import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin, Recommendation, TrainingSettings } from './models';

function sampleSnapshot(overrides: Partial<DailyRecoverySnapshot['raw']> = {}, derivedOverrides: Partial<DailyRecoverySnapshot['derived']> = {}): DailyRecoverySnapshot {
    return {
        date: '2026-08-26',
        userId: 'athlete-1',
        raw: {
            sleepScore: 82,
            sleepDurationSec: 28800,
            deepSleepSec: 7200,
            remSleepSec: 5400,
            lightSleepSec: 14400,
            awakeSleepSec: 1800,
            restlessMomentsCount: 12,
            hrvOvernightAvg: 58,
            hrvStatus: 'balanced',
            restingHr: 48,
            bodyBatteryWake: 88,
            bodyBatteryDrained: 12,
            bodyBatteryCharged: 65,
            bodyBatteryChange: 53,
            totalSteps: 8500,
            yesterdayTraining: null,
            last3DaysHardSessionsCount: 0,
            respirationAvg: 14.5,
            ...overrides,
        },
        derived: {
            baselineComputationVersion: 3,
            sleepScore7dAvg: 78,
            sleepScore28dAvg: 76,
            sleepScore28dStdev: 6,
            restingHr7dAvg: 49,
            restingHr28dAvg: 50,
            restingHr28dStdev: 2,
            hrv7dAvg: 54,
            hrv28dAvg: 52,
            hrv28dStdev: 4,
            steps7dAvg: 9500,
            steps28dAvg: 9200,
            steps28dStdev: 1200,
            respiration7dAvg: 14.5,
            respiration28dAvg: 14.3,
            deltas: {
                sleepScoreVs7d: 4,
                sleepScoreVs28d: 6,
                restingHrVs7d: -1,
                restingHrVs28d: -2,
                hrvVs7d: 4,
                hrvVs28d: 6,
                stepsVs7d: 200,
                stepsVs28d: 300,
                respirationVs7d: 0,
                respirationVs28d: 0.2,
            },
            ...derivedOverrides,
        },
        source: {
            garminSyncedAt: '2026-08-26T06:00:00Z',
            sourceSchemaVersion: 3,
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

function sampleTrainingSettings(): TrainingSettings {
    return {
        userId: 'athlete-1',
        schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: true, indoor_bike: false, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        injuries: [],
        defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-08-26T06:00:00Z',
        updatedAt: '2026-08-26T06:00:00Z',
    };
}

function sampleCheckin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete-1',
        date: '2026-08-26',
        schemaVersion: 1,
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 1,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: {
            timeAvailableMin: 60,
            preferredModalityToday: 'Running',
            indoorOnly: false,
        },
        notes: null,
        submittedAt: '2026-08-26T07:00:00Z',
        createdAt: '2026-08-26T07:00:00Z',
        updatedAt: '2026-08-26T07:00:00Z',
        dataQuality: {
            isComplete: true,
            missingFields: [],
        },
        ...overrides,
    };
}

function sampleRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
    return {
        template: {
            id: 'thr_run_01',
            title: 'Threshold Intervals',
            category: 'Hard Endurance',
            modality: 'Running',
            durationMin: 50,
            durationMax: 55,
            systemicCost: 0.7,
            description: '4x6m threshold cruise intervals.',
            requiredEquipment: [],
            environment: 'outdoor',
            safetyTags: [],
        },
        mode: 'train',
        rationale: 'Recovery inputs permit threshold loading today.',
        envelopes: {
            safety: {
                clinicalFlagActive: false,
                restrictedModalities: [],
            },
            plan: {
                maxAllowableTier: 'Hard',
                taperActive: false,
            },
        },
        ...overrides,
    };
}

function sampleInput(overrides: Partial<DailyDecisionInput> = {}): DailyDecisionInput {
    return {
        userId: 'athlete-1',
        date: '2026-08-26',
        recoverySnapshot: sampleSnapshot(),
        subjectiveCheckin: sampleCheckin(),
        activeGoals: [],
        trainingSettings: sampleTrainingSettings(),
        preferences: null,
        trainingIntentProfile: null,
        dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: true, profileReady: true },
        ...overrides,
    };
}

describe('decisionEvidence engine module', () => {
    it('computes day-over-day physiological deltas accurately', () => {
        const today = sampleSnapshot({ sleepScore: 85, hrvOvernightAvg: 60, restingHr: 46 });
        const yesterday = sampleSnapshot({ sleepScore: 75, hrvOvernightAvg: 52, restingHr: 49 });

        const deltas = computeDayOverDayDeltas(today, yesterday, 'train', null);
        expect(deltas.hasYesterdayData).toBe(true);
        expect(deltas.sleepScoreDelta).toBe(10);
        expect(deltas.hrvDeltaYesterday).toBe(8);
        expect(deltas.hrvDeltaBaseline).toBe(8);
        expect(deltas.restingHrDelta).toBe(-3);
        expect(deltas.summaryText).toContain('HRV increased (+8 ms)');
        expect(deltas.summaryText).toContain('sleep score improved (+10 pts)');
    });

    it('does not claim day-over-day stability without a prior-day snapshot', () => {
        const deltas = computeDayOverDayDeltas(sampleSnapshot(), null, 'train', null);
        expect(deltas.hasYesterdayData).toBe(false);
        expect(deltas.summaryText).toContain('No comparable prior-day snapshot');
    });

    it('ranks top decision evidence factors with impact badges', () => {
        const today = sampleSnapshot();
        const yesterday = sampleSnapshot({ hrvOvernightAvg: 50 });
        const rec = sampleRecommendation();
        const deltas = computeDayOverDayDeltas(today, yesterday, 'train', null);

        const evidence = computeRankedEvidence(rec, sampleInput({ recoverySnapshot: today }), deltas);
        expect(evidence.length).toBeGreaterThanOrEqual(2);
        expect(evidence[0].category).toBe('recovery');
        expect(evidence[0].impact).toBe('positive');
        expect(evidence[0].description).not.toContain('parasympathetic');
    });

    it('treats soreness as context unless the engine safety envelope restricts tissue loading', () => {
        const rec = sampleRecommendation();
        const deltas = computeDayOverDayDeltas(sampleSnapshot(), sampleSnapshot(), 'train', null);
        const evidence = computeRankedEvidence(rec, sampleInput({ subjectiveCheckin: sampleCheckin({ soreness: 4 }) }), deltas);
        const soreness = evidence.find(item => item.id === 'soreness-context');
        expect(soreness?.weightBadge).toBe('Supporting');
        expect(soreness?.impact).toBe('cautious');
    });

    it('distinguishes hard safety gates from soft optimizations', () => {
        const rec = sampleRecommendation({
            envelopes: {
                safety: {
                    clinicalFlagActive: true,
                    clinicalReason: 'Left Achilles soreness',
                    restrictedModalities: ['Running'],
                },
                plan: {
                    maxAllowableTier: 'Easy',
                    taperActive: false,
                },
            },
        });

        const boundaries = computeDecisionBoundaries(rec, null);
        expect(boundaries.hardGatesActiveCount).toBeGreaterThanOrEqual(1);
        expect(boundaries.harderAdjustmentAllowed).toBe(false);
        const clinicalGate = boundaries.hardGates.find(g => g.id === 'clinical-pain');
        expect(clinicalGate?.active).toBe(true);
        expect(clinicalGate?.severity).toBe('blocking');
    });

    it('locks harder adjustment for restricted modalities even without a clinical flag', () => {
        const rec = sampleRecommendation({
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: ['Running'] },
                plan: { maxAllowableTier: 'Hard', taperActive: false },
            },
        });
        const boundaries = computeDecisionBoundaries(rec, sampleInput());
        expect(boundaries.harderAdjustmentAllowed).toBe(false);
        expect(boundaries.hardGates.find(g => g.id === 'clinical-pain')?.severity).toBe('caution');
    });

    it('locks harder adjustment when the check-in reports illness symptoms', () => {
        const input = sampleInput({ subjectiveCheckin: sampleCheckin({ illnessSymptoms: true }) });
        const boundaries = computeDecisionBoundaries(sampleRecommendation(), input);
        expect(boundaries.harderAdjustmentAllowed).toBe(false);
        expect(boundaries.hardGates.find(g => g.id === 'illness-anomaly')?.active).toBe(true);
    });

    it('locks harder adjustment under a rest or mobility plan ceiling', () => {
        const rec = sampleRecommendation({
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: [] },
                plan: { maxAllowableTier: 'Mobility', taperActive: false },
            },
        });
        expect(computeDecisionBoundaries(rec, sampleInput()).harderAdjustmentAllowed).toBe(false);
    });

    it('provides invalidation triggers that target real one-tap alternative ids', () => {
        const triggers = computeInvalidationTriggers(sampleRecommendation());
        expect(triggers.length).toBe(4);
        expect(triggers.find(t => t.id === 'pain-spike')?.alternativeActionId).toBe('mobility');
        expect(triggers.find(t => t.id === 'time-reduction')?.alternativeActionId).toBe('time-20');
        expect(triggers.find(t => t.id === 'venue-shift')?.alternativeActionId).toBe('home-bodyweight');
        expect(triggers.find(t => t.id === 'illness-symptom')?.alternativeActionId).toBeUndefined();
    });

    it('does not label an incomplete subjective check-in as high confidence', () => {
        const input = sampleInput({
            subjectiveCheckin: sampleCheckin({ dataQuality: { isComplete: false, missingFields: ['fatigue'] } }),
            dataQuality: { hasRecoverySnapshot: true, hasSubjectiveCheckin: true, subjectiveCheckinComplete: false, profileReady: true },
        });
        expect(computeDataConfidence(input).tier).toBe('moderate');
    });

    it('provides honest confidence ratings for complete inputs', () => {
        expect(computeDataConfidence(null).tier).toBe('low');

        const input = sampleInput();
        const assembled = assembleMorningDecisionEvidence(
            input.recoverySnapshot,
            sampleSnapshot({ hrvOvernightAvg: 50 }),
            sampleRecommendation(),
            null,
            input,
        );

        expect(assembled.confidence.tier).toBe('high');
        expect(assembled.boundaries.harderAdjustmentAllowed).toBe(true);
    });
});
