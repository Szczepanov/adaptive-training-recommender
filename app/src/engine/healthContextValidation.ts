import type {
    HealthContextCheckin,
    HealthSymptomsCheckin,
    HealthSymptomType,
} from './healthAnomalyModels';

export const HEALTH_OTHER_DISRUPTION_MAX_LENGTH = 500;

export const HEALTH_TRAVEL_DISRUPTIONS = [
    'none',
    'local_or_no_timezone',
    'timezone_shift',
    'late_arrival_or_disrupted_sleep',
] as const;

export const HEALTH_SYMPTOM_ONSETS = ['today', 'yesterday', '2_3_days', 'earlier'] as const;
export const HEALTH_SYMPTOM_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export const HEALTH_SYMPTOM_TYPES: readonly HealthSymptomType[] = [
    'sore_throat',
    'congestion',
    'cough',
    'fever_or_chills',
    'headache_or_body_aches',
    'gastrointestinal',
    'unusual_fatigue',
    'other',
];

const HEALTH_CONTEXT_KEYS = new Set([
    'alcoholDrinksLast24h',
    'travelDisruption',
    'timezoneShiftHours',
    'unusualHeatOrSauna',
    'dehydrationOrFluidLoss',
    'recentVaccination',
    'medicationChange',
    'closeSickContact',
    // Legacy keys remain accepted at the boundary so already-written documents do not
    // become invalid. They are intentionally stripped from validated data: RHR/HRV/
    // respiration direction is calculated from Garmin history, never from check-in input.
    'manualRhrHigher',
    'manualHrvLower',
    'manualRespirationHigher',
    'otherDisruption',
    'symptoms',
]);

const HEALTH_SYMPTOM_KEYS = new Set(['present', 'onset', 'severity', 'types']);

export interface HealthContextValidationError {
    field: string;
    message: string;
    value?: unknown;
}

export type HealthContextValidationResult =
    | { isValid: true; data: HealthContextCheckin | undefined; errors: [] }
    | { isValid: false; errors: HealthContextValidationError[] };

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableBoolean(value: unknown): boolean {
    return value === undefined || value === null || typeof value === 'boolean';
}

function hasOnlyKnownKeys(raw: Record<string, unknown>, allowed: Set<string>): string[] {
    return Object.keys(raw).filter(key => !allowed.has(key));
}

