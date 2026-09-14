/**
 * Input and persistence validation for anthropometry entries.
 *
 * Owned by ADR-0039 D-BC-PERSIST and D-BC-PROTOCOL.
 */

import type {
    AnthropometryEntry,
    AnthropometryMeasurementContext,
    AnthropometryMeasurementItem,
    AnthropometryMetricId,
    Laterality,
} from './models';
import {
    ANTHROPOMETRY_METRIC_IDS,
    ANTHROPOMETRY_PROTOCOL_V1,
    LATERALITY_OPTIONS,
    LIMB_METRIC_IDS,
} from './models';
import {
    calculateMedian,
    exceedsCircumferenceTolerance,
    roundTo1Decimal,
    roundTo2Decimals,
} from './protocol';
import { getLocalDateString } from '../utils/localDate';

export interface ValidationIssue {
    field: string;
    message: string;
}

export interface ValidationResult<T> {
    isValid: boolean;
    data?: T;
    errors: ValidationIssue[];
}

export interface MetricBound {
    min: number;
    max: number;
    unit: 'cm' | 'kg';
}

export const METRIC_BOUNDS: Record<AnthropometryMetricId, MetricBound> = {
    body_mass_kg: { min: 20.0, max: 350.0, unit: 'kg' },
    waist_minimum_cm: { min: 40.0, max: 200.0, unit: 'cm' },
    abdomen_umbilicus_cm: { min: 40.0, max: 200.0, unit: 'cm' },
    hips_max_cm: { min: 50.0, max: 220.0, unit: 'cm' },
    chest_nipple_line_cm: { min: 50.0, max: 200.0, unit: 'cm' },
    upper_arm_relaxed_mid_cm: { min: 15.0, max: 70.0, unit: 'cm' },
    forearm_max_cm: { min: 12.0, max: 55.0, unit: 'cm' },
    thigh_mid_cm: { min: 25.0, max: 110.0, unit: 'cm' },
    calf_max_cm: { min: 15.0, max: 70.0, unit: 'cm' },
};

export function isValidDateFormat(date: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(date)) return false;
    const [year, month, day] = date.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year
        && d.getUTCMonth() === month - 1
        && d.getUTCDate() === day;
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1e-9;
}

