/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted raw input, matching engine/validation.ts's own convention */
/**
 * `external-plan@4` (ADR-0036, H4, D-SCHEMA): the same imported-plan envelope as v3 --
 * scheduling, hard-gate feasibility, priority, event reconciliation, the `definition`-based
 * session contract, and v3's `restDays` (ADR-0035) -- plus one new **session-level**
 * capability: an optional `intraday` placement request naming a same-date window, an
 * explicit same-date bundle, order and (for a dependent member) a required-completed
 * predecessor and minimum separation.
 *
 * Unlike v3's `restDays` (a plan-level addition reusing v2's session type unchanged), the
 * new field lives on the session itself, so this file declares a new session interface
 * (`ExternalPlanSessionV4`) and its own validator rather than reusing
 * `ExternalPlanSessionV2`/`validateExternalSessionV2` unchanged. `external-plan@1/2/3` are
 * untouched by this file's existence.
 *
 * This file implements D-SCHEMA's structural/reference validation only. It does not
 * resolve requested windows against real athlete availability, does not compute elapsed
 * separation from actual timestamps (D-TIME), and is not wired into placement, the daily
 * ledger (`engine/dailyLedger.ts`) or any recommendation decision -- see the H4 status
 * notes in `docs/plans/cycling-primary-hybrid-evaluation.md`.
 */

import type { ExternalRestDirective } from '../engine/models';
import {
    validateExternalPlanEnvelope,
    unknownKeys,
    isPositiveInt,
    EXTERNAL_PLAN_MAX_WEEKS,
    type ValidationError,
    type ValidationResult as EngineValidationResult,
} from '../engine/validation';
import { validateExternalSessionV2, type ExternalPlanSessionV2 } from './externalPlanV2';
import { stripRestDays, validateRestDays } from './externalPlanV3';
import type { SessionDefinition } from './models';

export const EXTERNAL_PLAN_SCHEMA_V4 = 'adaptive-training-recommender/external-plan@4';

/** Contract sketch named in ADR-0036 D-SCHEMA. `window` is the requested interval, never
 * imported as new availability -- the app intersects it with real athlete availability at
 * placement time (out of scope for this file). */
export interface ExternalIntradayPlacement {
    window: { startLocal: string; endLocal: string }; // HH:mm, requested interval
    /** Explicit same-date placement unit within the plan week. */
    bundleId: string;
    /** Unique nonnegative integer ordering within the bundle. */
    order: number;
    /** Earlier required-completed predecessor in this bundle. Completion is required;
     * mere ordering does not require the earlier session to have been performed. */
    afterSessionId?: string;
    /** Finite >= 0. Requires `afterSessionId`. */
    minimumSeparationMinutes?: number;
}

/** Structurally identical to `ExternalPlanSessionV2` plus the optional `intraday` field. */
export interface ExternalPlanSessionV4 {
    id: string;
    title: string;
    priority: ExternalPlanSessionV2['priority'];
    placement: ExternalPlanSessionV2['placement'];
    gating: ExternalPlanSessionV2['gating'];
    objectives?: ExternalPlanSessionV2['objectives'];
    definition: SessionDefinition;
    scaling?: ExternalPlanSessionV2['scaling'];
    isEvent?: boolean;
    intraday?: ExternalIntradayPlacement;
}

/** The imported artifact. Never edited in place once stored (D-IMMUT), same as v1/v2/v3. */
export interface ExternalTrainingPlanV4 {
    schema: typeof EXTERNAL_PLAN_SCHEMA_V4;
    planId: string;
    revision: number;
    title: string;
    startDate: string;
    weekCount: number;
    notes?: string;
    sessions: ExternalPlanSessionV4[];
    /** v4 inherits v3's rest contract unchanged (ADR-0035). */
    restDays: ExternalRestDirective[];
}

/** Type guard for the v4 schema literal. */
export function isV4Plan(plan: { schema: string }): plan is ExternalTrainingPlanV4 {
    return plan.schema === EXTERNAL_PLAN_SCHEMA_V4;
}

const INTRADAY_KEYS = ['window', 'bundleId', 'order', 'afterSessionId', 'minimumSeparationMinutes'];
const WINDOW_KEYS = ['startLocal', 'endLocal'];
const EXTERNAL_INTRADAY_BUNDLE_ID_MAX_LENGTH = 64;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesFromHHmm(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}

/** Validates one untrusted `intraday` object without assuming the surrounding session is
 * well-formed. Purely structural/self-contained checks; cross-session bundle checks
 * (shared week/day/flexibility, overlap, dangling/self/cross-bundle references, no
 * required-depends-on-optional) run afterwards in `validateIntradayBundles`, which is the
 * only place that can see every session at once. */
