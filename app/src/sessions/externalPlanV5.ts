/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted raw input, matching engine/validation.ts's own convention */
/**
 * `external-plan@5` (ADR-0037, H5, D-SCHEMA): the same imported-plan envelope as v4 --
 * scheduling, hard-gate feasibility, priority, event reconciliation, the `definition`-based
 * session contract, v3's `restDays` (ADR-0035) and v4's `intraday` placement (ADR-0036) --
 * plus one new **plan-level** capability: an optional `intentBlocks` list authoring explicit
 * per-objective develop/maintain intent (ADR-0037 D-INTENT), reusing `engine/blockIntent.ts`'s
 * `IntentBlock` domain model and validators.
 *
 * Like v3's `restDays` (a plan-level addition reusing v2's session type unchanged), this
 * field lives on the plan, not the session, so this file reuses `ExternalPlanSessionV4`/
 * `validateExternalSessionV4` rather than declaring a new session interface. `external-plan@1
 * /2/3/4` are untouched by this file's existence.
 *
 * Authored block boundaries are **relative** `{week, day}` pairs, inclusive and within
 * `weekCount` -- the plan's `startDate` remains its sole absolute date (D-SCHEMA). Everything
 * else about a block (`objectives`, `progressionContract`) has no date fields, so those are
 * reused verbatim from `engine/blockIntent.ts` with zero duplication: this file's own job is
 * strictly the relative-date wrapper, structural/reference validation, and delegating all
 * deep semantic validation (dose envelopes, coverage keys, success criteria, progression
 * contracts) to the already-exported `validatePlanIntentBlocks`/`validateIntentBlock`.
 *
 * This file implements D-SCHEMA only: structural/reference validation and, via
 * `resolveExternalIntentBlock`, the pure relative-to-absolute date resolution needed to run
 * that validation. It is not itself Firestore-aware -- turning a validated `intentBlocks`
 * entry into a persisted `IntentBlock` is `services/externalPlanV5ActivationService.ts`'s job.
 */

import type { ExternalRestDirective, ExternalWeekday } from '../engine/models';
import { resolveRelativeLocalDate } from '../engine/externalPlacement';
import {
    validateExternalPlanEnvelope,
    unknownKeys,
    isPositiveInt,
    EXTERNAL_WEEKDAYS,
    EXTERNAL_PLAN_MAX_WEEKS,
    type ValidationError,
    type ValidationResult as EngineValidationResult,
} from '../engine/validation';
import { validateExternalSessionV4, validateIntradayBundles, type ExternalPlanSessionV4 } from './externalPlanV4';
import { stripRestDays, validateRestDays } from './externalPlanV3';
import { validatePlanIntentBlocks, type BlockObjectiveDefinition, type BlockProgressionContract, type IntentBlock } from '../engine/blockIntent';

export const EXTERNAL_PLAN_SCHEMA_V5 = 'adaptive-training-recommender/external-plan@5';

/** Authored relative boundary for a block's active interval or its next review date --
 * always `{week, day}` within `weekCount`, never an absolute date (D-SCHEMA's "one absolute
 * `startDate`; the app owns calendar arithmetic" contract, same as `ExternalRestDirective`
 * and `ExternalSessionPlacement`). */
export interface ExternalIntentBlockV5 {
    /** Plan-scoped stable id. Durable source identity for audit/replay and for deriving the
     * persisted `IntentBlock`'s own id (`services/externalPlanV5ActivationService.ts`). Since
     * it becomes part of a Firestore document id after namespacing, `/` is not permitted. */
    id: string;
    title?: string;
    notes?: string;
    startWeek: number;
    startDay: ExternalWeekday;
    endWeek: number;
    endDay: ExternalWeekday;
    /** Reused verbatim from `engine/blockIntent.ts` -- no date fields, so no relative variant
     * is needed. */
    objectives: BlockObjectiveDefinition[];
    reviewCadenceDays: number;
    nextReviewWeek: number;
    nextReviewDay: ExternalWeekday;
    /** Reused verbatim -- no date fields. */
    progressionContract?: BlockProgressionContract;
}

/** Structurally identical to `ExternalTrainingPlanV4` plus the optional plan-level
 * `intentBlocks` field. Absence retains the inherited v4 contract unchanged (D-SCHEMA). */
export interface ExternalTrainingPlanV5 {
    schema: typeof EXTERNAL_PLAN_SCHEMA_V5;
    planId: string;
    revision: number;
    title: string;
    startDate: string;
    weekCount: number;
    notes?: string;
    sessions: ExternalPlanSessionV4[];
    /** v5 inherits v3's rest contract unchanged (ADR-0035). */
    restDays: ExternalRestDirective[];
    intentBlocks?: ExternalIntentBlockV5[];
}

