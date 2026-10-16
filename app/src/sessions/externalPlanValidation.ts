import { EXTERNAL_PLAN_SESSION_ID_MAX_CHARS, validateExternalTrainingPlan, type ValidationError } from '../engine/validation';
import { validateExternalTrainingPlanV2, EXTERNAL_PLAN_SCHEMA_V2 } from './externalPlanV2';
import { validateExternalTrainingPlanV3, EXTERNAL_PLAN_SCHEMA_V3 } from './externalPlanV3';
import { validateExternalTrainingPlanV4, EXTERNAL_PLAN_SCHEMA_V4 } from './externalPlanV4';
import { validateExternalTrainingPlanV5, EXTERNAL_PLAN_SCHEMA_V5 } from './externalPlanV5';
import { validateExternalTrainingPlanV6, EXTERNAL_PLAN_SCHEMA_V6 } from './externalPlanV6';

/** The shared pure boundary for every persisted/imported external-plan revision. */
export function validateAnyExternalTrainingPlan(raw: unknown) {
    const schema = (raw as { schema?: unknown } | null)?.schema;
    if (schema === EXTERNAL_PLAN_SCHEMA_V6) return validateExternalTrainingPlanV6(raw);
    if (schema === EXTERNAL_PLAN_SCHEMA_V5) return validateExternalTrainingPlanV5(raw);
    if (schema === EXTERNAL_PLAN_SCHEMA_V4) return validateExternalTrainingPlanV4(raw);
    if (schema === EXTERNAL_PLAN_SCHEMA_V3) return validateExternalTrainingPlanV3(raw);
    if (schema === EXTERNAL_PLAN_SCHEMA_V2) return validateExternalTrainingPlanV2(raw);
    return validateExternalTrainingPlan(raw);
}

function oversizedSessionIdErrors(raw: unknown): ValidationError[] {
    const sessions = (raw as { sessions?: unknown } | null)?.sessions;
    if (!Array.isArray(sessions)) return [];
    return sessions.flatMap((session: unknown, index: number) => {
        const id = (session as { id?: unknown } | null)?.id;
        return typeof id === 'string' && id.length > EXTERNAL_PLAN_SESSION_ID_MAX_CHARS
            ? [{ field: `sessions[${index}].id`, message: `Session id must be at most ${EXTERNAL_PLAN_SESSION_ID_MAX_CHARS} characters` }]
            : [];
    });
}

/** #945: the stricter boundary for a *new* import. Adds the persisted session-identity bound
 * to the shared contract, so an imported session can always be written to the recommendation
 * audit and the session-occurrence rules. Reads of already-stored revisions keep using
 * `validateAnyExternalTrainingPlan`: Firestore rules cannot bound ids inside a stored plan, so
 * an earlier revision with a longer id must stay readable rather than vanish. */
export function validateExternalPlanImport(raw: unknown): ReturnType<typeof validateAnyExternalTrainingPlan> {
    const result = validateAnyExternalTrainingPlan(raw);
    const idErrors = oversizedSessionIdErrors(raw);
    if (idErrors.length === 0) return result;
    return { isValid: false, errors: [...result.errors, ...idErrors] };
}