function isOneOf<const TValues extends readonly string[]>(
    value: unknown,
    values: TValues,
): value is TValues[number] {
    return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function validateSymptoms(
    raw: unknown,
    errors: HealthContextValidationError[],
): HealthSymptomsCheckin | undefined {
    if (raw === undefined) return undefined;
    if (!isObject(raw)) {
        errors.push({ field: 'healthContext.symptoms', message: 'Symptoms must be an object when supplied', value: raw });
        return undefined;
    }

    const extraKeys = hasOnlyKnownKeys(raw, HEALTH_SYMPTOM_KEYS);
    if (extraKeys.length > 0) {
        errors.push({ field: 'healthContext.symptoms', message: `Unrecognized symptom field(s): ${extraKeys.join(', ')}` });
    }
    if (typeof raw.present !== 'boolean') {
        errors.push({ field: 'healthContext.symptoms.present', message: 'present is required and must be a boolean', value: raw.present });
        return undefined;
    }

    const nestedFields = ['onset', 'severity', 'types'] as const;
    if (!raw.present) {
        for (const field of nestedFields) {
            if (raw[field] !== undefined && raw[field] !== null) {
                errors.push({
                    field: `healthContext.symptoms.${field}`,
                    message: `${field} must be absent or null when symptoms are not present`,
                    value: raw[field],
                });
            }
        }
        return { present: false };
    }

    if (raw.onset !== undefined && raw.onset !== null
        && !isOneOf(raw.onset, HEALTH_SYMPTOM_ONSETS)) {
        errors.push({
            field: 'healthContext.symptoms.onset',
            message: `onset must be one of: ${HEALTH_SYMPTOM_ONSETS.join(', ')}`,
            value: raw.onset,
        });
    }
    if (raw.severity !== undefined && raw.severity !== null
        && !isOneOf(raw.severity, HEALTH_SYMPTOM_SEVERITIES)) {
        errors.push({
            field: 'healthContext.symptoms.severity',
            message: `severity must be one of: ${HEALTH_SYMPTOM_SEVERITIES.join(', ')}`,
            value: raw.severity,
        });
    }

    let types: HealthSymptomType[] | null | undefined;
    if (raw.types === null) {
        types = null;
    } else if (raw.types !== undefined) {
        if (!Array.isArray(raw.types)
            || raw.types.length > HEALTH_SYMPTOM_TYPES.length
            || raw.types.some(type => !isOneOf(type, HEALTH_SYMPTOM_TYPES))) {
            errors.push({
                field: 'healthContext.symptoms.types',
                message: `types must be a list containing only: ${HEALTH_SYMPTOM_TYPES.join(', ')}`,
                value: raw.types,
            });
        } else {
            types = [...new Set(raw.types)] as HealthSymptomType[];
        }
    }

    return {
        present: true,
        ...(raw.onset === null ? { onset: null } : isOneOf(raw.onset, HEALTH_SYMPTOM_ONSETS) ? { onset: raw.onset } : {}),
        ...(raw.severity === null ? { severity: null } : isOneOf(raw.severity, HEALTH_SYMPTOM_SEVERITIES) ? { severity: raw.severity } : {}),
        ...(types !== undefined ? { types } : {}),
    };
}

/**
 * Shared app-side contract for the optional check-in health context. Malformed supplied
 * fields fail closed. Once the block exists, ordinary contextual yes/no questions normalize
 * missing/null legacy values to explicit false because their product default is No.
 */
export function validateHealthContext(raw: unknown): HealthContextValidationResult {
    if (raw === undefined) return { isValid: true, data: undefined, errors: [] };
    const errors: HealthContextValidationError[] = [];
    if (!isObject(raw)) {
        return {
            isValid: false,
            errors: [{ field: 'healthContext', message: 'healthContext must be an object when supplied', value: raw }],
        };
    }

    const extraKeys = hasOnlyKnownKeys(raw, HEALTH_CONTEXT_KEYS);
    if (extraKeys.length > 0) {
        errors.push({ field: 'healthContext', message: `Unrecognized health context field(s): ${extraKeys.join(', ')}` });
    }

    if (raw.alcoholDrinksLast24h !== undefined
        && !(Number.isInteger(raw.alcoholDrinksLast24h)
            && typeof raw.alcoholDrinksLast24h === 'number'
            && raw.alcoholDrinksLast24h >= 0
            && raw.alcoholDrinksLast24h <= 3)) {
        errors.push({
            field: 'healthContext.alcoholDrinksLast24h',
            message: 'alcoholDrinksLast24h must be 0, 1, 2, or 3 (3 means 3+)',
            value: raw.alcoholDrinksLast24h,
        });
    }

    if (raw.travelDisruption !== undefined
        && !isOneOf(raw.travelDisruption, HEALTH_TRAVEL_DISRUPTIONS)) {
        errors.push({
            field: 'healthContext.travelDisruption',
            message: `travelDisruption must be one of: ${HEALTH_TRAVEL_DISRUPTIONS.join(', ')}`,
            value: raw.travelDisruption,
        });
    }

    if (raw.timezoneShiftHours !== undefined && raw.timezoneShiftHours !== null
        && !(typeof raw.timezoneShiftHours === 'number'
            && Number.isFinite(raw.timezoneShiftHours)
            && raw.timezoneShiftHours >= -14
            && raw.timezoneShiftHours <= 14)) {
        errors.push({
            field: 'healthContext.timezoneShiftHours',
            message: 'timezoneShiftHours must be a finite number from -14 to 14, or null',
            value: raw.timezoneShiftHours,
        });
    }

    for (const field of [
        'unusualHeatOrSauna',
        'dehydrationOrFluidLoss',
        'recentVaccination',
        'medicationChange',
        'closeSickContact',
        'manualRhrHigher',
        'manualHrvLower',
        'manualRespirationHigher',
    ] as const) {
        if (!isNullableBoolean(raw[field])) {
            errors.push({ field: `healthContext.${field}`, message: `${field} must be boolean, null, or omitted`, value: raw[field] });
        }
    }

    if (raw.otherDisruption !== undefined && raw.otherDisruption !== null
        && (typeof raw.otherDisruption !== 'string'
            || raw.otherDisruption.length > HEALTH_OTHER_DISRUPTION_MAX_LENGTH)) {
        errors.push({
            field: 'healthContext.otherDisruption',
            message: `otherDisruption must be a string of at most ${HEALTH_OTHER_DISRUPTION_MAX_LENGTH} characters, null, or omitted`,
            value: raw.otherDisruption,
        });
    }

    const symptoms = validateSymptoms(raw.symptoms, errors);
    if (errors.length > 0) return { isValid: false, errors };

    const data: HealthContextCheckin = {
        ...(typeof raw.alcoholDrinksLast24h === 'number' ? { alcoholDrinksLast24h: raw.alcoholDrinksLast24h as 0 | 1 | 2 | 3 } : {}),
        ...(isOneOf(raw.travelDisruption, HEALTH_TRAVEL_DISRUPTIONS) ? { travelDisruption: raw.travelDisruption } : {}),
        ...(raw.timezoneShiftHours === null || typeof raw.timezoneShiftHours === 'number' ? { timezoneShiftHours: raw.timezoneShiftHours as number | null } : {}),
        unusualHeatOrSauna: raw.unusualHeatOrSauna === true,
        dehydrationOrFluidLoss: raw.dehydrationOrFluidLoss === true,
        recentVaccination: raw.recentVaccination === true,
        medicationChange: raw.medicationChange === true,
        closeSickContact: raw.closeSickContact === true,
        // Do not carry legacy manual physiology into canonical validated data. If a Garmin
        // current value/baseline is missing, the objective channel remains unavailable.
        ...(raw.otherDisruption === null || typeof raw.otherDisruption === 'string' ? { otherDisruption: raw.otherDisruption } : {}),
        ...(symptoms ? { symptoms } : {}),
    };

    return { isValid: true, data, errors: [] };
}

/**
 * Compatibility/safety precedence: a supplied rich symptom state is authoritative, while an
 * omitted rich symptom state leaves the legacy flag unchanged.
 */
export function resolveLegacyIllnessSymptoms(
    legacyValue: unknown,
    healthContext: HealthContextCheckin | undefined,
): boolean {
    if (healthContext?.symptoms) return healthContext.symptoms.present;
    return typeof legacyValue === 'boolean' ? legacyValue : false;
}