/** Type guard for the v5 schema literal. */
export function isV5Plan(plan: { schema: string }): plan is ExternalTrainingPlanV5 {
    return plan.schema === EXTERNAL_PLAN_SCHEMA_V5;
}

const INTENT_BLOCK_KEYS = [
    'id', 'title', 'notes', 'startWeek', 'startDay', 'endWeek', 'endDay',
    'objectives', 'reviewCadenceDays', 'nextReviewWeek', 'nextReviewDay', 'progressionContract',
];
const EXTERNAL_INTENT_BLOCK_ID_MAX_LENGTH = 64;
/** Bounded authoring surface to keep one imported revision small enough for predictable
 * validation/rules cost. The cap intentionally matches the plan's maximum week count; it is
 * a storage/complexity bound, not a claim that an intent block must span a whole week. */
const EXTERNAL_PLAN_V5_MAX_INTENT_BLOCKS = EXTERNAL_PLAN_MAX_WEEKS;
/** Generous, not authoritative -- `engine/blockIntent.ts`'s `validateIntentBlock` is the real
 * authority on review cadence; this only rejects obviously-malformed input (e.g. a negative
 * number or a string) before resolution. */
const MAX_REVIEW_CADENCE_DAYS = 3650;

/**
 * Resolves one already-structurally-valid `ExternalIntentBlockV5` entry to a candidate
 * `IntentBlock`, given the plan's own identity/`startDate`. Pure -- no Firestore, no
 * `Date.now()`. Used both at validation time (with a placeholder `revision`, since the
 * validator only checks it is a positive integer) and at persistence time
 * (`services/externalPlanV5ActivationService.ts`, with the real next revision for that
 * block id).
 */
export function resolveExternalIntentBlock(
    plan: { planId: string; revision: number; startDate: string },
    entry: ExternalIntentBlockV5,
    revision: number,
): IntentBlock {
    return {
        id: entry.id,
        revision,
        sourcePlanId: plan.planId,
        sourcePlanRevision: plan.revision,
        dateRange: {
            startDate: resolveRelativeLocalDate(plan.startDate, entry.startWeek, entry.startDay),
            endDate: resolveRelativeLocalDate(plan.startDate, entry.endWeek, entry.endDay),
        },
        objectives: entry.objectives,
        reviewSchedule: {
            reviewCadenceDays: entry.reviewCadenceDays,
            nextReviewDate: resolveRelativeLocalDate(plan.startDate, entry.nextReviewWeek, entry.nextReviewDay),
        },
        progressionContract: entry.progressionContract,
        title: entry.title,
        notes: entry.notes,
    };
}

/**
 * Structural/reference checks only -- shape, unknown keys, and that every field needed to
 * resolve a relative date is present and in range. Never throws on malformed input (mirrors
 * `externalPlanV4.ts`'s `validateIntradayField`). Deep semantic validation (dose envelopes,
 * coverage keys, success criteria, progression contracts) is deliberately NOT duplicated here
 * -- it happens once, after resolution, via `validatePlanIntentBlocks`.
 *
 * Returns whether the entry has everything needed to safely resolve a candidate `IntentBlock`
 * (id + all six relative-date fields valid). `title`/`notes` type errors do not gate
 * resolvability -- they are cosmetic fields absent from `IntentBlock`'s own replay identity.
 */
