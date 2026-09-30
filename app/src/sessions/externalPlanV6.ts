/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted JSON boundary */
/** v6 adds an exact executable reduced definition to the existing v5 contract. */
import type { ExternalSessionScaling } from '../engine/models';
import type { ValidationError, ValidationResult as EngineValidationResult } from '../engine/validation';
import { validateExternalTrainingPlanV5, EXTERNAL_PLAN_SCHEMA_V5 } from './externalPlanV5';
import type { ExternalPlanSessionV4 } from './externalPlanV4';
import type { SessionDefinition } from './models';
import { validateSessionDefinition } from './validation';

export const EXTERNAL_PLAN_SCHEMA_V6 = 'adaptive-training-recommender/external-plan@6';

export interface ExternalPlanSessionV6 extends Omit<ExternalPlanSessionV4, 'scaling'> {
    scaling?: ExternalSessionScaling & { reducedDefinition?: SessionDefinition };
}

export interface ExternalTrainingPlanV6 extends Omit<import('./externalPlanV5').ExternalTrainingPlanV5, 'schema' | 'sessions'> {
    schema: typeof EXTERNAL_PLAN_SCHEMA_V6;
    sessions: ExternalPlanSessionV6[];
}

export function isV6Plan(plan: { schema: string }): plan is ExternalTrainingPlanV6 {
    return plan.schema === EXTERNAL_PLAN_SCHEMA_V6;
}

function stripReducedDefinitions(raw: any): any {
    if (!Array.isArray(raw?.sessions)) return { ...raw, schema: EXTERNAL_PLAN_SCHEMA_V5 };
    return {
        ...raw,
        schema: EXTERNAL_PLAN_SCHEMA_V5,
        sessions: raw.sessions.map((session: any) => {
            if (!session || typeof session !== 'object' || !session.scaling || typeof session.scaling !== 'object' || Array.isArray(session.scaling)) return session;
            const scaling = { ...session.scaling };
            delete scaling.reducedDefinition;
            return { ...session, scaling };
        }),
    };
}

export function validateExternalTrainingPlanV6(raw: any): EngineValidationResult<ExternalTrainingPlanV6> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'plan', message: 'Plan must be an object' }] };
    }
    const errors: ValidationError[] = [];
    if (raw.schema !== EXTERNAL_PLAN_SCHEMA_V6) {
        errors.push({ field: 'schema', message: `Schema must be "${EXTERNAL_PLAN_SCHEMA_V6}"` });
    }
    const inherited = validateExternalTrainingPlanV5(stripReducedDefinitions(raw));
    errors.push(...inherited.errors);

    if (Array.isArray(raw.sessions)) {
        raw.sessions.forEach((session: any, index: number) => {
            const reducedDefinition = session?.scaling?.reducedDefinition;
            if (reducedDefinition === undefined) return;
            const path = `sessions[${index}].scaling.reducedDefinition`;
            if (session.scaling.reducible !== true) {
                errors.push({ field: `${path}`, message: 'reducedDefinition requires reducible: true' });
            }
            const result = validateSessionDefinition(reducedDefinition);
            if (!result.ok) {
                result.issues.forEach(issue => errors.push({
                    field: `${path}${issue.path ? `.${issue.path}` : ''}`,
                    message: issue.message,
                }));
            }
            if (result.ok && session.definition && typeof session.definition === 'object') {
                if (reducedDefinition.id !== session.definition.id) {
                    errors.push({ field: `${path}.id`, message: 'Reduced definition must retain the authored session definition id' });
                }
                if (reducedDefinition.intent !== session.definition.intent) {
                    errors.push({ field: `${path}.intent`, message: 'Reduced definition must retain the authored session intent' });
                }
                if (reducedDefinition.dominantModality !== session.definition.dominantModality) {
                    errors.push({ field: `${path}.dominantModality`, message: 'Reduced definition must retain the authored dominant modality' });
                }
            }
        });
    }

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ExternalTrainingPlanV6 };
}
