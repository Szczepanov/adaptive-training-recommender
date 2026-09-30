import { validateExternalTrainingPlan } from '../engine/validation';
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
