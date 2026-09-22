import { describe, expect, it } from 'vitest';
import { mapNutritionDocToNutritionDay, parseNutritionDayDoc, nutritionService } from '../nutritionService';

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

        const state = await nutritionService.getNutritionDaysState('', '2026-09-01', '2026-09-20');
        expect(state).toEqual({ status: 'MISSING' });
    });

    describe('parseNutritionDayDoc runtime validation (DataState boundary)', () => {
        const validDoc = {
            schemaVersion: 1,
            logicalDate: '2026-09-20',
            provider: 'garmin',
            transport: 'garmin_connect',
            origin: 'myfitnesspal',
            energyIntakeKcal: 2150,
            hasIntakeData: true,
        };

        it('returns AVAILABLE for a well-formed nutrition document', () => {
            const parsed = parseNutritionDayDoc(validDoc, 'users/u1/nutrition_days/2026-09-20');
            expect(parsed.status).toBe('AVAILABLE');
            if (parsed.status === 'AVAILABLE') {
                expect(parsed.data.date).toBe('2026-09-20');
                expect(parsed.data.energyIntakeKcal).toBe(2150);
            }
        });

        it('returns INVALID when document is not an object', () => {
            const parsed = parseNutritionDayDoc('string-data', 'users/u1/nutrition_days/2026-09-20');
            expect(parsed).toEqual({
                status: 'INVALID',
                issues: [{ code: 'not-an-object', documentPath: 'users/u1/nutrition_days/2026-09-20' }],
            });
        });

        it('returns INVALID when date is invalid or missing', () => {
            const parsedMissingDate = parseNutritionDayDoc({ ...validDoc, logicalDate: undefined, date: undefined }, 'users/u1/nutrition_days/doc-1');
            expect(parsedMissingDate.status).toBe('INVALID');
            if (parsedMissingDate.status === 'INVALID') {
                expect(parsedMissingDate.issues).toContainEqual(expect.objectContaining({ code: 'invalid-date', field: 'date' }));
            }

            const parsedMalformedDate = parseNutritionDayDoc({ ...validDoc, logicalDate: 'not-a-date' }, 'users/u1/nutrition_days/doc-1');
            expect(parsedMalformedDate.status).toBe('INVALID');
            if (parsedMalformedDate.status === 'INVALID') {
                expect(parsedMalformedDate.issues).toContainEqual(expect.objectContaining({ code: 'invalid-date', field: 'date' }));
            }
        });

        it('returns INVALID when energyIntakeKcal is a string or negative number', () => {
            const parsedStringKcal = parseNutritionDayDoc({ ...validDoc, energyIntakeKcal: '2200' }, 'users/u1/nutrition_days/doc-1');
            expect(parsedStringKcal.status).toBe('INVALID');
            if (parsedStringKcal.status === 'INVALID') {
                expect(parsedStringKcal.issues).toContainEqual(expect.objectContaining({ code: 'invalid-numeric-field', field: 'energyIntakeKcal' }));
            }

            const parsedNegativeKcal = parseNutritionDayDoc({ ...validDoc, energyIntakeKcal: -100 }, 'users/u1/nutrition_days/doc-1');
            expect(parsedNegativeKcal.status).toBe('INVALID');
            if (parsedNegativeKcal.status === 'INVALID') {
                expect(parsedNegativeKcal.issues).toContainEqual(expect.objectContaining({ code: 'invalid-numeric-field', field: 'energyIntakeKcal' }));
            }
        });

        it('returns INVALID when schemaVersion is invalid', () => {
            const parsedBadVersion = parseNutritionDayDoc({ ...validDoc, schemaVersion: 0 }, 'users/u1/nutrition_days/doc-1');
            expect(parsedBadVersion.status).toBe('INVALID');
            if (parsedBadVersion.status === 'INVALID') {
                expect(parsedBadVersion.issues).toContainEqual(expect.objectContaining({ code: 'unsupported-schema-version', field: 'schemaVersion' }));
            }
        });

        it('returns INVALID when macronutrients contain non-numeric values', () => {
            const parsedBadMacro = parseNutritionDayDoc({ ...validDoc, proteinG: 'high' }, 'users/u1/nutrition_days/doc-1');
            expect(parsedBadMacro.status).toBe('INVALID');
            if (parsedBadMacro.status === 'INVALID') {
                expect(parsedBadMacro.issues).toContainEqual(expect.objectContaining({ code: 'invalid-numeric-field', field: 'proteinG' }));
            }
        });
    });
});
