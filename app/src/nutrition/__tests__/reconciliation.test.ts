import { describe, expect, it } from 'vitest';
import type { NutritionDay } from '../models';
import { reconcileDailyNutrition, reconcileNutritionHistory } from '../reconciliation';

describe('Nutrition Reconciliation', () => {
    it('reconciles single-source nutrition day correctly', () => {
        const record: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T08:00:00Z',
            energyIntakeKcal: 2150,
            energyExpenditureKcal: {
                resting: 1850,
                active: 550,
                total: 2400,
            },
            macronutrients: null,
            micronutrients: null,
            isPartialDay: true,
            confidenceScore: 1.0,
        };

        const result = reconcileDailyNutrition([record]);
        expect(result).not.toBeNull();
        expect(result?.date).toBe('2026-09-20');
        expect(result?.energyIntakeKcal).toBe(2150);
        expect(result?.hasIntakeData).toBe(true);
        expect(result?.energyExpenditureKcal).toEqual({
            resting: 1850,
            active: 550,
            total: 2400,
        });
        expect(result?.hasExpenditureData).toBe(true);
        expect(result?.isPartialDay).toBe(true);
        expect(result?.primaryIntakeSource?.origin).toBe('myfitnesspal');

        // Missing macronutrients must be null, never 0
        expect(result?.macronutrients.proteinGrams).toBeNull();
        expect(result?.macronutrients.carbsGrams).toBeNull();
        expect(result?.macronutrients.fatGrams).toBeNull();
    });

    it('deduplicates identical origins across different transports without double-counting', () => {
        // Same food log synced through Garmin Connect AND Health Connect
        const garminMirror: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T08:00:00Z',
            energyIntakeKcal: 2150,
            energyExpenditureKcal: { resting: 1800, active: 500, total: 2300 },
            confidenceScore: 0.9,
        };

        const directHealthConnect: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'health_connect',
                transport: 'health_connect',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T08:05:00Z',
            energyIntakeKcal: 2150,
            macronutrients: {
                proteinGrams: 140,
                carbsGrams: 230,
                fatGrams: 65,
                fiberGrams: 30,
            },
            confidenceScore: 1.0,
        };

        const result = reconcileDailyNutrition([garminMirror, directHealthConnect]);
        expect(result).not.toBeNull();
        // Must NOT double count calories (2150 + 2150 = 4300 would be wrong!)
        expect(result?.energyIntakeKcal).toBe(2150);
        // Direct Health Connect has higher transport priority than Garmin mirror
        expect(result?.primaryIntakeSource?.transport).toBe('health_connect');
        // Macros should be preserved from the higher-fidelity source
        expect(result?.macronutrients.proteinGrams).toBe(140);
        expect(result?.macronutrients.carbsGrams).toBe(230);
    });

    it('handles days with only expenditure or only intake', () => {
        const intakeOnly: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-19',
            source: { provider: 'manual', transport: 'manual', origin: 'manual' },
            syncedAt: '2026-09-19T20:00:00Z',
            energyIntakeKcal: 1900,
        };

        const resIntake = reconcileDailyNutrition([intakeOnly]);
        expect(resIntake?.hasIntakeData).toBe(true);
        expect(resIntake?.energyIntakeKcal).toBe(1900);
        expect(resIntake?.hasExpenditureData).toBe(false);
        expect(resIntake?.energyExpenditureKcal).toBeNull();

        const expenditureOnly: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-19',
            source: { provider: 'garmin', transport: 'garmin_connect', origin: 'garmin' },
            syncedAt: '2026-09-19T23:59:00Z',
            energyExpenditureKcal: { resting: 1750, active: 450, total: 2200 },
        };

        const resExp = reconcileDailyNutrition([expenditureOnly]);
        expect(resExp?.hasIntakeData).toBe(false);
        expect(resExp?.energyIntakeKcal).toBeNull();
        expect(resExp?.hasExpenditureData).toBe(true);
        expect(resExp?.energyExpenditureKcal?.total).toBe(2200);
    });

    it('reconciles multi-day history sorted by date', () => {
        const days: NutritionDay[] = [
            {
                schemaVersion: 1,
                date: '2026-09-20',
                source: { provider: 'garmin', transport: 'garmin_connect', origin: 'garmin' },
                syncedAt: '2026-09-20T10:00:00Z',
                energyExpenditureKcal: { resting: 1800, active: 400, total: 2200 },
            },
            {
                schemaVersion: 1,
                date: '2026-09-18',
                source: { provider: 'garmin', transport: 'garmin_connect', origin: 'myfitnesspal' },
                syncedAt: '2026-09-18T22:00:00Z',
                energyIntakeKcal: 2500,
            },
            {
                schemaVersion: 1,
                date: '2026-09-19',
                source: { provider: 'garmin', transport: 'garmin_connect', origin: 'myfitnesspal' },
                syncedAt: '2026-09-19T22:00:00Z',
                energyIntakeKcal: 2300,
            },
        ];

        const history = reconcileNutritionHistory(days);
        expect(history.length).toBe(3);
        expect(history.map((h) => h.date)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
        expect(history[0].energyIntakeKcal).toBe(2500);
        expect(history[1].energyIntakeKcal).toBe(2300);
        expect(history[2].hasExpenditureData).toBe(true);
    });
    it('prefers macro-complete data over a higher transport-priority calories-only mirror', () => {
        const caloriesOnlyDirect: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'direct_partner',
                transport: 'direct_api',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T08:10:00Z',
            energyIntakeKcal: 2200,
            hasIntakeData: true,
            confidenceScore: 1.0,
        };

        const macroCompleteHealth: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'health_connect',
                transport: 'health_connect',
                origin: 'myfitnesspal',
            },
            syncedAt: '2026-09-20T08:00:00Z',
            energyIntakeKcal: 2200,
            hasIntakeData: true,
            macronutrients: {
                proteinGrams: 150,
                carbsGrams: 225,
                fatGrams: 70,
                fiberGrams: 28,
            },
            confidenceScore: 0.9,
        };

        const result = reconcileDailyNutrition([caloriesOnlyDirect, macroCompleteHealth]);

        expect(result?.energyIntakeKcal).toBe(2200);
        expect(result?.primaryIntakeSource?.transport).toBe('health_connect');
        expect(result?.macronutrients.proteinGrams).toBe(150);
    });

    it('does not deduplicate records with an unverified origin across different transports', () => {
        const garminUnknown: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: null,
            },
            syncedAt: '2026-09-20T08:00:00Z',
            energyIntakeKcal: 2100,
            hasIntakeData: true,
        };

        const healthUnknown: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: {
                provider: 'health_connect',
                transport: 'health_connect',
                origin: null,
            },
            syncedAt: '2026-09-20T08:05:00Z',
            energyIntakeKcal: 2100,
            hasIntakeData: true,
            macronutrients: {
                proteinGrams: 145,
                carbsGrams: 215,
                fatGrams: 68,
                fiberGrams: 25,
            },
        };

        const result = reconcileDailyNutrition([garminUnknown, healthUnknown]);

        expect(result?.sources).toHaveLength(2);
        expect(result?.primaryIntakeSource?.transport).toBe('health_connect');
        expect(result?.energyIntakeKcal).toBe(2100);
    });

    it('honors explicit hasIntakeData=false even if a stale numeric value is present', () => {
        const inconsistentRecord: NutritionDay = {
            schemaVersion: 1,
            date: '2026-09-20',
            source: { provider: 'garmin', transport: 'garmin_connect', origin: null },
            syncedAt: '2026-09-20T08:00:00Z',
            energyIntakeKcal: 2000,
            hasIntakeData: false,
        };

        const result = reconcileDailyNutrition([inconsistentRecord]);

        expect(result?.hasIntakeData).toBe(false);
        expect(result?.energyIntakeKcal).toBeNull();
        expect(result?.primaryIntakeSource).toBeNull();
    });

});
