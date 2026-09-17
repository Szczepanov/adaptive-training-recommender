import { describe, expect, it } from 'vitest';
import {
    expandRecurringSchedule,
    validateRecurringSchedule,
    type RecurringScheduleInput,
} from './scheduleWindowRecurrence';

const baseSchedule: RecurringScheduleInput = {
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    rules: [
        { weekdays: [1, 2, 3, 4, 5], startLocal: '06:00', endLocal: '09:00', label: 'Morning' },
        { weekdays: [1, 2, 3, 4, 5], startLocal: '12:00', endLocal: '16:00', label: 'Afternoon' },
        { weekdays: [1, 3, 5], startLocal: '17:30', endLocal: '18:30', label: 'Evening' },
    ],
};

describe('recurring schedule windows', () => {
    it('expands weekday rules into Warsaw-local dated window inputs', () => {
        const expanded = expandRecurringSchedule(baseSchedule);

        expect(expanded).toHaveLength(13);
        expect(expanded.filter(window => window.date === '2026-09-07')).toEqual([
            { date: '2026-09-07', startLocal: '06:00', endLocal: '09:00', label: 'Morning' },
            { date: '2026-09-07', startLocal: '12:00', endLocal: '16:00', label: 'Afternoon' },
            { date: '2026-09-07', startLocal: '17:30', endLocal: '18:30', label: 'Evening' },
        ]);
        expect(expanded.some(window => window.date === '2026-09-12')).toBe(false);
    });

    it('rejects invalid ranges, empty weekday selections, invalid times, overlaps, and oversized date spans', () => {
        expect(validateRecurringSchedule({ ...baseSchedule, startDate: '2026-09-14', endDate: '2026-09-07' })[0].message)
            .toContain('endDate must be on or after startDate');
        expect(validateRecurringSchedule({ ...baseSchedule, rules: [{ ...baseSchedule.rules[0], weekdays: [] }] })[0].message)
            .toContain('at least one weekday');
        expect(validateRecurringSchedule({ ...baseSchedule, rules: [{ ...baseSchedule.rules[0], startLocal: '09:00', endLocal: '09:00' }] })[0].message)
            .toContain('strictly after');
        expect(validateRecurringSchedule({
            ...baseSchedule,
            rules: [
                baseSchedule.rules[0],
                { weekdays: [1], startLocal: '08:00', endLocal: '10:00' },
            ],
        })[0].message).toContain('overlap');
        expect(validateRecurringSchedule({ ...baseSchedule, endDate: '2027-09-13' })[0].message)
            .toContain('366 calendar days');
    });

    it('rejects more than eight generated windows on one date', () => {
        const rules = Array.from({ length: 9 }, (_, index) => ({
            weekdays: [1],
            startLocal: `${String(index + 6).padStart(2, '0')}:00`,
            endLocal: `${String(index + 6).padStart(2, '0')}:30`,
        }));

        expect(validateRecurringSchedule({
            startDate: '2026-09-07',
            endDate: '2026-09-07',
            rules,
        })[0].message).toContain('8 windows');
    });

    it('rejects a repeat range that contains none of the selected weekdays', () => {
        const errors = validateRecurringSchedule({
            startDate: '2026-09-12',
            endDate: '2026-09-13',
            rules: [{ weekdays: [1], startLocal: '06:00', endLocal: '07:00' }],
        });

        expect(errors[0].message).toContain('fall within the repeat range');
    });
});
