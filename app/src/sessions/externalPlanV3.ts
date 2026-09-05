/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted raw input, matching engine/validation.ts's own convention */
/**
 * `external-plan@3` (ADR-0035): the same imported-plan envelope as v2 -- scheduling,
 * hard-gate feasibility, priority, event reconciliation, and the `definition`-based
 * session contract -- plus one new plan-level capability: `restDays`, a list of relative
 * directives that close a date to discretionary planning.
 *
 * v3 sessions are structurally identical to v2 sessions (ADR-0035 explicitly rejects
 * folding rest into `ExternalPlanSession` -- see Option C in the ADR), so this file
 * reuses `ExternalPlanSessionV2`/`validateExternalSessionV2` rather than declaring a new
 * session type. `external-plan@1`/`@2` are untouched by this file's existence.
 */

import type { ExternalRestDirective } from '../engine/models';
import {
    validateExternalPlanEnvelope,
    unknownKeys,
    isPositiveInt,
    EXTERNAL_WEEKDAYS,
    EXTERNAL_PLAN_MAX_WEEKS,
    type ValidationError,
    type ValidationResult as EngineValidationResult,
} from '../engine/validation';
import { validateExternalSessionV2, type ExternalPlanSessionV2 } from './externalPlanV2';

export const EXTERNAL_PLAN_SCHEMA_V3 = 'adaptive-training-recommender/external-plan@3';

/** The imported artifact. Never edited in place once stored (D-IMMUT), same as v1/v2. */
export interface ExternalTrainingPlanV3 {
    schema: typeof EXTERNAL_PLAN_SCHEMA_V3;
    planId: string;
    revision: number;
    title: string;
    startDate: string;
    weekCount: number;
    notes?: string;
    sessions: ExternalPlanSessionV2[];
    /** ADR-0035. At least one session is still required (`validateExternalPlanEnvelope`);
     * rest directives supplement a plan, they do not replace it. */
    restDays: ExternalRestDirective[];
}

/** Type guard for the v3 schema literal. */
export function isV3Plan(plan: { schema: string }): plan is ExternalTrainingPlanV3 {
    return plan.schema === EXTERNAL_PLAN_SCHEMA_V3;
}

const REST_DAY_KEYS = ['id', 'week', 'day'];
const EXTERNAL_PLAN_V3_MAX_REST_DAYS = EXTERNAL_PLAN_MAX_WEEKS;
const EXTERNAL_REST_DIRECTIVE_ID_MAX_LENGTH = 64;

