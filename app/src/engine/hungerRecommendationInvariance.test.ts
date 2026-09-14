import { describe, expect, it } from 'vitest';
import { evaluateTrainingWithIntent } from './rules';
import { mapCheckinToSubjectiveInput, mapSnapshotToEngineInput } from './adapters';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin, UserContext } from './models';

describe('ADR-0039 D-BC-AUTH: Hunger recommendation invariance', () => {
    const asOfDate = '2026-09-14';

    const baseCheckin: DailySubjectiveCheckin = {
        userId: 'u1',
        date: asOfDate,
        readiness: 7,
        sleepQuality: 7,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        motivation: 7,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${asOfDate}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${asOfDate}T06:00:00Z`,
        updatedAt: `${asOfDate}T06:00:00Z`,
    };

    const dummySnapshot: DailyRecoverySnapshot = {
        userId: 'u1',
        date: asOfDate,
        source: {
            garminSyncedAt: `${asOfDate}T06:00:00Z`,
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
        },
        raw: {
            restingHr: 50,
            hrvOvernightAvg: 65,
            hrvStatus: 'balanced',
            sleepScore: 82,
            sleepDurationSec: 28800,
            respirationAvg: 14.0,
            bodyBatteryWake: 85,
            bodyBatteryChange: 5,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 79,
            sleepScore28dAvg: 80,
            restingHr7dAvg: 51,
            restingHr28dAvg: 51,
            hrv7dAvg: 63,
            hrv28dAvg: 63,
            respiration7dAvg: 14.0,
            respiration28dAvg: 14.0,
            deltas: {
                sleepScoreVs7d: 3,
                sleepScoreVs28d: 2,
                restingHrVs7d: -1,
                restingHrVs28d: -1,
                hrvVs7d: 2,
                hrvVs28d: 2,
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

    const baseContext: UserContext = {
        preferences: {
            preferredModalities: ['Running', 'Cycling'],
            deprioritizedModalities: [],
            avoidedModalities: [],
            conservativeBias: false,
        },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: false,
            hasTreadmill: false,
            hasIndoorBike: false,
            maxTimeMinutes: 60,
            restrictedModalities: [],
            restrictedCategories: [],
            impliedGuardrails: [],
        },
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
    };

    const emptyHistoryProvider = {
        reconstruct: async () => [],
    };

    async function evaluateForCheckin(checkin: DailySubjectiveCheckin) {
        const subjective = mapCheckinToSubjectiveInput(checkin);
        const objective = mapSnapshotToEngineInput(dummySnapshot);
        const readiness = { subjective, objective };
        return evaluateTrainingWithIntent(
            'u1',
            readiness,
            baseContext,
            [],
            asOfDate,
            undefined,
            emptyHistoryProvider,
        );
    }

    it('produces identical recommendations regardless of hunger score (omitted vs 1 vs 5 vs 10)', async () => {
        const withoutHunger = await evaluateForCheckin(baseCheckin);

        const withHunger1 = await evaluateForCheckin({
            ...baseCheckin,
            hunger1To10: 1,
            hungerTiming: 'morning_pre_breakfast',
        });

        const withHunger5 = await evaluateForCheckin({
            ...baseCheckin,
            hunger1To10: 5,
            hungerTiming: 'morning_pre_breakfast',
        });

        const withHunger10 = await evaluateForCheckin({
            ...baseCheckin,
            hunger1To10: 10,
            hungerTiming: 'other',
        });

        // Verify that decision, mode, systemic cap, template ID, and rationale match identically
        expect(withHunger1.mode).toBe(withoutHunger.mode);
        expect(withHunger1.template.id).toBe(withoutHunger.template.id);
        expect(withHunger1.plannedDose).toEqual(withoutHunger.plannedDose);
        expect(withHunger1.rationale).toBe(withoutHunger.rationale);

        expect(withHunger5.mode).toBe(withoutHunger.mode);
        expect(withHunger5.template.id).toBe(withoutHunger.template.id);
        expect(withHunger5.plannedDose).toEqual(withoutHunger.plannedDose);
        expect(withHunger5.rationale).toBe(withoutHunger.rationale);

        expect(withHunger10.mode).toBe(withoutHunger.mode);
        expect(withHunger10.template.id).toBe(withoutHunger.template.id);
        expect(withHunger10.plannedDose).toEqual(withoutHunger.plannedDose);
        expect(withHunger10.rationale).toBe(withoutHunger.rationale);
    });

    it('asserts mapCheckinToSubjectiveInput completely ignores hunger fields', () => {
        const inputWithoutHunger = mapCheckinToSubjectiveInput(baseCheckin);
        const inputWithHunger = mapCheckinToSubjectiveInput({
            ...baseCheckin,
            hunger1To10: 10,
            hungerTiming: 'morning_pre_breakfast',
        });
        expect(inputWithHunger).toEqual(inputWithoutHunger);
    });
});
