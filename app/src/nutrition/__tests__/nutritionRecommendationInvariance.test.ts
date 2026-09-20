import { describe, expect, it } from 'vitest';
import { mapSnapshotToEngineInput } from '../../engine/adapters';
import { evaluateTraining } from '../../engine/rules';
import type { DailyRecoverySnapshot, SubjectiveInput, UserContext } from '../../engine/models';
import type { NutritionDay } from '../models';
import { reconcileDailyNutrition } from '../reconciliation';

function baseContext(): UserContext {
    return {
        goals: { shortTerm: 'General Fitness', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 60,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

function sampleSubjective(): SubjectiveInput {
    return {
        readiness: 7,
        sleepQuality: 8,
        fatigue: 4,
        soreness: 3,
        stress: 3,
        motivation: 7,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };
}

/**
 * A minimal, otherwise-fixed DailyRecoverySnapshot, varying only the three
 * nutrition-adjacent energy-expenditure fields under test. Follows the same
 * `as unknown as DailyRecoverySnapshot` fixture convention used in adapters.test.ts.
 */
function snapshotWithEnergyExpenditure(overrides: {
    activeEnergyKcal?: number | null;
    restingEnergyKcal?: number | null;
    totalEnergyExpenditureKcal?: number | null;
}): DailyRecoverySnapshot {
    return {
        raw: {
            totalSteps: 8500,
            sleepScore: 82,
            sleepDurationSec: 27600,
            restingHr: 52,
            hrvOvernightAvg: 55,
            respirationAvg: 14.2,
            bodyBatteryWake: 80,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
            ...overrides,
        },
        derived: {
            baselineComputationVersion: 6,
            restingHr7dAvg: 52,
            hrv7dAvg: 55,
            steps7dAvg: 8000,
            steps28dAvg: 8200,
            hrv28dStdev: 7,
            restingHr28dStdev: 3,
            sleepScore28dStdev: 6,
            steps28dStdev: 500,
            respiration28dMad: 0.8,
            deltas: {
                sleepScoreVs7d: 0,
                sleepScoreVs28d: 0,
                restingHrVs7d: 0,
                restingHrVs28d: 0,
                hrvVs7d: 0,
                hrvVs28d: 0,
                respirationVs7d: 0,
                respirationVs28d: 0,
                stepsVs7d: 0,
                stepsVs28d: 0,
            },
        },
    } as unknown as DailyRecoverySnapshot;
}

describe('ADR-0042: Nutrition/expenditure decision-authority invariance', () => {
    it('mapSnapshotToEngineInput produces byte-identical EngineObjectiveInput regardless of energy-expenditure fields', () => {
        const noEnergyData = mapSnapshotToEngineInput(
            snapshotWithEnergyExpenditure({
                activeEnergyKcal: null,
                restingEnergyKcal: null,
                totalEnergyExpenditureKcal: null,
            }),
        );
        const withEnergyData = mapSnapshotToEngineInput(
            snapshotWithEnergyExpenditure({
                activeEnergyKcal: 1200,
                restingEnergyKcal: 1800,
                totalEnergyExpenditureKcal: 3000,
            }),
        );
        const extremeEnergyData = mapSnapshotToEngineInput(
            snapshotWithEnergyExpenditure({
                activeEnergyKcal: 0,
                restingEnergyKcal: 6000,
                totalEnergyExpenditureKcal: 6000,
            }),
        );

        expect(withEnergyData).toEqual(noEnergyData);
        expect(extremeEnergyData).toEqual(noEnergyData);
    });

    it('produces identical recommendations end-to-end whether energy-expenditure data is present, absent, or extreme', () => {
        const context = baseContext();
        const subjective = sampleSubjective();

        const scenarios = [
            { activeEnergyKcal: null, restingEnergyKcal: null, totalEnergyExpenditureKcal: null },
            { activeEnergyKcal: 1200, restingEnergyKcal: 1800, totalEnergyExpenditureKcal: 3000 },
            { activeEnergyKcal: 400, restingEnergyKcal: 1600, totalEnergyExpenditureKcal: 2000 },
            { activeEnergyKcal: 0, restingEnergyKcal: 6000, totalEnergyExpenditureKcal: 6000 },
        ];

        const baseRec = evaluateTraining(
            { subjective, objective: mapSnapshotToEngineInput(snapshotWithEnergyExpenditure(scenarios[0])) },
            context,
            '2026-09-20',
        );

        for (const scenario of scenarios) {
            const objective = mapSnapshotToEngineInput(snapshotWithEnergyExpenditure(scenario));
            const rec = evaluateTraining({ subjective, objective }, context, '2026-09-20');
            expect(rec).toEqual(baseRec);
        }
    });

    it('reconciling nutrition observations (severe deficit, surplus, zero-logged, missing) never throws and stays outside the engine input path', () => {
        const nutritionScenarios: (NutritionDay[] | null)[] = [
            null, // No nutrition data
            [], // Empty nutrition data
            [
                // Severe deficit scenario: 1000 kcal intake vs 3000 kcal expenditure
                {
                    schemaVersion: 1,
                    date: '2026-09-20',
                    source: { provider: 'garmin', transport: 'garmin_connect', origin: 'myfitnesspal' },
                    syncedAt: '2026-09-20T12:00:00Z',
                    energyIntakeKcal: 1000,
                    energyExpenditureKcal: { resting: 1800, active: 1200, total: 3000 },
                    macronutrients: null,
                },
            ],
            [
                // Massive surplus scenario: 5000 kcal intake vs 2000 kcal expenditure
                {
                    schemaVersion: 1,
                    date: '2026-09-20',
                    source: { provider: 'garmin', transport: 'garmin_connect', origin: 'myfitnesspal' },
                    syncedAt: '2026-09-20T22:00:00Z',
                    energyIntakeKcal: 5000,
                    energyExpenditureKcal: { resting: 1600, active: 400, total: 2000 },
                    macronutrients: { proteinGrams: 200, carbsGrams: 650, fatGrams: 150 },
                },
            ],
            [
                // Zero calories logged (distinct from "not logged" -- must not throw or mutate)
                {
                    schemaVersion: 1,
                    date: '2026-09-20',
                    source: { provider: 'manual', transport: 'manual', origin: 'manual' },
                    syncedAt: '2026-09-20T22:00:00Z',
                    energyIntakeKcal: 0,
                },
            ],
        ];

        for (const scenario of nutritionScenarios) {
            if (scenario) {
                const reconciled = reconcileDailyNutrition(scenario);
                expect(reconciled).toBeDefined();
            }
        }

        // mapSnapshotToEngineInput and EngineObjectiveInput have no nutrition-shaped
        // fields at all -- there is no parameter through which reconciled nutrition
        // could reach evaluateTraining even if a caller tried to pass it.
        const objectiveInputKeys = Object.keys(
            mapSnapshotToEngineInput(snapshotWithEnergyExpenditure({})),
        );
        expect(objectiveInputKeys.some(key => /nutrition|kcal|calorie|macro/i.test(key))).toBe(false);
    });
});
