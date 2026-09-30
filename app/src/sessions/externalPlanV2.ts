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
import type { AnyExternalPlanSession, AnyExternalTrainingPlan } from './externalPlanAny';
import type { ExternalTrainingPlanV4 } from './externalPlanV4';
import type { ExternalTrainingPlanV5 } from './externalPlanV5';
import type { ExternalTrainingPlanV6 } from './externalPlanV6';
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

/** Any external session carrying a canonical `SessionDefinition` as its executable
 * content (v2, v4, v5, v6 -- v3/v5 reuse the v2/v4 session contract unchanged, so no new
 * union member is needed for them). v1 flat prescriptions (`prescription.summary`, no
 * `definition`) are excluded. */
export type DefinitionBearingExternalSession = Extract<AnyExternalPlanSession, { definition: unknown }>;

/**
 * Version-proof capability guard for the canonical launch path (PR-B, #893 WP3.1): true
 * for any external session carrying a canonical `SessionDefinition`, regardless of plan
 * schema version -- including future v7+ sessions that keep the `definition` contract.
 * Same mechanism as `isV2Session`, named for intent so call sites (`Home.tsx` launch
 * composition, `sessionLaunch.ts` eligibility) never grow another per-version literal.
 * Carrying a definition is necessary but not sufficient for launch: advisory events,
 * `skip`/`defer` verdicts, and authored rest are excluded separately by
 * `canLaunchExternalPlanSession`, and `prepareExternalPlanSessionLaunch` revalidates the
 * exact executable form before any persistence.
 */
export function isDefinitionBearingExternalSession(
    session: { definition?: unknown; prescription?: unknown },
): session is DefinitionBearingExternalSession {
    const definition = session.definition;
    return typeof definition === 'object'
        && definition !== null
        && !Array.isArray(definition)
        && !('prescription' in session);
}

/**
 * Plan-level form of the capability guard: true when at least one of the plan's sessions
 * carries a canonical `SessionDefinition`. Fails closed on an empty or prescription-only
 * (v1) session list.
 */
export function isDefinitionBearingExternalPlan(plan: AnyExternalTrainingPlan): boolean {
    return Array.isArray(plan.sessions) && plan.sessions.some(isDefinitionBearingExternalSession);
}

const BUNDLE_CAPABLE_EXTERNAL_PLAN_SCHEMAS = new Set<string>([
    'adaptive-training-recommender/external-plan@4',
    'adaptive-training-recommender/external-plan@5',
    'adaptive-training-recommender/external-plan@6',
]);

/**
 * Bundle-placement/audit capability guard. Unlike the source-neutral launch guard above,
 * the audit snapshot is a versioned replay contract, so it must fail closed on a future
 * schema until that schema is explicitly admitted by validation/audit code. Centralizing
 * the bounded schema set here fixes v5 without scattering `isV4Plan || isV5Plan || isV6Plan`
 * branches through Home and audit persistence.
 */
export function isBundleCapableExternalPlan(
    plan: AnyExternalTrainingPlan,
): plan is ExternalTrainingPlanV4 | ExternalTrainingPlanV5 | ExternalTrainingPlanV6 {
    if (!BUNDLE_CAPABLE_EXTERNAL_PLAN_SCHEMAS.has(plan.schema)) return false;
    if (!isDefinitionBearingExternalPlan(plan)) return false;
    if (!('restDays' in plan) || !Array.isArray(plan.restDays)) return false;
    return plan.sessions.some(session =>
        typeof session === 'object'
        && session !== null
        && 'intraday' in session
        && session.intraday !== undefined);
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
