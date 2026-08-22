import type { DailySubjectiveCheckin } from './models';
import {
    validateCheckin as validateCoreCheckin,
    type ValidationResult,
} from './validationCore';
import {
    resolveLegacyIllnessSymptoms,
    validateHealthContext,
} from './healthContextValidation';

export * from './validationCore';

function rawNestedSymptomsWereSupplied(value: unknown): boolean {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'symptoms')
        && (value as Record<string, unknown>).symptoms !== undefined;
}

/**
 * HA1 compatibility wrapper around the repository's established check-in validator.
 *
 * Keeping the historical validator unchanged behind `validationCore.ts` makes the migration
 * reviewable: legacy check-ins take the exact old path, while a supplied `healthContext`
 * receives the stricter nested validation and symptom precedence required by ADR-0025.
 */
export function validateCheckin(raw: unknown): ValidationResult<DailySubjectiveCheckin> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            isValid: false,
            errors: [{ field: 'checkin', message: 'Check-in must be an object' }],
        };
    }

    const coreResult = validateCoreCheckin(raw);
    if (!coreResult.isValid || !coreResult.data) return coreResult;

    const rawRecord = raw as Record<string, unknown>;
    const healthContextResult = validateHealthContext(rawRecord.healthContext);
    if (!healthContextResult.isValid) {
        return { isValid: false, errors: healthContextResult.errors };
    }

    const validatedHealthContext = healthContextResult.data;
    if (!validatedHealthContext) return coreResult;

    const nestedSymptomsSupplied = rawNestedSymptomsWereSupplied(rawRecord.healthContext);
    const legacyIllnessSymptoms = typeof rawRecord.illnessSymptoms === 'boolean'
        ? rawRecord.illnessSymptoms
        : false;

    // A legacy record may already have a health-context map from an earlier schema while
    // still carrying illness truth only in the top-level compatibility flag. The canonical
    // default constructor materializes symptoms:false for any supplied context block; do not
    // let that newly materialized default overwrite historical truth. If nested symptoms
    // were absent in the raw document, migrate the legacy boolean into the canonical nested
    // shape. Once raw nested symptoms exist, they remain authoritative.
    const healthContext = nestedSymptomsSupplied
        ? validatedHealthContext
        : {
            ...validatedHealthContext,
            symptoms: { present: legacyIllnessSymptoms },
        };

    const illnessSymptoms = resolveLegacyIllnessSymptoms(rawRecord.illnessSymptoms, healthContext);
    let dataQuality = coreResult.data.dataQuality;

    // A context-only write with an explicitly supplied `symptoms.present` has answered the
    // same safety question as the legacy boolean. Do not mark the check-in incomplete merely
    // because the redundant compatibility field was omitted by that caller. A defaulted
    // nested value created during migration is not treated as an explicit answer.
    if (nestedSymptomsSupplied && healthContext.symptoms && rawRecord.illnessSymptoms === undefined
        && dataQuality.missingFields.includes('illnessSymptoms')) {
        const missingFields = dataQuality.missingFields.filter(field => field !== 'illnessSymptoms');
        dataQuality = { isComplete: missingFields.length === 0, missingFields };
    }

    return {
        isValid: true,
        errors: [],
        data: {
            ...coreResult.data,
            illnessSymptoms,
            healthContext,
            dataQuality,
        },
    };
}