function validateExternalIntentBlockField(raw: any, index: number, weekCount: number, errors: ValidationError[]): boolean {
    const path = `intentBlocks[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push({ field: path, message: 'Intent block must be an object' });
        return false;
    }
    const extra = unknownKeys(raw, INTENT_BLOCK_KEYS);
    if (extra.length) errors.push({ field: path, message: `Unrecognized intent block field(s): ${extra.join(', ')}` });

    let resolvable = true;

    if (typeof raw.id !== 'string' || !raw.id) {
        errors.push({ field: `${path}.id`, message: 'id is required' });
        resolvable = false;
    } else if (raw.id.length > EXTERNAL_INTENT_BLOCK_ID_MAX_LENGTH) {
        errors.push({ field: `${path}.id`, message: `id must be at most ${EXTERNAL_INTENT_BLOCK_ID_MAX_LENGTH} characters` });
        resolvable = false;
    } else if (raw.id.includes('/')) {
        errors.push({ field: `${path}.id`, message: 'id must not contain "/"' });
        resolvable = false;
    }

    if (raw.title !== undefined && typeof raw.title !== 'string') {
        errors.push({ field: `${path}.title`, message: 'title must be a string when present' });
    }
    if (raw.notes !== undefined && typeof raw.notes !== 'string') {
        errors.push({ field: `${path}.notes`, message: 'notes must be a string when present' });
    }

    if (!isPositiveInt(raw.startWeek, 1, weekCount)) {
        errors.push({ field: `${path}.startWeek`, message: `startWeek must be 1-${weekCount}` });
        resolvable = false;
    }
    if (!EXTERNAL_WEEKDAYS.includes(raw.startDay)) {
        errors.push({ field: `${path}.startDay`, message: 'Unsupported weekday' });
        resolvable = false;
    }
    if (!isPositiveInt(raw.endWeek, 1, weekCount)) {
        errors.push({ field: `${path}.endWeek`, message: `endWeek must be 1-${weekCount}` });
        resolvable = false;
    }
    if (!EXTERNAL_WEEKDAYS.includes(raw.endDay)) {
        errors.push({ field: `${path}.endDay`, message: 'Unsupported weekday' });
        resolvable = false;
    }
    if (!isPositiveInt(raw.reviewCadenceDays, 1, MAX_REVIEW_CADENCE_DAYS)) {
        errors.push({ field: `${path}.reviewCadenceDays`, message: 'reviewCadenceDays must be a positive integer' });
        resolvable = false;
    }
    if (!isPositiveInt(raw.nextReviewWeek, 1, weekCount)) {
        errors.push({ field: `${path}.nextReviewWeek`, message: `nextReviewWeek must be 1-${weekCount}` });
        resolvable = false;
    }
    if (!EXTERNAL_WEEKDAYS.includes(raw.nextReviewDay)) {
        errors.push({ field: `${path}.nextReviewDay`, message: 'Unsupported weekday' });
        resolvable = false;
    }

    return resolvable;
}

/** Every session id actually authored in this plan, for dangling-reference rejection below. */
function sessionIdSet(sessions: readonly any[]): Set<string> {
    return new Set(
        sessions
            .map(session => (session && typeof session === 'object' ? session.id : undefined))
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
    );
}

/** Shape-safe step-id index used only for external progression bindings. The inherited v2/v4
 * session validator remains authoritative for definition shape; this pass merely prevents a
 * syntactically valid targetBinding from naming a nonexistent executable step. */
function sessionStepIds(sessions: readonly any[]): Map<string, ReadonlySet<string>> {
    const result = new Map<string, ReadonlySet<string>>();
    sessions.forEach(session => {
        if (!session || typeof session !== 'object' || typeof session.id !== 'string' || !session.id) return;
        const ids = new Set<string>();
        const blocks = Array.isArray(session.definition?.blocks) ? session.definition.blocks : [];
        blocks.forEach((block: any) => {
            const steps = Array.isArray(block?.steps) ? block.steps : [];
            steps.forEach((step: any) => {
                if (typeof step?.id === 'string' && step.id) ids.add(step.id);
            });
        });
        result.set(session.id, ids);
    });
    return result;
}

/**
 * D-SCHEMA: "an implementation lacking a used capability must reject the artifact explicitly,
 * never ignore its fields." A protected role or progression target naming a session must name
 * a session that actually exists in this plan -- the same dangling-reference discipline v4's
 * `afterSessionId` check applies to intraday bundles. If a progression binding narrows further
 * to a step, that step must exist inside the named session definition. Defensive against
 * garbage input: never dereferences past an optional-chained/type-guarded access.
 */
function validateIntentBlockSessionReferences(
    raw: any,
    index: number,
    sessionIds: ReadonlySet<string>,
    stepsBySession: ReadonlyMap<string, ReadonlySet<string>>,
    errors: ValidationError[],
): void {
    const path = `intentBlocks[${index}]`;
    const objectives = Array.isArray(raw?.objectives) ? raw.objectives : [];
    objectives.forEach((objective: any, objectiveIndex: number) => {
        const roles = Array.isArray(objective?.protectedRoles) ? objective.protectedRoles : [];
        roles.forEach((role: any, roleIndex: number) => {
            if (role?.kind === 'session' && typeof role.sessionId === 'string' && !sessionIds.has(role.sessionId)) {
                errors.push({
                    field: `${path}.objectives[${objectiveIndex}].protectedRoles[${roleIndex}].sessionId`,
                    message: `protectedRoles session reference "${role.sessionId}" is not a session in this plan`,
                });
            }
        });
    });
    const targetSessionId = raw?.progressionContract?.targetBinding?.sessionId;
    const targetStepId = raw?.progressionContract?.targetBinding?.stepId;
    if (typeof targetSessionId === 'string' && !sessionIds.has(targetSessionId)) {
        errors.push({
            field: `${path}.progressionContract.targetBinding.sessionId`,
            message: `progressionContract session reference "${targetSessionId}" is not a session in this plan`,
        });
    } else if (
        typeof targetSessionId === 'string'
        && typeof targetStepId === 'string'
        && targetStepId.length > 0
        && !stepsBySession.get(targetSessionId)?.has(targetStepId)
    ) {
        errors.push({
            field: `${path}.progressionContract.targetBinding.stepId`,
            message: `progressionContract step reference "${targetStepId}" is not a step in session "${targetSessionId}"`,
        });
    }
}

/**
 * Cross-entry validation for the plan-level `intentBlocks` list (needs the whole list -- and
 * the whole session list, for the dangling-reference check -- so cannot live in the per-entry
 * validator, mirroring v3's `validateRestDays`/v4's `validateIntradayBundles` for the same
 * reason). Exported for `services/externalPlanV5ActivationService.ts` and tests.
 */
export function validateExternalIntentBlocks(raw: any, sessions: readonly any[], weekCount: number, errors: ValidationError[]): void {
    if (raw.intentBlocks === undefined) return;
    if (!Array.isArray(raw.intentBlocks)) {
        errors.push({ field: 'intentBlocks', message: 'intentBlocks must be a list when present' });
        return;
    }
    if (raw.intentBlocks.length > EXTERNAL_PLAN_V5_MAX_INTENT_BLOCKS) {
        errors.push({ field: 'intentBlocks', message: `At most ${EXTERNAL_PLAN_V5_MAX_INTENT_BLOCKS} intent blocks are supported` });
        return;
    }

    const ids = raw.intentBlocks
        .map((entry: unknown) => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
        .filter((id: unknown) => typeof id === 'string');
    if (new Set(ids).size !== ids.length) {
        errors.push({ field: 'intentBlocks', message: 'Intent block ids must be unique within the plan' });
    }

    const sessionIds = sessionIdSet(sessions);
    const stepsBySession = sessionStepIds(sessions);
    const resolvedBlocks: IntentBlock[] = [];

    raw.intentBlocks.forEach((entry: unknown, index: number) => {
        const resolvable = validateExternalIntentBlockField(entry, index, weekCount, errors);
        validateIntentBlockSessionReferences(entry, index, sessionIds, stepsBySession, errors);
        if (resolvable) {
            resolvedBlocks.push(resolveExternalIntentBlock(
                { planId: raw.planId, revision: raw.revision, startDate: raw.startDate },
                entry as ExternalIntentBlockV5,
                1, // placeholder: validation only checks this is a positive integer
            ));
        }
    });

    // `validatePlanIntentBlocks` already runs `validateIntentBlock` per block internally, then
    // checks cross-block overlap within the same `sourcePlanId` -- one call covers both, since
    // every resolved candidate here shares `sourcePlanId = raw.planId`. Its public API is a
    // trusted-domain validator, not an arbitrary-JSON parser, so keep the external boundary
    // exception-safe in case a malformed nested object gets past the lightweight wrapper.
    if (resolvedBlocks.length > 0) {
        try {
            const { issues } = validatePlanIntentBlocks(resolvedBlocks);
            issues.forEach(issue => errors.push({ field: `intentBlocks:${issue.path}`, message: issue.message }));
        } catch {
            errors.push({ field: 'intentBlocks', message: 'intentBlocks contains malformed nested objective or progression data' });
        }
    }
}

/** Strict boundary for an imported v5 plan revision, mirroring `validateExternalTrainingPlanV4`. */
export function validateExternalTrainingPlanV5(raw: any): EngineValidationResult<ExternalTrainingPlanV5> {
    const errors: ValidationError[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'plan', message: 'Plan must be an object' }] };
    }
    if (raw.schema !== EXTERNAL_PLAN_SCHEMA_V5) {
        errors.push({ field: 'schema', message: `Schema must be "${EXTERNAL_PLAN_SCHEMA_V5}"` });
    }
    // Neither restDays nor intentBlocks is part of the shared envelope's own allow-list, so
    // both are stripped before the shared sweep runs on a shallow copy -- same reasoning v3/v4
    // already apply to restDays.
    const envelopeOnly = stripIntentBlocks(stripRestDays(raw));
    validateExternalPlanEnvelope(envelopeOnly, errors, validateExternalSessionV4);
    if (Array.isArray(raw.sessions)) {
        const weekCount = isPositiveInt(raw.weekCount, 1, EXTERNAL_PLAN_MAX_WEEKS) ? raw.weekCount : EXTERNAL_PLAN_MAX_WEEKS;
        validateRestDays(raw, raw.sessions, weekCount, errors);
        validateIntradayBundles(raw.sessions, Array.isArray(raw.restDays) ? raw.restDays : [], errors);
        validateExternalIntentBlocks(raw, raw.sessions, weekCount, errors);
    }

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ExternalTrainingPlanV5 };
}

/** Strips the `intentBlocks` key before the shared envelope sweep runs, same reasoning as
 * `stripRestDays` (`sessions/externalPlanV3.ts`). */
function stripIntentBlocks(raw: Record<string, unknown>): Record<string, unknown> {
    const { intentBlocks: _intentBlocks, ...rest } = raw as { intentBlocks?: unknown };
    void _intentBlocks;
    return rest;
}
