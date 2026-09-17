import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import { isValidDate, type ValidationError } from './validationCore';
import { MAX_SCHEDULE_WINDOWS_PER_DATE, scheduleWindowsOverlap } from './scheduleWindows';

export const MAX_RECURRING_SCHEDULE_DAYS = 366;
export const MAX_RECURRING_SCHEDULE_RULES = 16;
export const WEEKDAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface RecurringScheduleRule {
    weekdays: readonly number[];
    startLocal: string;
    endLocal: string;
    label?: string;
}

export interface RecurringScheduleInput {
    startDate: string;
    endDate: string;
    rules: readonly RecurringScheduleRule[];
}

export type NewScheduleWindowInput = Omit<RecurringScheduleRule, 'weekdays'> & { date: string };

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_LABEL_LENGTH = 100;

function weekdayNumber(date: string): number {
    const [year, month, day] = date.split('-').map(Number);
    const sundayBasedDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return sundayBasedDay === 0 ? 7 : sundayBasedDay;
}

function isValidTime(value: string): boolean {
    return typeof value === 'string' && HHMM_PATTERN.test(value);
}

function dateList(startDate: string, endDate: string): string[] {
    const dayCount = getDayDiff(endDate, startDate);
    return Array.from({ length: dayCount + 1 }, (_, index) => addDaysToLocalDateString(startDate, index));
}

/** Validates a repeating set before it is expanded into the existing dated-window model. */
export function validateRecurringSchedule(input: RecurringScheduleInput): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!isValidDate(input.startDate)) errors.push({ field: 'startDate', message: 'startDate must be a valid date (YYYY-MM-DD)' });
    if (!isValidDate(input.endDate)) errors.push({ field: 'endDate', message: 'endDate must be a valid date (YYYY-MM-DD)' });

    const datesAreValid = isValidDate(input.startDate) && isValidDate(input.endDate);
    const dayCount = datesAreValid ? getDayDiff(input.endDate, input.startDate) + 1 : 0;
    if (datesAreValid && input.endDate < input.startDate) {
        errors.push({ field: 'endDate', message: 'endDate must be on or after startDate' });
    } else if (datesAreValid && dayCount > MAX_RECURRING_SCHEDULE_DAYS) {
        errors.push({ field: 'dateRange', message: `A repeating schedule can span at most ${MAX_RECURRING_SCHEDULE_DAYS} calendar days` });
    }

    if (!Array.isArray(input.rules) || input.rules.length === 0) {
        errors.push({ field: 'rules', message: 'Add at least one time block' });
        return errors;
    }
    if (input.rules.length > MAX_RECURRING_SCHEDULE_RULES) {
        errors.push({ field: 'rules', message: `A repeating schedule can contain at most ${MAX_RECURRING_SCHEDULE_RULES} time blocks` });
    }

    input.rules.forEach((rule, index) => {
        const field = `rules[${index}]`;
        const weekdays = rule.weekdays;
        if (!Array.isArray(weekdays) || weekdays.length === 0) {
            errors.push({ field: `${field}.weekdays`, message: 'Select at least one weekday for every time block' });
        } else {
            const uniqueWeekdays = new Set(weekdays);
            if (uniqueWeekdays.size !== weekdays.length || weekdays.some(day => !WEEKDAY_NUMBERS.includes(day as typeof WEEKDAY_NUMBERS[number]))) {
                errors.push({ field: `${field}.weekdays`, message: 'Weekdays must be unique values from Monday through Sunday' });
            }
        }
        if (!isValidTime(rule.startLocal)) errors.push({ field: `${field}.startLocal`, message: 'Start time must be HH:mm' });
        if (!isValidTime(rule.endLocal)) errors.push({ field: `${field}.endLocal`, message: 'End time must be HH:mm' });
        if (isValidTime(rule.startLocal) && isValidTime(rule.endLocal) && rule.startLocal >= rule.endLocal) {
            errors.push({ field: `${field}.endLocal`, message: 'End time must be strictly after start time on the same day' });
        }
        if (rule.label !== undefined && (typeof rule.label !== 'string' || rule.label.length > MAX_LABEL_LENGTH)) {
            errors.push({ field: `${field}.label`, message: `Label must be at most ${MAX_LABEL_LENGTH} characters` });
        }
    });

    if (datesAreValid && input.endDate >= input.startDate && dayCount <= MAX_RECURRING_SCHEDULE_DAYS) {
        const validRules = input.rules.filter(rule =>
            Array.isArray(rule.weekdays)
            && rule.weekdays.length > 0
            && isValidTime(rule.startLocal)
            && isValidTime(rule.endLocal)
            && rule.startLocal < rule.endLocal,
        );
        let generatedWindowCount = 0;
        for (const date of dateList(input.startDate, input.endDate)) {
            const matchingRules = validRules
                .filter(rule => rule.weekdays.includes(weekdayNumber(date)))
                .sort((left, right) => left.startLocal.localeCompare(right.startLocal));
            generatedWindowCount += matchingRules.length;
            if (matchingRules.length > MAX_SCHEDULE_WINDOWS_PER_DATE) {
                errors.push({ field: `dateRange.${date}`, message: `The schedule would create more than ${MAX_SCHEDULE_WINDOWS_PER_DATE} windows on ${date}` });
            }
            for (let index = 1; index < matchingRules.length; index += 1) {
                if (scheduleWindowsOverlap(matchingRules[index - 1], matchingRules[index])) {
                    errors.push({ field: `dateRange.${date}`, message: `Time blocks overlap on ${date}` });
                    break;
                }
            }
        }
        if (generatedWindowCount === 0) {
            errors.push({ field: 'rules', message: 'At least one selected weekday must fall within the repeat range' });
        }
    }

    return errors;
}

/** Expands a validated repeating schedule into the dated input accepted by the service. */
export function expandRecurringSchedule(input: RecurringScheduleInput): NewScheduleWindowInput[] {
    if (validateRecurringSchedule(input).length > 0) return [];
    return dateList(input.startDate, input.endDate).flatMap(date => input.rules
        .filter(rule => rule.weekdays.includes(weekdayNumber(date)))
        .sort((left, right) => left.startLocal.localeCompare(right.startLocal))
        .map(rule => ({
            date,
            startLocal: rule.startLocal,
            endLocal: rule.endLocal,
            ...(rule.label?.trim() ? { label: rule.label.trim() } : {}),
        })));
}