function validateIntradayField(raw: any, path: string, errors: ValidationError[]): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: path, message: 'intraday must be an object' });
        return;
    }
    const extra = unknownKeys(raw, INTRADAY_KEYS);
    if (extra.length) errors.push({ field: path, message: `Unrecognized intraday field(s): ${extra.join(', ')}` });

    const window = raw.window;
    if (!window || typeof window !== 'object' || Array.isArray(window)) {
        errors.push({ field: `${path}.window`, message: 'window is required' });
    } else {
        const windowExtra = unknownKeys(window, WINDOW_KEYS);
        if (windowExtra.length) errors.push({ field: `${path}.window`, message: `Unrecognized window field(s): ${windowExtra.join(', ')}` });
        const startValid = typeof window.startLocal === 'string' && HHMM_PATTERN.test(window.startLocal);
        const endValid = typeof window.endLocal === 'string' && HHMM_PATTERN.test(window.endLocal);
        if (!startValid) errors.push({ field: `${path}.window.startLocal`, message: 'startLocal must be HH:mm' });
        if (!endValid) errors.push({ field: `${path}.window.endLocal`, message: 'endLocal must be HH:mm' });
        // Zero-length and cross-midnight intervals are both rejected here: an overnight
        // opening must be split at midnight by the athlete's schedule (D-WINDOW), never
        // encoded as a wrapping interval on one session.
        if (startValid && endValid && minutesFromHHmm(window.startLocal) >= minutesFromHHmm(window.endLocal)) {
            errors.push({ field: `${path}.window`, message: 'window must be a positive-duration same-day interval (startLocal < endLocal)' });
        }
    }

    if (typeof raw.bundleId !== 'string' || !raw.bundleId) {
        errors.push({ field: `${path}.bundleId`, message: 'bundleId is required' });
    } else if (raw.bundleId.length > EXTERNAL_INTRADAY_BUNDLE_ID_MAX_LENGTH) {
        errors.push({ field: `${path}.bundleId`, message: `bundleId must be at most ${EXTERNAL_INTRADAY_BUNDLE_ID_MAX_LENGTH} characters` });
    }

    if (typeof raw.order !== 'number' || !Number.isInteger(raw.order) || raw.order < 0) {
        errors.push({ field: `${path}.order`, message: 'order must be a nonnegative integer' });
    }

    if (raw.afterSessionId !== undefined && (typeof raw.afterSessionId !== 'string' || !raw.afterSessionId)) {
        errors.push({ field: `${path}.afterSessionId`, message: 'afterSessionId must be a non-empty string when present' });
    }

    if (raw.minimumSeparationMinutes !== undefined) {
        const isFiniteNonNegative = typeof raw.minimumSeparationMinutes === 'number' && Number.isFinite(raw.minimumSeparationMinutes) && raw.minimumSeparationMinutes >= 0;
        if (!isFiniteNonNegative) {
            errors.push({ field: `${path}.minimumSeparationMinutes`, message: 'minimumSeparationMinutes must be a finite number >= 0' });
        }
        if (raw.afterSessionId === undefined) {
            errors.push({ field: `${path}.minimumSeparationMinutes`, message: 'minimumSeparationMinutes requires afterSessionId' });
        }
    }
}

/** v4 session validator: the shared envelope (placement/gating/objectives/scaling), the
 * shared `definition` content (reused unchanged from v2), then the new `intraday` field.
 * `intraday` is stripped before delegating to `validateExternalSessionV2` -- its own
 * allow-list sweep doesn't know about the new field and would otherwise reject a valid v4
 * session, the same reasoning `stripRestDays` applies at the plan level. Exported for
 * `validateExternalTrainingPlanV4` and for tests. */
export function validateExternalSessionV4(raw: any, index: number, weekCount: number, errors: ValidationError[]): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        validateExternalSessionV2(raw, index, weekCount, errors);
        return;
    }
    const { intraday, ...sessionOnly } = raw as { intraday?: unknown };
    validateExternalSessionV2(sessionOnly, index, weekCount, errors);
    if (intraday !== undefined) {
        validateIntradayField(intraday, `sessions[${index}].intraday`, errors);
    }
}

interface IntradaySessionRef {
    id: string;
    priority: unknown;
    week: unknown;
    preferredDay: unknown;
    flexibility: unknown;
    intraday: ExternalIntradayPlacement;
}

/** Cross-session bundle validation (needs the whole session list, so cannot live in the
 * per-session validator -- mirrors v3's `validateRestDays` for the same reason). */
