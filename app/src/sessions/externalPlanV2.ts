/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted raw input, matching engine/validation.ts's own convention */
/**
 * `external-plan@2` (M3.6): the same imported-plan envelope as v1
 * (`engine/models.ts`'s `ExternalTrainingPlan`/`ExternalPlanSession`) -- scheduling,
 * hard-gate feasibility, priority, event reconciliation -- but with the session's
 * executable content carried as a normalized `SessionDefinition` instead of v1's flat,
 * lossy `ExternalPrescription`. ADR-0023's compatibility table records the intent: v2
 * writes use only the canonical v1 fixture vocabulary, so no new adapter is needed to
 * execute one (see `sessionDefinitionResolver.ts`'s `external_plan` branch).
 *
 * Deliberately a separate module from `engine/models.ts`: `sessions/models.ts` already
 * imports `IntensityGauge` from `engine/models.ts`, so putting `SessionDefinition` (or
 * anything importing it) into `engine/models.ts` would create a circular import. This
 * file depends on `engine/models.ts` (envelope types) and `./models` (`SessionDefinition`)
 * -- the same direction every other file under `sessions/` already depends on `engine/`.
 *
 * `ExternalPlanSession`/`ExternalTrainingPlan`/`EXTERNAL_PLAN_SCHEMA` in `engine/models.ts`
 * are left untouched and keep meaning v1 exactly as before -- every consumer that only
 * ever handles v1 needs no changes for this to exist alongside it.
 */

import type {
    ExternalSessionPriority,
    ExternalSessionPlacement,
    ExternalSessionGating,
    ExternalSessionScaling,
    ObjectiveKey,
} from '../engine/models';
import {
    validateExternalPlanEnvelope,
    validateExternalSessionEnvelope,
    type ValidationError,
    type ValidationResult as EngineValidationResult,
} from '../engine/validation';
import type { SessionDefinition } from './models';
import { validateSessionDefinition } from './validation';

export const EXTERNAL_PLAN_SCHEMA_V2 = 'adaptive-training-recommender/external-plan@2';

export interface ExternalPlanSessionV2 {
    id: string;
    title: string;
    priority: ExternalSessionPriority;
    placement: ExternalSessionPlacement;
    gating: ExternalSessionGating;
    objectives?: ObjectiveKey[];
    /** Replaces v1's `prescription: ExternalPrescription`. Full-fidelity executable
     * content -- ranges, laterality, option sets, companions -- in the same canonical
     * vocabulary the M0.2 fixture corpus already uses for catalog/manual sessions. */
    definition: SessionDefinition;
    scaling?: ExternalSessionScaling;
    isEvent?: boolean;
}

/** The imported artifact. Never edited in place once stored (D-IMMUT), same as v1. */
export interface ExternalTrainingPlanV2 {
    schema: typeof EXTERNAL_PLAN_SCHEMA_V2;
    planId: string;
    revision: number;
    title: string;
    startDate: string;
    weekCount: number;
    notes?: string;
    sessions: ExternalPlanSessionV2[];
}

export function isV2Plan(plan: { schema: string }): plan is ExternalTrainingPlanV2 {
    return plan.schema === EXTERNAL_PLAN_SCHEMA_V2;
}

/** A plan or session of any schema version, for the read/scheduling paths that treat
 * `gating`/`placement`/`priority`/`objectives`/`scaling`/`isEvent` identically regardless
 * of version (M3.6) -- `engine/externalPlacement.ts`, `activeExternalPlanService.ts`, the
 * session resolver, and the import UI. Re-exported (type-only, so no runtime cycle) from
 * `externalPlanAny.ts`, which is where v3 (ADR-0035) widens the union -- kept re-exported
 * here too so every existing `from '../sessions/externalPlanV2'` import site keeps working
 * unchanged. */
export type { AnyExternalTrainingPlan, AnyExternalPlanSession } from './externalPlanAny';

/** Narrows a session pulled from `plan.sessions[i]` once the plan itself is known to be
 * v2 -- there is no per-session discriminant, since a v2 *plan*'s sessions are always
 * `ExternalPlanSessionV2`. Kept as a guard (rather than just trusting the plan-level
 * narrowing) for call sites that only have the session in hand. */
export function isV2Session(session: { definition?: unknown; prescription?: unknown }): session is ExternalPlanSessionV2 {
    return 'definition' in session && !('prescription' in session);
}

/** Exported for `externalPlanV3.ts` to reuse: v3 inherits v2's `definition`-based session
 * contract unchanged (ADR-0035). */
export function validateExternalSessionV2(raw: any, index: number, weekCount: number, errors: ValidationError[]): void {
    const path = `sessions[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: path, message: 'Session must be an object' });
        return;
    }
    const allowed = ['id', 'title', 'priority', 'placement', 'gating', 'objectives', 'definition', 'scaling', 'isEvent'];
    const extra = Object.keys(raw).filter(key => !allowed.includes(key));
    if (extra.length) errors.push({ field: path, message: `Unrecognized session field(s): ${extra.join(', ')}` });
    validateExternalSessionEnvelope(raw, index, weekCount, errors);

    if (!raw.definition || typeof raw.definition !== 'object' || Array.isArray(raw.definition)) {
        errors.push({ field: `${path}.definition`, message: 'definition is required' });
        return;
    }
    const definitionResult = validateSessionDefinition(raw.definition);
    if (!definitionResult.ok) {
        for (const issue of definitionResult.issues) {
            errors.push({ field: `${path}.definition${issue.path ? `.${issue.path}` : ''}`, message: issue.message });
        }
    }
}

/** Strict boundary for an imported v2 plan revision, mirroring
 * `engine/validation.ts`'s `validateExternalTrainingPlan` (v1): rejects the whole document
 * rather than storing a partially-understood plan. */
export function validateExternalTrainingPlanV2(raw: any): EngineValidationResult<ExternalTrainingPlanV2> {
    const errors: ValidationError[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'plan', message: 'Plan must be an object' }] };
    }
    if (raw.schema !== EXTERNAL_PLAN_SCHEMA_V2) {
        errors.push({ field: 'schema', message: `Schema must be "${EXTERNAL_PLAN_SCHEMA_V2}"` });
    }
    validateExternalPlanEnvelope(raw, errors, validateExternalSessionV2);

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ExternalTrainingPlanV2 };
}
