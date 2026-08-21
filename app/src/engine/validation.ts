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

/**
 * HA1 compatibility wrapper around the repository's established check-in validator.
 *
 * Keeping the historical validator unchanged behind `validationCore.ts` makes the migration
 * reviewable: legacy check-ins take the exact old path, while a supplied `healthContext`
 * receives the stricter nested validation and symptom precedence required by ADR-0025.
 */
export function validateCheckin(raw: unknown): ValidationResult<DailySubjectiveCheckin> {
    const coreResult = validateCoreCheckin(raw);
    if (!coreResult.isValid || !coreResult.data) return coreResult;

    const rawRecord = (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? raw as Record<string, unknown>
        : {};
    const healthContextResult = validateHealthContext(rawRecord.healthContext);
    if (!healthContextResult.isValid) {
        return { isValid: false, errors: healthContextResult.errors };
    }

    const healthContext = healthContextResult.data;
    if (!healthContext) return coreResult;

    const illnessSymptoms = resolveLegacyIllnessSymptoms(rawRecord.illnessSymptoms, healthContext);
    let dataQuality = coreResult.data.dataQuality;

    // A context-only write with `symptoms.present` has answered the same safety question as
    // the legacy boolean. Do not mark the check-in incomplete merely because the redundant
    // compatibility field was omitted by that caller.
    if (healthContext.symptoms && rawRecord.illnessSymptoms === undefined
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