function validateIntradayBundles(sessions: readonly any[], restDays: readonly any[], errors: ValidationError[]): void {
    const refs: IntradaySessionRef[] = sessions
        .map((session, index) => ({ session, index }))
        .filter(({ session }) => session && typeof session === 'object' && session.intraday && typeof session.intraday === 'object')
        .map(({ session }) => ({
            id: session.id,
            priority: session.priority,
            week: session.placement?.week,
            preferredDay: session.placement?.preferredDay,
            flexibility: session.placement?.flexibility,
            intraday: session.intraday as ExternalIntradayPlacement,
        }));
    if (refs.length === 0) return;

    // A rest directive and any intraday-bearing session cannot claim the same (week, day):
    // an intraday member implicitly needs its date free of authored rest (ADR-0035).
    const restKeys = new Set(
        (restDays as { week?: unknown; day?: unknown }[])
            .filter(directive => directive && typeof directive === 'object')
            .map(directive => `${directive.week}:${directive.day}`),
    );
    for (const ref of refs) {
        if (typeof ref.preferredDay === 'string' && restKeys.has(`${ref.week}:${ref.preferredDay}`)) {
            errors.push({ field: `sessions[${ref.id}].intraday`, message: `An intraday session and a rest directive both claim the same date: ${ref.week}:${ref.preferredDay}` });
        }
    }

    const byBundle = new Map<string, IntradaySessionRef[]>();
    for (const ref of refs) {
        const list = byBundle.get(ref.intraday.bundleId) ?? [];
        list.push(ref);
        byBundle.set(ref.intraday.bundleId, list);
    }

    for (const [bundleId, members] of byBundle) {
        const path = `intraday.bundle[${bundleId}]`;

        // First release requires a preferred day for an intraday bundle (D-SCHEMA).
        for (const member of members) {
            if (typeof member.preferredDay !== 'string') {
                errors.push({ field: `${path}.${member.id}`, message: 'An intraday bundle member requires placement.preferredDay' });
            }
        }

        const weeks = new Set(members.map(member => member.week));
        const days = new Set(members.map(member => member.preferredDay));
        const flex = new Set(members.map(member => member.flexibility));
        if (weeks.size > 1 || days.size > 1 || flex.size > 1) {
            errors.push({ field: path, message: 'All intraday bundle members must agree on placement.week, placement.preferredDay and placement.flexibility' });
        }

        const orders = members.map(member => member.intraday.order);
        if (new Set(orders).size !== orders.length) {
            errors.push({ field: path, message: 'Bundle members must have unique order values' });
        }

        // Overlap check on requested windows: O(n^2) over one bundle's members, which the
        // first-release "at most one occurrence per resolved window" contract keeps small.
        const sorted = [...members].sort((left, right) => minutesFromHHmm(left.intraday.window.startLocal) - minutesFromHHmm(right.intraday.window.startLocal));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1];
            const current = sorted[index];
            if (minutesFromHHmm(current.intraday.window.startLocal) < minutesFromHHmm(previous.intraday.window.endLocal)) {
                errors.push({ field: path, message: `Overlapping requested windows: ${previous.id} and ${current.id}` });
            }
        }

        const byId = new Map(members.map(member => [member.id, member]));
        for (const member of members) {
            const afterId = member.intraday.afterSessionId;
            if (afterId === undefined) continue;
            const predecessor = byId.get(afterId);
            if (!predecessor) {
                errors.push({ field: `${path}.${member.id}.afterSessionId`, message: `afterSessionId "${afterId}" must reference another session in the same bundle` });
                continue;
            }
            if (predecessor.intraday.order >= member.intraday.order) {
                errors.push({ field: `${path}.${member.id}.afterSessionId`, message: 'afterSessionId must reference an earlier order (no forward/self/cyclic references)' });
            }
            if (member.priority !== 'optional' && predecessor.priority === 'optional') {
                errors.push({ field: `${path}.${member.id}.afterSessionId`, message: 'A required session cannot depend on an optional predecessor' });
            }
        }
    }
}

/** Strict boundary for an imported v4 plan revision, mirroring `validateExternalTrainingPlanV3`. */
export function validateExternalTrainingPlanV4(raw: any): EngineValidationResult<ExternalTrainingPlanV4> {
    const errors: ValidationError[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'plan', message: 'Plan must be an object' }] };
    }
    if (raw.schema !== EXTERNAL_PLAN_SCHEMA_V4) {
        errors.push({ field: 'schema', message: `Schema must be "${EXTERNAL_PLAN_SCHEMA_V4}"` });
    }
    // Same reasoning as v3: restDays is not part of the shared envelope's own allow-list,
    // so it is stripped before the shared sweep runs on a shallow copy.
    const envelopeOnly = stripRestDays(raw);
    validateExternalPlanEnvelope(envelopeOnly, errors, validateExternalSessionV4);
    if (Array.isArray(raw.sessions)) {
        const weekCount = isPositiveInt(raw.weekCount, 1, EXTERNAL_PLAN_MAX_WEEKS) ? raw.weekCount : EXTERNAL_PLAN_MAX_WEEKS;
        validateRestDays(raw, raw.sessions, weekCount, errors);
        validateIntradayBundles(raw.sessions, Array.isArray(raw.restDays) ? raw.restDays : [], errors);
    }

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ExternalTrainingPlanV4 };
}
