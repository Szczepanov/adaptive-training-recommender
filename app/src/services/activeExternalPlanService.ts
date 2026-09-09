import { addDaysToLocalDateString } from '../utils/localDate';
import type { DataState } from '../engine/dataState';
import { resolvePlacement, resolveRestDatesByDate, type PlacedSession } from '../engine/externalPlacement';
import type {
    ExternalPlanHeader,
    ExternalPlanPlacement,
    FixedActivity,
    ScheduleWindow,
} from '../engine/models';
import type { ExternalPlanContext, ExternalRestContext } from '../engine/rules';
import { estimateAuthoredSessionSystemicCost } from '../engine/authoredSessionGates';
import type { DailyLedgerResult } from '../engine/dailyLedger';
import { proposeBundlePlacement, type BundlePlacementProposal, type IntradayBundleMember, type ResolvedWindowBinding } from '../engine/intradayBundlePlacement';
import { externalPlanService, type ExternalPlanService } from './externalPlanService';
// M3.6: an active plan may be any supported schema version -- resolvePlacement and most
// downstream session handling read envelope fields shared by every version. ADR-0035 adds
// plan-level rest directives in v3, resolved separately below rather than faked as sessions.
import type { AnyExternalTrainingPlan as ExternalTrainingPlan, AnyExternalPlanSession as ExternalPlanSession } from '../sessions/externalPlanV2';
import type { ExternalIntradayPlacement, ExternalPlanSessionV4 } from '../sessions/externalPlanV4';
import { isExternalPlanOccurrence, type SessionOccurrence } from '../sessions/models';

export interface ActiveExternalPlan {
    header: ExternalPlanHeader;
    plan: ExternalTrainingPlan;
    /** Null when the athlete has never rescheduled anything in this revision. */
    placement: ExternalPlanPlacement | null;
    /** Every session resolved to a date, overlay applied. */
    placed: readonly PlacedSession[];
}

/** Last date the plan covers, inclusive. */
export function planEndDate(header: Pick<ExternalPlanHeader, 'startDate' | 'weekCount'>): string {
    return addDaysToLocalDateString(header.startDate, header.weekCount * 7 - 1);
}

const PRIORITY_RANK = { key: 3, supporting: 2, optional: 1 } as const;

/** All sessions still to be done on a date. Completed/dropped/superseded sessions no
 * longer participate in today's decision. This is a placement/query API; it does not by
 * itself turn the singular external-session adjudicator into a multi-session executor. */
export function placedSessionsForDate(active: ActiveExternalPlan, date: string): PlacedSession[] {
    return active.placed.filter(item =>
        item.date === date && (item.status === 'planned' || item.status === 'moved'),
    );
}

/**
 * Read-only plural projection of every placed session on a date. This is useful to callers
 * that need to inspect/render the full authored day. The live recommendation engine still
 * accepts one `ExternalPlanContext`; callers must not interpret this helper as evidence
 * that secondary same-day sessions have been independently adjudicated or made executable.
 */
export function externalPlanContextsForDate(active: ActiveExternalPlan, date: string): ExternalPlanContext[] {
    return placedSessionsForDate(active, date).map(placed => ({
        planId: active.plan.planId,
        revision: active.plan.revision,
        session: placed.session,
        contentHash: active.header.contentHash,
    }));
}

function hasIntraday(session: ExternalPlanSession): session is ExternalPlanSessionV4 & { intraday: ExternalIntradayPlacement } {
    return 'intraday' in session && session.intraday !== undefined;
}

/**
 * ADR-0036 (H4) D-PLACEMENT: inputs a bundle-aware caller must already have to hand --
 * the athlete's real same-date availability windows, the fixed activities that could
 * occupy part of the date, and the day's already-resolved shared minute/systemic-cost
 * ledger. This module never estimates dose/duration/cost itself; it reuses the same
 * `estimateAuthoredSessionSystemicCost`/`SessionDefinition.duration` authorities the
 * manually-authored additional-session path already uses (ADR: "keep the current common
 * cost/eligibility authorities").
 */
export interface IntradayBundlePlacementContext {
    scheduleWindows: readonly ScheduleWindow[];
    fixedActivities: readonly FixedActivity[];
    ledger: DailyLedgerResult;
    /**
     * H4 (#434) PR 3, Phase 2 step 7: real per-member execution state, keyed by the v4
     * session's own `sessionId` (`ExternalPlanSessionV4.id`), when the caller has already
     * resolved today's occurrence/launch state for this bundle. Absent (or a member with
     * no entry) falls back to `started: false` -- the exact pre-PR-3 behavior -- so a
     * caller that has not yet wired occurrence lookups keeps working unchanged.
     */
    memberState?: ReadonlyMap<string, { started: boolean; existingBinding?: ResolvedWindowBinding }>;
}