/** Validates one untrusted v3 rest directive without assuming it is object-shaped. */
function validateRestDirective(raw: any, index: number, weekCount: number, errors: ValidationError[]): void {
    const path = `restDays[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: path, message: 'Rest directive must be an object' });
        return;
    }
    const extra = unknownKeys(raw, REST_DAY_KEYS);
    if (extra.length) errors.push({ field: path, message: `Unrecognized rest directive field(s): ${extra.join(', ')}` });
    if (typeof raw.id !== 'string' || !raw.id) {
        errors.push({ field: `${path}.id`, message: 'Rest directive id is required' });
    } else if (raw.id.length > EXTERNAL_REST_DIRECTIVE_ID_MAX_LENGTH) {
        errors.push({ field: `${path}.id`, message: `Rest directive id must be at most ${EXTERNAL_REST_DIRECTIVE_ID_MAX_LENGTH} characters` });
    }
    if (!isPositiveInt(raw.week, 1, weekCount)) errors.push({ field: `${path}.week`, message: `week must be 1-${weekCount}` });
    if (!EXTERNAL_WEEKDAYS.includes(raw.day)) errors.push({ field: `${path}.day`, message: 'Unsupported weekday' });
}

/**
 * Validates the plan-level `restDays` list: shape, id uniqueness, and no two directives
 * (or a directive and a fixed session) claiming the same relative `(week, day)`. Session
 * conflicts are checked here rather than in the shared session validator because only the
 * plan level can see both lists at once.
 */
function validateRestDays(raw: any, sessions: readonly any[], weekCount: number, errors: ValidationError[]): void {
    if (raw.restDays === undefined) {
        errors.push({ field: 'restDays', message: 'restDays is required (may be an empty list) in external-plan@3' });
        return;
    }
    if (!Array.isArray(raw.restDays)) {
        errors.push({ field: 'restDays', message: 'restDays must be a list' });
        return;
    }
    if (raw.restDays.length > EXTERNAL_PLAN_V3_MAX_REST_DAYS) {
        errors.push({ field: 'restDays', message: `At most ${EXTERNAL_PLAN_V3_MAX_REST_DAYS} rest directives are supported` });
        return;
    }

    raw.restDays.forEach((directive: unknown, index: number) => validateRestDirective(directive, index, weekCount, errors));

    const ids = raw.restDays.map((directive: any) => directive?.id).filter((id: unknown) => typeof id === 'string');
    if (new Set(ids).size !== ids.length) errors.push({ field: 'restDays', message: 'Rest directive ids must be unique within the plan' });

    const restKeys = new Set<string>();
    for (const directive of raw.restDays as unknown[]) {
        // `validateRestDirective` reports malformed elements, but validation must continue
        // without dereferencing them so import returns its normal INVALID state instead of
        // throwing on payloads such as `restDays: [null]`.
        if (!directive || typeof directive !== 'object' || Array.isArray(directive)) continue;
        const { week, day } = directive as { week?: unknown; day?: unknown };
        if (isPositiveInt(week, 1, weekCount) && typeof day === 'string') {
            restKeys.add(`${week}:${day}`);
        }
    }
    if (restKeys.size < raw.restDays.length) {
        errors.push({ field: 'restDays', message: 'Rest directives must not repeat the same (week, day)' });
    }

    // A fixed session and a rest directive cannot own the same relative date: precedence
    // between "the plan says do this" and "the plan says do nothing" must fail import
    // rather than being decided by runtime resolver ordering (ADR-0035).
    const fixedSessionKeys = new Set(
        (sessions as { placement?: { week?: unknown; preferredDay?: unknown; flexibility?: unknown } }[])
            .filter(session => session.placement?.flexibility === 'fixed' && typeof session.placement.preferredDay === 'string')
            .map(session => `${session.placement!.week}:${session.placement!.preferredDay}`),
    );
    const conflicts = [...restKeys].filter(key => fixedSessionKeys.has(key));
    if (conflicts.length > 0) {
        errors.push({ field: 'restDays', message: `A fixed session and a rest directive both claim the same date(s): ${conflicts.join(', ')}` });
    }
}

/** Strict boundary for an imported v3 plan revision, mirroring `validateExternalTrainingPlan`
 * (v1) and `validateExternalTrainingPlanV2`. */
export function validateExternalTrainingPlanV3(raw: any): EngineValidationResult<ExternalTrainingPlanV3> {
    const errors: ValidationError[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'plan', message: 'Plan must be an object' }] };
    }
    if (raw.schema !== EXTERNAL_PLAN_SCHEMA_V3) {
        errors.push({ field: 'schema', message: `Schema must be "${EXTERNAL_PLAN_SCHEMA_V3}"` });
    }
    // v3's own plan-level allow-list adds 'restDays' on top of the shared envelope's keys;
    // validateExternalPlanEnvelope's own unknownKeys sweep (shared with v1/v2) does not
    // know about restDays, so it would reject a valid v3 document. Widen only for v3 by
    // pre-checking restDays here and stripping it before the shared sweep runs on a shallow
    // copy -- the shared function itself is untouched, so v1/v2 continue rejecting the field.
    const { restDays: _restDays, ...envelopeOnly } = raw as { restDays?: unknown };
    void _restDays;
    validateExternalPlanEnvelope(envelopeOnly, errors, validateExternalSessionV2);
    if (Array.isArray(raw.sessions)) {
        const weekCount = isPositiveInt(raw.weekCount, 1, EXTERNAL_PLAN_MAX_WEEKS) ? raw.weekCount : EXTERNAL_PLAN_MAX_WEEKS;
        validateRestDays(raw, raw.sessions, weekCount, errors);
    }

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ExternalTrainingPlanV3 };
}
