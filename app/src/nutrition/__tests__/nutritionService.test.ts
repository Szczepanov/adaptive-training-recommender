import { describe, expect, it } from 'vitest';
import { mapNutritionDocToNutritionDay, nutritionService } from '../nutritionService';

describe('NutritionService and Document Mapper', () => {
    it('correctly maps flat backend DTO format to domain NutritionDay', () => {
        const rawBackendDoc = {
            schemaVersion: 1,
            logicalDate: '2026-09-20',
            provider: 'garmin',
            transport: 'garmin_connect',
            origin: 'myfitnesspal',
            energyIntakeKcal: 2150,
            goalEnergyIntakeKcal: 2200,
            proteinG: 145,
            carbohydrateG: 230,
            fatG: 65,
            fiberG: 28,
            sodiumMg: 2300,
            potassiumMg: 3100,
            waterMl: 2500,
            isPartial: true,
            hasIntakeData: true,
            confidenceScore: 0.95,
            ingestedAt: '2026-09-20T12:00:00Z',
            rawPayloadHash: 'hash-abc-123',
        };

        const result = mapNutritionDocToNutritionDay(rawBackendDoc);

        expect(result.schemaVersion).toBe(1);
        expect(result.date).toBe('2026-09-20');
        expect(result.source).toEqual({
            provider: 'garmin',
            transport: 'garmin_connect',
            origin: 'myfitnesspal',
        });
        expect(result.energyIntakeKcal).toBe(2150);
        expect(result.hasIntakeData).toBe(true);
        expect(result.macronutrients).toEqual({
            proteinGrams: 145,
            carbsGrams: 230,
            fatGrams: 65,
            fiberGrams: 28,
        });
        expect(result.micronutrients).toEqual({
            sodiumMg: 2300,
            potassiumMg: 3100,
            waterMl: 2500,
        });
        expect(result.isPartialDay).toBe(true);
        expect(result.confidenceScore).toBe(0.95);
        expect(result.syncedAt).toBe('2026-09-20T12:00:00Z');
        expect(result.rawPayloadHash).toBe('hash-abc-123');
    });

    it('correctly maps nested client format with missing macros as null', () => {
        const nestedDoc = {
            schemaVersion: 1,
            date: '2026-09-19',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: 'myfitnesspal',
            },
            energyIntakeKcal: 1980,
            isPartialDay: false,
            syncedAt: '2026-09-19T23:00:00Z',
        };

        const result = mapNutritionDocToNutritionDay(nestedDoc);

        expect(result.date).toBe('2026-09-19');
        expect(result.source.origin).toBe('myfitnesspal');
        expect(result.energyIntakeKcal).toBe(1980);
        expect(result.hasIntakeData).toBe(true);
        expect(result.macronutrients).toBeNull();
        expect(result.isPartialDay).toBe(false);
    });

    it('handles empty/sparse documents safely with fallback defaults', () => {
        const emptyDoc = {};
        const result = mapNutritionDocToNutritionDay(emptyDoc);

        expect(result.date).toBe('');
        expect(result.source.provider).toBe('unknown');
        expect(result.source.origin).toBeNull();
        expect(result.energyIntakeKcal).toBeNull();
        expect(result.hasIntakeData).toBe(false);
        expect(result.macronutrients).toBeNull();
        expect(result.isPartialDay).toBe(false);
    });

    it('preserves an explicitly unknown upstream origin instead of inventing provider provenance', () => {
        const result = mapNutritionDocToNutritionDay({
            logicalDate: '2026-09-20',
            provider: 'garmin',
            transport: 'garmin_connect',
            source: {
                provider: 'garmin',
                transport: 'garmin_connect',
                origin: null,
            },
            energyIntakeKcal: 2100,
            hasIntakeData: true,
            ingestedAt: '2026-09-20T12:00:00Z',
        });

        expect(result.source.origin).toBeNull();
        expect(result.hasIntakeData).toBe(true);
    });

    it('nutritionService handles empty userId safely', async () => {
        const days = await nutritionService.getNutritionDays('', '2026-09-01', '2026-09-20');
        expect(days).toEqual([]);
    });
});