export function validateMeasurementItem(item: unknown, index: number, errors: ValidationIssue[]): AnthropometryMeasurementItem | null {
    if (!item || typeof item !== 'object') {
        errors.push({ field: `measurements[${index}]`, message: 'Measurement item must be an object' });
        return null;
    }
    const raw = item as Record<string, unknown>;

    const metricId = raw.metricId as AnthropometryMetricId;
    if (typeof metricId !== 'string' || !ANTHROPOMETRY_METRIC_IDS.includes(metricId)) {
        errors.push({ field: `measurements[${index}].metricId`, message: `Invalid or unsupported metricId '${metricId}'` });
        return null;
    }

    const bound = METRIC_BOUNDS[metricId];
    if (raw.unit !== bound.unit) {
        errors.push({ field: `measurements[${index}].unit`, message: `Unit for ${metricId} must be '${bound.unit}'` });
    }

    const isLimb = LIMB_METRIC_IDS.includes(metricId);
    let laterality: Laterality | undefined = undefined;
    if (isLimb) {
        if (raw.laterality !== undefined) {
            if (typeof raw.laterality !== 'string' || !LATERALITY_OPTIONS.includes(raw.laterality as Laterality)) {
                errors.push({ field: `measurements[${index}].laterality`, message: 'Invalid laterality for limb metric' });
            } else {
                laterality = raw.laterality as Laterality;
            }
        } else {
            laterality = 'unspecified';
        }
    } else if (raw.laterality !== undefined && raw.laterality !== null) {
        errors.push({ field: `measurements[${index}].laterality`, message: `Non-limb metric ${metricId} cannot specify laterality` });
    }

    if (!Array.isArray(raw.readings)) {
        errors.push({ field: `measurements[${index}].readings`, message: 'Readings must be an array' });
        return null;
    }

    const hasExpectedReadingCount = metricId === 'body_mass_kg'
        ? raw.readings.length === 1
        : raw.readings.length >= 2 && raw.readings.length <= 3;

    if (!hasExpectedReadingCount) {
        errors.push({
            field: `measurements[${index}].readings`,
            message: metricId === 'body_mass_kg'
                ? 'body_mass_kg requires exactly 1 reading'
                : 'Circumference requires 2 to 3 readings',
        });
    }

    let readingsAreValid = true;
    for (let rIdx = 0; rIdx < raw.readings.length; rIdx++) {
        const r = raw.readings[rIdx];
        if (typeof r !== 'number' || !Number.isFinite(r) || r < bound.min || r > bound.max) {
            readingsAreValid = false;
            errors.push({
                field: `measurements[${index}].readings[${rIdx}]`,
                message: `Reading is outside broad corruption bounds for ${metricId}`,
            });
        }
    }

    const valueIsValid = typeof raw.value === 'number'
        && Number.isFinite(raw.value)
        && raw.value >= bound.min
        && raw.value <= bound.max;
    if (!valueIsValid) {
        errors.push({
            field: `measurements[${index}].value`,
            message: `Retained value is outside broad corruption bounds for ${metricId}`,
        });
    }

    if (raw.repeatabilityWarning !== undefined && typeof raw.repeatabilityWarning !== 'boolean') {
        errors.push({ field: `measurements[${index}].repeatabilityWarning`, message: 'repeatabilityWarning must be a boolean' });
    }

    let normalizedRepeatabilityWarning: boolean | undefined;
    if (hasExpectedReadingCount && readingsAreValid && valueIsValid) {
        const numericReadings = raw.readings as number[];
        if (metricId === 'body_mass_kg') {
            const expectedValue = roundTo2Decimals(numericReadings[0]);
            if (!nearlyEqual(raw.value as number, expectedValue)) {
                errors.push({
                    field: `measurements[${index}].value`,
                    message: 'Retained body-mass value must equal the protocol-rounded reading',
                });
            }
            if (raw.repeatabilityWarning !== undefined) {
                errors.push({
                    field: `measurements[${index}].repeatabilityWarning`,
                    message: 'repeatabilityWarning is not valid for body mass',
                });
            }
        } else {
            const roundedReadings = numericReadings.map(roundTo1Decimal);
            const pairExceeded = exceedsCircumferenceTolerance(roundedReadings[0], roundedReadings[1]);
            normalizedRepeatabilityWarning = pairExceeded;

            if (pairExceeded && roundedReadings.length !== 3) {
                errors.push({
                    field: `measurements[${index}].readings`,
                    message: 'A third circumference reading is required when the first pair exceeds protocol tolerance',
                });
            }
            if (!pairExceeded && roundedReadings.length !== 2) {
                errors.push({
                    field: `measurements[${index}].readings`,
                    message: 'A third circumference reading is only retained when the first pair exceeds protocol tolerance',
                });
            }

            const expectedValue = roundTo1Decimal(calculateMedian(roundedReadings));
            if (!nearlyEqual(raw.value as number, expectedValue)) {
                errors.push({
                    field: `measurements[${index}].value`,
                    message: 'Retained circumference value must equal the protocol median of the retained readings',
                });
            }

            if (typeof raw.repeatabilityWarning === 'boolean' && raw.repeatabilityWarning !== pairExceeded) {
                errors.push({
                    field: `measurements[${index}].repeatabilityWarning`,
                    message: 'repeatabilityWarning must match the first-pair protocol tolerance result',
                });
            }
        }
    }

    if (errors.some(e => e.field.startsWith(`measurements[${index}]`))) {
        return null;
    }

    return {
        metricId,
        unit: bound.unit,
        ...(laterality ? { laterality } : {}),
        readings: raw.readings as number[],
        value: raw.value as number,
        ...(normalizedRepeatabilityWarning !== undefined
            ? { repeatabilityWarning: normalizedRepeatabilityWarning }
            : {}),
    };
}

export function validateMeasurementContext(ctx: unknown, errors: ValidationIssue[]): AnthropometryMeasurementContext | null {
    if (!ctx || typeof ctx !== 'object') {
        errors.push({ field: 'context', message: 'Context must be an object' });
        return null;
    }
    const raw = ctx as Record<string, unknown>;

    if (typeof raw.morningPostVoidPreIntake !== 'boolean') {
        errors.push({ field: 'context.morningPostVoidPreIntake', message: 'morningPostVoidPreIntake must be a boolean' });
    }
    if (typeof raw.trainingBeforeMeasurement !== 'boolean') {
        errors.push({ field: 'context.trainingBeforeMeasurement', message: 'trainingBeforeMeasurement must be a boolean' });
    }

    if (raw.respiratoryState !== undefined && raw.respiratoryState !== null) {
        if (raw.respiratoryState !== 'relaxed_normal_expiration' && raw.respiratoryState !== 'other') {
            errors.push({ field: 'context.respiratoryState', message: "respiratoryState must be 'relaxed_normal_expiration' or 'other'" });
        }
    }

    if (raw.posture !== undefined && raw.posture !== null) {
        if (raw.posture !== 'standing_relaxed' && raw.posture !== 'other') {
            errors.push({ field: 'context.posture', message: "posture must be 'standing_relaxed' or 'other'" });
        }
    }

    if (raw.clothing !== undefined && raw.clothing !== null) {
        if (raw.clothing !== 'minimal_or_bare_skin' && raw.clothing !== 'light_clothing' && raw.clothing !== 'other') {
            errors.push({ field: 'context.clothing', message: "clothing must be 'minimal_or_bare_skin', 'light_clothing' or 'other'" });
        }
    }

    if (errors.some(e => e.field.startsWith('context.'))) {
        return null;
    }

    return {
        morningPostVoidPreIntake: Boolean(raw.morningPostVoidPreIntake),
        trainingBeforeMeasurement: Boolean(raw.trainingBeforeMeasurement),
        ...(typeof raw.respiratoryState === 'string' ? { respiratoryState: raw.respiratoryState as 'relaxed_normal_expiration' | 'other' } : {}),
        ...(typeof raw.posture === 'string' ? { posture: raw.posture as 'standing_relaxed' | 'other' } : {}),
        ...(typeof raw.clothing === 'string' ? { clothing: raw.clothing as 'minimal_or_bare_skin' | 'light_clothing' | 'other' } : {}),
    };
}

