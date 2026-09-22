import { describe, expect, it } from 'vitest';
import { validateCheckin, computeDataQuality } from './validationCore';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';
import { NUTRITION_TRACKING_ADHERENCE_LEVELS } from './models';

describe('nutritionAdherenceYesterday validation (ADR-0042)', () => {
    const baseValidCheckin = {
        userId: 'athlete-1',
        date: '2026-09-22',
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

    it('accepts each valid adherence level', () => {
        for (const level of NUTRITION_TRACKING_ADHERENCE_LEVELS) {
            const result = validateCheckin({
                ...baseValidCheckin,
                nutritionAdherenceYesterday: level,
            });
            expect(result.isValid).toBe(true);
            expect(result.data?.nutritionAdherenceYesterday).toBe(level);
        }
    });

    it('accepts null and normalizes empty string to null', () => {
        const nullResult = validateCheckin({
            ...baseValidCheckin,
            nutritionAdherenceYesterday: null,
        });
        expect(nullResult.isValid).toBe(true);
        expect(nullResult.data?.nutritionAdherenceYesterday).toBeNull();

        const emptyStringResult = validateCheckin({
            ...baseValidCheckin,
            nutritionAdherenceYesterday: '',
        });
        expect(emptyStringResult.isValid).toBe(true);
        expect(emptyStringResult.data?.nutritionAdherenceYesterday).toBeNull();
    });

    it('omits field when undefined', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            nutritionAdherenceYesterday: undefined,
        });
        expect(result.isValid).toBe(true);
        expect(result.data?.nutritionAdherenceYesterday).toBeUndefined();
        expect('nutritionAdherenceYesterday' in (result.data ?? {})).toBe(false);
    });

    it('rejects unrecognized adherence values', () => {
        const result = validateCheckin({
            ...baseValidCheckin,
            nutritionAdherenceYesterday: 'partially_tracked',
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
            expect.objectContaining({ field: 'nutritionAdherenceYesterday' }),
        );
    });

    it('does not affect check-in completeness in computeDataQuality', () => {
        // Without nutritionAdherenceYesterday
        const dqWithout = computeDataQuality(baseValidCheckin);
        expect(dqWithout.isComplete).toBe(true);
        expect(dqWithout.missingFields).not.toContain('nutritionAdherenceYesterday');

        // With null nutritionAdherenceYesterday
        const dqWithNull = computeDataQuality({
            ...baseValidCheckin,
            nutritionAdherenceYesterday: null,
        });
        expect(dqWithNull.isComplete).toBe(true);
        expect(dqWithNull.missingFields).not.toContain('nutritionAdherenceYesterday');
    });

    it('persists and round-trips correctly via parseSubjectiveCheckin', () => {
        const path = 'users/athlete-1/daily_subjective_checkins/2026-09-22';
        for (const level of NUTRITION_TRACKING_ADHERENCE_LEVELS) {
            const parsed = parseSubjectiveCheckin(
                { ...baseValidCheckin, nutritionAdherenceYesterday: level },
                path,
                'athlete-1',
                '2026-09-22',
            );
            expect(parsed.status).toBe('AVAILABLE');
            if (parsed.status === 'AVAILABLE') {
                expect(parsed.data.nutritionAdherenceYesterday).toBe(level);
            }
        }
    });
});
