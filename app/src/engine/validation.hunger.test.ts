import { describe, expect, it } from 'vitest';
import { validateCheckin } from './validationCore';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';

describe('hunger check-in validation', () => {
    const baseValidCheckin = {
        userId: 'athlete-1',
        date: '2026-09-14',
        readiness: 7,
        sleepQuality: 8,
        fatigue: 4,
        soreness: 3,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: {
            timeAvailableMin: 60,
            preferredModalityToday: null,
            indoorOnly: false,
        },
        dataQuality: {
            isComplete: true,
            missingFields: [],
        },
    };

    it('accepts valid hunger1To10 and timing', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            hunger1To10: 7,
            hungerTiming: 'morning_pre_breakfast',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.hunger1To10).toBe(7);
        expect(result.data?.hungerTiming).toBe('morning_pre_breakfast');
    });

    it('accepts valid hunger with timing "other"', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            hunger1To10: 1,
            hungerTiming: 'other',
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.hunger1To10).toBe(1);
        expect(result.data?.hungerTiming).toBe('other');
    });

    it('accepts boundary values 1 and 10', () => {
        expect(validateCheckin({ ...baseValidCheckin, hunger1To10: 1, hungerTiming: 'morning_pre_breakfast' }).isValid).toBe(true);
        expect(validateCheckin({ ...baseValidCheckin, hunger1To10: 10, hungerTiming: 'morning_pre_breakfast' }).isValid).toBe(true);
    });

    it('rejects out of bound or non-integer values', () => {
        expect(validateCheckin({ ...baseValidCheckin, hunger1To10: 0, hungerTiming: 'morning_pre_breakfast' }).isValid).toBe(false);
        expect(validateCheckin({ ...baseValidCheckin, hunger1To10: 11, hungerTiming: 'morning_pre_breakfast' }).isValid).toBe(false);
        expect(validateCheckin({ ...baseValidCheckin, hunger1To10: 5.5, hungerTiming: 'morning_pre_breakfast' }).isValid).toBe(false);
    });

    it('rejects hunger without timing and timing without hunger', () => {
        const noTiming = validateCheckin({ ...baseValidCheckin, hunger1To10: 5 });
        expect(noTiming.isValid).toBe(false);
        expect(noTiming.errors.some(e => e.field === 'hungerTiming')).toBe(true);

        const noHunger = validateCheckin({ ...baseValidCheckin, hungerTiming: 'morning_pre_breakfast' });
        expect(noHunger.isValid).toBe(false);
        expect(noHunger.errors.some(e => e.field === 'hunger1To10')).toBe(true);
    });

    it('accepts clearing hunger with both set to null', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            hunger1To10: null,
            hungerTiming: null,
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.hunger1To10).toBeNull();
        expect(result.data?.hungerTiming).toBeNull();
    });

    it('rejects clearing hunger while leaving timing non-null', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            hunger1To10: null,
            hungerTiming: 'morning_pre_breakfast',
        });
        expect(result.isValid).toBe(false);
    });

    it('omits hunger fields when not provided without impacting dataQuality', () => {
        const result = validateCheckin(baseValidCheckin);
        expect(result.isValid).toBe(true);
        expect(result.data?.hunger1To10).toBeUndefined();
        expect(result.data?.hungerTiming).toBeUndefined();
        expect(result.data?.dataQuality.missingFields).not.toContain('hunger1To10');
        expect(result.data?.dataQuality.missingFields).not.toContain('hungerTiming');
        expect(result.data?.dataQuality.isComplete).toBe(true);
    });

    describe('parseSubjectiveCheckin parser', () => {
        it('parses valid hunger and timing correctly', () => {
            const parsed = parseSubjectiveCheckin({
                ...baseValidCheckin,
                hunger1To10: 6,
                hungerTiming: 'morning_pre_breakfast',
            }, 'test/path', 'athlete-1', '2026-09-14');
            expect(parsed.status).toBe('AVAILABLE');
            if (parsed.status === 'AVAILABLE') {
                expect(parsed.data.hunger1To10).toBe(6);
                expect(parsed.data.hungerTiming).toBe('morning_pre_breakfast');
            }
        });

        it('rejects invalid timing enum in parseSubjectiveCheckin', () => {
            const parsed = parseSubjectiveCheckin({
                ...baseValidCheckin,
                hunger1To10: 6,
                hungerTiming: 'invalid_timing',
            }, 'test/path', 'athlete-1', '2026-09-14');
            expect(parsed.status).toBe('INVALID');
        });
    });
});