export function validateAnthropometryEntry(raw: unknown): ValidationResult<AnthropometryEntry> {
    const errors: ValidationIssue[] = [];

    if (!raw || typeof raw !== 'object') {
        return { isValid: false, errors: [{ field: 'entry', message: 'Entry must be an object' }] };
    }
    const data = raw as Record<string, unknown>;

    if (typeof data.id !== 'string' || !data.id.trim() || data.id.length > 160) {
        errors.push({ field: 'id', message: 'id must be a non-empty string up to 160 characters' });
    }

    if (typeof data.userId !== 'string' || !data.userId.trim() || data.userId.length > 160) {
        errors.push({ field: 'userId', message: 'userId must be a non-empty string up to 160 characters' });
    }

    if (typeof data.date !== 'string' || !isValidDateFormat(data.date)) {
        errors.push({ field: 'date', message: 'date must be a valid YYYY-MM-DD calendar date' });
    }

    if (typeof data.observedAt !== 'string' || isNaN(Date.parse(data.observedAt))) {
        errors.push({ field: 'observedAt', message: 'observedAt must be a valid ISO 8601 timestamp' });
    } else if (typeof data.date === 'string' && isValidDateFormat(data.date)) {
        const warsawDate = getLocalDateString(new Date(data.observedAt));
        if (warsawDate !== data.date) {
            errors.push({
                field: 'observedAt',
                message: `observedAt instant resolves to Warsaw date '${warsawDate}', which contradicts logical date '${data.date}'`,
            });
        }
    }

    if (data.protocol !== ANTHROPOMETRY_PROTOCOL_V1) {
        errors.push({ field: 'protocol', message: `protocol must be '${ANTHROPOMETRY_PROTOCOL_V1}'` });
    }

    if (data.schemaVersion !== 1) {
        errors.push({ field: 'schemaVersion', message: 'schemaVersion must be 1' });
    }

    if (typeof data.revision !== 'number' || !Number.isInteger(data.revision) || data.revision < 1) {
        errors.push({ field: 'revision', message: 'revision must be an integer >= 1' });
    }

    if (typeof data.createdAt !== 'string' || isNaN(Date.parse(data.createdAt))) {
        errors.push({ field: 'createdAt', message: 'createdAt must be an ISO timestamp' });
    }

    if (typeof data.updatedAt !== 'string' || isNaN(Date.parse(data.updatedAt))) {
        errors.push({ field: 'updatedAt', message: 'updatedAt must be an ISO timestamp' });
    }

    const validatedContext = validateMeasurementContext(data.context, errors);

    if (!Array.isArray(data.measurements) || data.measurements.length === 0 || data.measurements.length > 10) {
        errors.push({ field: 'measurements', message: 'measurements must be a non-empty array with at most 10 items' });
    }

    const validatedItems: AnthropometryMeasurementItem[] = [];
    const seenSeriesKeys = new Set<string>();

    if (Array.isArray(data.measurements)) {
        data.measurements.forEach((item, idx) => {
            const validated = validateMeasurementItem(item, idx, errors);
            if (validated) {
                const seriesKey = `${validated.metricId}:${validated.laterality ?? 'unspecified'}`;
                if (seenSeriesKeys.has(seriesKey)) {
                    errors.push({ field: `measurements[${idx}]`, message: `Duplicate measurement series key '${seriesKey}' in single session` });
                } else {
                    seenSeriesKeys.add(seriesKey);
                    validatedItems.push(validated);
                }
            }
        });
    }

    if (errors.length > 0 || !validatedContext) {
        return { isValid: false, errors };
    }

    return {
        isValid: true,
        data: {
            id: data.id as string,
            userId: data.userId as string,
            date: data.date as string,
            observedAt: data.observedAt as string,
            protocol: ANTHROPOMETRY_PROTOCOL_V1,
            context: validatedContext,
            measurements: validatedItems,
            schemaVersion: 1,
            revision: data.revision as number,
            createdAt: data.createdAt as string,
            updatedAt: data.updatedAt as string,
        },
        errors: [],
    };
}
