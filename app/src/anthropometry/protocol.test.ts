import { describe, expect, it } from 'vitest';
import {
    calculateCircumferenceTolerance,
    calculateMedian,
    deriveObservedAtForLocalDate,
    exceedsCircumferenceTolerance,
    summarizeMeasurementItem,
} from './protocol';
import { getLocalDateString } from '../utils/localDate';

describe('anthropometry protocol (home_anthropometry@1)', () => {
    describe('calculateCircumferenceTolerance', () => {
        it('uses 1.0 cm minimum floor when 1% of mean is less than 1.0 cm', () => {
            expect(calculateCircumferenceTolerance(80, 80)).toBe(1.0);
            expect(calculateCircumferenceTolerance(79.5, 80.5)).toBe(1.0);
        });

        it('uses 1% of mean when mean exceeds 100 cm', () => {
            expect(calculateCircumferenceTolerance(120, 120)).toBe(1.2);
            expect(calculateCircumferenceTolerance(150, 150)).toBe(1.5);
        });
    });

    describe('exceedsCircumferenceTolerance', () => {
        it('returns false when pair difference is within tolerance', () => {
            expect(exceedsCircumferenceTolerance(80.0, 80.5)).toBe(false);
            expect(exceedsCircumferenceTolerance(80.0, 81.0)).toBe(false);
        });

        it('returns true when pair difference exceeds tolerance', () => {
            expect(exceedsCircumferenceTolerance(80.0, 81.2)).toBe(true);
            expect(exceedsCircumferenceTolerance(120.0, 121.5)).toBe(true);
        });
    });

    describe('calculateMedian', () => {
        it('calculates median of single value', () => {
            expect(calculateMedian([75.5])).toBe(75.5);
        });

        it('calculates median of two values as their arithmetic average', () => {
            expect(calculateMedian([80.0, 81.0])).toBe(80.5);
        });

        it('calculates median of three values as the middle sorted value', () => {
            expect(calculateMedian([82.0, 80.0, 81.0])).toBe(81.0);
            expect(calculateMedian([80.0, 80.2, 80.8])).toBe(80.2);
        });
    });

    describe('summarizeMeasurementItem', () => {
        it('summarizes manual body mass (1 reading)', () => {
            const item = summarizeMeasurementItem('body_mass_kg', [74.345]);
            expect(item).toEqual({
                metricId: 'body_mass_kg',
                unit: 'kg',
                readings: [74.35],
                value: 74.35,
            });
        });

        it('rejects manual body mass with multiple readings', () => {
            expect(() => summarizeMeasurementItem('body_mass_kg', [74.0, 74.2])).toThrow();
        });

        it('summarizes circumference with 2 readings within tolerance', () => {
            const item = summarizeMeasurementItem('waist_minimum_cm', [82.2, 82.8]);
            expect(item).toEqual({
                metricId: 'waist_minimum_cm',
                unit: 'cm',
                readings: [82.2, 82.8],
                value: 82.5,
                repeatabilityWarning: false,
            });
        });

        it('summarizes circumference with 3 readings when 3rd reading was prompted', () => {
            const item = summarizeMeasurementItem('waist_minimum_cm', [82.0, 83.5, 82.6]);
            expect(item).toEqual({
                metricId: 'waist_minimum_cm',
                unit: 'cm',
                readings: [82.0, 83.5, 82.6],
                value: 82.6,
                repeatabilityWarning: true,
            });
        });

        it('requires the prompted third reading when the first pair exceeds tolerance', () => {
            expect(() => summarizeMeasurementItem('waist_minimum_cm', [82.0, 83.5])).toThrow('requires a third reading');
        });

        it('rejects an unnecessary third reading when the first pair is within tolerance', () => {
            expect(() => summarizeMeasurementItem('waist_minimum_cm', [82.0, 82.4, 82.2])).toThrow('only accepts a third reading');
        });

        it('attaches laterality for limb measurements', () => {
            const item = summarizeMeasurementItem('thigh_mid_cm', [55.0, 55.4], 'left');
            expect(item.laterality).toBe('left');

            const itemDefault = summarizeMeasurementItem('thigh_mid_cm', [55.0, 55.4]);
            expect(itemDefault.laterality).toBe('unspecified');
        });
    });

    describe('deriveObservedAtForLocalDate', () => {
        it('uses the real current instant when the date is today in Warsaw local time', () => {
            const now = new Date('2026-09-14T20:00:00Z');
            const today = getLocalDateString(now);
            const observedAt = deriveObservedAtForLocalDate(today, now);
            expect(observedAt).toBe(now.toISOString());
        });

        it('synthesizes a noon-UTC instant for a non-today (backdated) date', () => {
            const now = new Date('2026-09-14T10:00:00Z');
            const observedAt = deriveObservedAtForLocalDate('2026-09-10', now);
            expect(observedAt).toBe('2026-09-10T12:00:00.000Z');
            expect(getLocalDateString(new Date(observedAt))).toBe('2026-09-10');
        });

        it('the synthesized instant resolves back to the same Warsaw date across a DST boundary', () => {
            const now = new Date('2026-11-01T09:00:00Z');
            const observedAt = deriveObservedAtForLocalDate('2026-10-25', now);
            expect(getLocalDateString(new Date(observedAt))).toBe('2026-10-25');
        });
    });
});