/**
 * H4 (#434) PR 3 step 7: maps today's already-fetched external-plan occurrences onto
 * `IntradayBundlePlacementContext['memberState']`, keyed by the v4 session's own
 * `sessionId` via `externalPlanRef.sessionId`. Pure and unit-testable on its own --
 * `Home.tsx` only needs to fetch the occurrences (`sessionOccurrenceService
 * .getExternalPlanOccurrencesForDate`) and pass the result through.
 *
 * `activePlanRef` is required, not optional: `getExternalPlanOccurrencesForDate` returns
 * every external-plan occurrence for the date regardless of which plan or revision it
 * belongs to, and a v4 session's `sessionId` is plan-internal, not globally unique -- a
 * stale occurrence from a superseded revision, or an unrelated imported plan that happens
 * to reuse the same session id, could otherwise silently apply its `started`/
 * `existingBinding` to the *current* plan's member of the same id. Only an occurrence
 * whose `externalPlanRef` matches the active plan's `planId` **and** `revision` is
 * considered; every other occurrence is skipped, not merged.
 *
 * `started` is true once the occurrence's execution has actually begun --
 * `active`/`completed`/`abandoned` -- never for `scheduled` (not launched),
 * `missed` (never launched), or `superseded`/`skipped` (already excluded by
 * `getExternalPlanOccurrencesForDate`, but excluded here too for callers that pass an
 * unfiltered list). `existingBinding` is populated only for a started member that also
 * carries a persisted `windowBinding` -- until a caller passes `windowBinding` into
 * `getOrCreateExternalPlanOccurrence` when creating a bundle member's occurrence, this
 * stays absent even for a started member; `started` alone is still real and meaningful.
 */
export function buildIntradayMemberState(
    occurrences: readonly SessionOccurrence[],
    activePlanRef: { planId: string; revision: number },
): NonNullable<IntradayBundlePlacementContext['memberState']> {
    const memberState = new Map<string, { started: boolean; existingBinding?: ResolvedWindowBinding }>();
    for (const occurrence of occurrences) {
        if (!isExternalPlanOccurrence(occurrence)) continue;
        if (occurrence.externalPlanRef.planId !== activePlanRef.planId
            || occurrence.externalPlanRef.revision !== activePlanRef.revision) continue;
        const started = occurrence.state === 'active' || occurrence.state === 'completed' || occurrence.state === 'abandoned';
        const windowBinding = occurrence.windowBinding;
        const sessionId = occurrence.externalPlanRef.sessionId;
        memberState.set(sessionId, {
            started,
            ...(started && windowBinding ? {
                existingBinding: {
                    sessionId,
                    windowId: windowBinding.windowId,
                    boundStartLocal: windowBinding.boundStartLocal,
                    boundEndLocal: windowBinding.boundEndLocal,
                    startInstant: windowBinding.startInstant,
                    endInstant: windowBinding.endInstant,
                },
            } : {}),
        });
    }
    return memberState;
}

function toMembers(
    bundleSessions: readonly (PlacedSession & { session: ExternalPlanSessionV4 & { intraday: ExternalIntradayPlacement } })[],
    memberState?: IntradayBundlePlacementContext['memberState'],
): IntradayBundleMember[] {
    return bundleSessions.map(placed => {
        const { intraday, definition, priority, id } = placed.session;
        // ADR-0036 D-PLACEMENT: "once a member starts, do not move its history." Before
        // PR 3 wired real occurrence state through, every member was evaluated as
        // not-yet-started regardless of what actually happened -- a placed-but-launched
        // member's window could be silently reassigned on the next dashboard load. The
        // caller-supplied state is authoritative when present.
        const state = memberState?.get(id);
        return {
            sessionId: id,
            order: intraday.order,
            priority,
            requestedWindow: intraday.window,
            afterSessionId: intraday.afterSessionId,
            minimumSeparationMinutes: intraday.minimumSeparationMinutes,
            estimatedMinutes: definition.duration?.max ?? definition.duration?.min ?? 45,
            estimatedSystemicCost: estimateAuthoredSessionSystemicCost(definition),
            started: state?.started ?? false,
            ...(state?.existingBinding !== undefined ? { existingBinding: state.existingBinding } : {}),
        };
    });
}

/**
 * D-PLACEMENT: resolves the real window/order/rest/budget placement for one date's v4
 * intraday bundle, or `null` when no session placed on that date carries `intraday`.
 *
 * `bundleId` is only unique within a plan week (D-SCHEMA scopes it per `(week, bundleId)`,
 * not per resolved date), and an athlete's explicit per-session overlay can move any
 * single session -- including one bundle member independently of its siblings -- to an
 * arbitrary date. So two different bundle instances (different weeks, coincidentally
 * reusing the same descriptive `bundleId`, or one bundle's stray member relocated onto
 * another bundle's date) can both have intraday-bearing sessions placed on the same date.
 * This groups by `(week, bundleId)` first rather than assuming every intraday-bearing
 * session on the date belongs to one bundle. If more than one group resolves, the first
 * to place feasibly wins (groups ordered deterministically by key); if none place, the
 * first group's infeasible result is reported, so the outcome never depends on object/
 * array iteration order.
 */
export function resolveIntradayBundlePlacement(
    active: ActiveExternalPlan,
    date: string,
    context: IntradayBundlePlacementContext,
): BundlePlacementProposal | null {
    const bundleSessions = placedSessionsForDate(active, date)
        .filter((placed): placed is PlacedSession & { session: ExternalPlanSessionV4 & { intraday: ExternalIntradayPlacement } } => hasIntraday(placed.session));
    if (bundleSessions.length === 0) return null;

    const groups = new Map<string, (PlacedSession & { session: ExternalPlanSessionV4 & { intraday: ExternalIntradayPlacement } })[]>();
    for (const placed of bundleSessions) {
        const key = `${placed.session.placement.week}:${placed.session.intraday.bundleId}`;
        const group = groups.get(key) ?? [];
        group.push(placed);
        groups.set(key, group);
    }

    const restDates = new Set(resolveRestDatesByDate(active.plan).keys());
    let firstResult: BundlePlacementProposal | null = null;
    for (const key of [...groups.keys()].sort()) {
        const groupSessions = groups.get(key)!;
        const bundleId = groupSessions[0].session.intraday.bundleId;
        const result = proposeBundlePlacement(bundleId, date, toMembers(groupSessions, context.memberState), context.scheduleWindows, context.fixedActivities, restDates, context.ledger);
        firstResult ??= result;
        if (result.outcome === 'placed') return result;
    }
    return firstResult;
}

/**
 * Primary session for today's singular external adjudication path. On an intentional
 * double/triple day choose the plan author's strongest priority, then session id for a
 * deterministic tie-break rather than depending on array/input order.
 *
 * When `bundleContext` is supplied and this date's sessions include a v4 intraday bundle
 * that resolves feasibly (D-PLACEMENT), the bundle's own earliest-`order` member is the
 * authored day's primary intent -- real window/rest/budget feasibility is now proven,
 * not just priority-guessed. An infeasible or absent bundle falls back to the exact
 * priority-rank tie-break this function already used before D-PLACEMENT existed.
 */
export function placedSessionForDate(
    active: ActiveExternalPlan,
    date: string,
    bundleContext?: IntradayBundlePlacementContext,
): PlacedSession | null {
    const sessions = placedSessionsForDate(active, date);
    if (sessions.length === 0) return null;

    if (bundleContext) {
        const bundlePlacement = resolveIntradayBundlePlacement(active, date, bundleContext);
        // `bindings` is already ordered by ascending `order` (proposeBundlePlacement maps
        // over its sorted member list), so its first entry is the winning bundle's own
        // earliest-order member -- derived from the one bundle instance that actually
        // resolved, never re-derived by scanning every intraday-bearing session on the
        // date (which could span more than one bundle instance; see
        // `resolveIntradayBundlePlacement`'s doc comment).
        const primaryId = bundlePlacement?.outcome === 'placed' ? bundlePlacement.bindings?.[0]?.sessionId : undefined;
        const primary = primaryId ? sessions.find(placed => placed.session.id === primaryId) : undefined;
        if (primary) return primary;
    }

    if (sessions.length === 1) return sessions[0];
    return [...sessions].sort((left, right) =>
        PRIORITY_RANK[right.session.priority] - PRIORITY_RANK[left.session.priority]
        || left.session.id.localeCompare(right.session.id),
    )[0];
}

/**
 * Builds the primary adjudication input for one day, or null when nothing is placed. The
 * `contentHash` comes from the stored header rather than being recomputed here, so the
 * decision audit records the hash the import actually agreed to (ADR-0019 D-IMMUT).
 *
 * `bundleContext`, when supplied, activates D-PLACEMENT: the primary session is chosen
 * bundle-order-aware rather than purely by priority (see `placedSessionForDate`).
 * Launching this session still goes through the single-session path unchanged; a
 * non-primary bundle member's own launch goes through issue #434's separate
 * execution-binding pipeline (`intradayBundleMemberAdjudication.ts` /
 * `intradayLaunchClaim.ts`), not through this function.
 *
 * This function does not itself persist the resolved bundle placement for display --
 * `resolveIntradayBundlePlacement`'s result is recorded by the caller (`Home.tsx`, via
 * `intradayBundlePlacementAuditService.ts`) into a separate sibling document, because
 * `hasValidRecommendationAudit`'s `externalPlan` shape is already at Firestore's
 * per-request rule-evaluation ceiling with no room left for it (verified with the
 * emulator suite); see the comment there.
 */
export function externalPlanContextForDate(
    active: ActiveExternalPlan,
    date: string,
    bundleContext?: IntradayBundlePlacementContext,
): ExternalPlanContext | null {
    const placed = placedSessionForDate(active, date, bundleContext);
    if (!placed) return null;
    return {
        planId: active.plan.planId,
        revision: active.plan.revision,
        session: placed.session,
        contentHash: active.header.contentHash,
    };
}

/**
 * ADR-0035: builds the authored-rest adjudication input for one day. A live placed session
 * wins over the rest directive because the only supported way they can coexist is an
 * already-confirmed overlay assignment onto a protected date; import rejects fixed-session
 * / rest contradictions before storage. This keeps the production resolver's observable
 * states singular: session, rest, or unplanned -- never both session and rest.
 */
export function externalRestContextForDate(active: ActiveExternalPlan, date: string): ExternalRestContext | null {
    if (placedSessionForDate(active, date)) return null;
    const directive = resolveRestDatesByDate(active.plan).get(date);
    if (!directive) return null;
    return {
        planId: active.plan.planId,
        revision: active.plan.revision,
        directive,
        date,
        contentHash: active.header.contentHash,
    };
}

/**
 * Resolves which imported plan governs a given date.
 *
 * There is deliberately no stored "active plan" pointer. A plan already declares the dates
 * it covers, so a pointer would be a second source of truth that can disagree with them —
 * and the disagreement would surface as a session silently vanishing from the athlete's
 * day. When two plans overlap a date the most recently imported one wins, which is the
 * only ordering an athlete who just pasted a new block would expect.
 *
 * `supersededFrom` is also an effective-from boundary, not documentation: a newly imported
 * revision must never be used to recompute a date before the athlete said it takes effect.
 * Historical days already have persisted recommendations/audits, so before that boundary
 * this resolver fails closed instead of rewriting history with newer bytes.
 */
export class ActiveExternalPlanService {
    private readonly plans: ExternalPlanService;

    constructor(plans: ExternalPlanService = externalPlanService) {
        this.plans = plans;
    }

    async getActivePlanState(
        userId: string,
        date: string,
        fixedActivities: readonly FixedActivity[] = [],
    ): Promise<DataState<ActiveExternalPlan>> {
        const ids = await this.plans.listPlanIds(userId);
        if (ids.status !== 'AVAILABLE') return ids;
        if (ids.data.length === 0) return { status: 'MISSING' };

        const headerStates = await Promise.all(ids.data.map(planId => this.plans.getHeaderState(userId, planId)));
        const unavailable = headerStates.find(state => state.status === 'UNAVAILABLE');
        if (unavailable) return unavailable;

        const covering = headerStates
            .flatMap(state => (state.status === 'AVAILABLE' ? [state.data] : []))
            .filter(header => header.startDate <= date && date <= planEndDate(header))
            .filter(header => header.supersededFrom === null || date >= header.supersededFrom)
            .sort((left, right) => right.importedAt.localeCompare(left.importedAt)
                || right.planId.localeCompare(left.planId));
        if (covering.length === 0) return { status: 'MISSING' };
        const header = covering[0];

        const revision = await this.plans.getRevisionState(userId, header.planId, header.revision);
        if (revision.status !== 'AVAILABLE') return revision;

        const placementState = await this.plans.getPlacementState(userId, header.planId);
        // An INVALID or unreadable overlay is not "no overlay": ignoring malformed current
        // placement could undo reschedules the athlete already confirmed.
        if (placementState.status === 'INVALID' || placementState.status === 'UNAVAILABLE') return placementState;
        // A valid overlay belonging to an older immutable revision is different: it is
        // stale metadata, not a corrupt current overlay. Never apply it to newer plan bytes,
        // but do not brick a fresh re-import either — the new revision starts unmodified.
        const placement = placementState.status === 'AVAILABLE' && placementState.data.revision === header.revision
            ? placementState.data
            : null;

        return {
            status: 'AVAILABLE',
            data: {
                header,
                plan: revision.data,
                placement,
                placed: resolvePlacement(revision.data, placement, { fixedActivities }),
            },
            revision: `${header.contentHash}:${placement?.updatedAt ?? 'no-overlay'}`,
        };
    }
}

export const activeExternalPlanService = new ActiveExternalPlanService();
