/**
 * #1172: the placement change a revision import writes on the previous revision for each
 * session the new revision explicitly declares it replaces (`replacesSessionId`).
 *
 * Pure. Only declared sessions change: each becomes `superseded` on the date the plan view
 * showed it (its moved date, else where `resolvePlacement` placed it). Every other assignment
 * is kept as it was. Nothing is inferred for undeclared sessions. Preflight and import share
 * the helpers below, so both check and write the same dates.
 */
import type { ExternalPlanPlacement, ExternalTrainingPlan, FixedActivity } from '../engine/models';
import { impliedDate, resolvePlacement } from '../engine/externalPlacement';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import type { SessionReplacement } from '../sessions/externalPlanReplacements';
import type { SessionOccurrence } from '../sessions/models';
import type { PlacementEvent } from '../ledger/placementHistory';

export type SupersessionIssueCode = 'replaced-session-completed' | 'replaced-session-before-effective-date';

export type SupersessionChange =
    | { ok: true; assignments: ExternalPlanPlacement['assignments']; successors: PlacementEvent['successors'] }
    | { ok: false; code: SupersessionIssueCode; field: string };

/** What the replacement checks read besides the two revisions and the previous overlay. */
export interface ReplacementContext {
    /** Fixed activities: the occupancy the plan view resolves placement with. */
    fixedActivities: readonly FixedActivity[];
    occurrences: readonly SessionOccurrence[];
}

/**
 * Occurrence states that mean the athlete started the session. `abandoned` counts: it is a
 * terminal record of an attempt (an abandoned execution can carry logged sets), and the
 * daily ledger treats it as terminal history too. Superseding it would relabel that attempt
 * as replaced. `scheduled`, `missed`, `skipped` and `superseded` record no performed work.
 */
const PERFORMED_STATES: ReadonlySet<SessionOccurrence['state']> = new Set(['active', 'completed', 'abandoned']);

const planEnd = (plan: { startDate: string; weekCount: number }): string =>
    addDaysToLocalDateString(plan.startDate, plan.weekCount * 7 - 1);

/** The calendar range a replacement check reads: both revisions' horizons. */
export function replacementReadRange(plan: AnyExternalTrainingPlan, previousPlan: AnyExternalTrainingPlan): { start: string; end: string } {
    const [nextEnd, previousEnd] = [planEnd(plan), planEnd(previousPlan)];
    return {
        start: previousPlan.startDate < plan.startDate ? previousPlan.startDate : plan.startDate,
        end: previousEnd > nextEnd ? previousEnd : nextEnd,
    };
}

/** Previous-revision sessions with performed work: an occurrence of that exact revision, or a `completed` assignment. */
export function performedSessionIds(previousPlan: AnyExternalTrainingPlan, overlay: ExternalPlanPlacement | null,
    occurrences: readonly SessionOccurrence[]): Set<string> {
    const fromOccurrences = occurrences.flatMap(item => item.authority === 'external_plan' && PERFORMED_STATES.has(item.state)
        && item.externalPlanRef.planId === previousPlan.planId && item.externalPlanRef.revision === previousPlan.revision
        ? [item.externalPlanRef.sessionId] : []);
    const fromOverlay = (overlay?.assignments ?? []).flatMap(item => item.status === 'completed' ? [item.sessionId] : []);
    return new Set([...fromOccurrences, ...fromOverlay]);
}

/**
 * Where the previous revision shows each session: `resolvePlacement` with the overlay and fixed
 * activities, as the plan view resolves it. A session the resolver leaves unplaced (a full week)
 * falls back to its authored date.
 */
export function previousSessionDates(previousPlan: AnyExternalTrainingPlan, overlay: ExternalPlanPlacement | null,
    fixedActivities: readonly FixedActivity[]): Map<string, string> {
    const plan = previousPlan as ExternalTrainingPlan;
    const placed = new Map(resolvePlacement(plan, overlay, { fixedActivities }).map(item => [item.session.id, item.date]));
    return new Map(plan.sessions.map(session => [session.id, placed.get(session.id) ?? impliedDate(plan, session)]));
}

export function supersedeDeclaredSessions(
    previousPlan: AnyExternalTrainingPlan,
    previousOverlay: ExternalPlanPlacement | null,
    declarations: readonly SessionReplacement[],
    newRevision: number,
    effectiveFrom: string,
    context: ReplacementContext,
): SupersessionChange {
    // Performed work is history; superseding it would overwrite that record.
    const performed = performedSessionIds(previousPlan, previousOverlay, context.occurrences);
    const completed = declarations.find(item => performed.has(item.replacesSessionId));
    if (completed) return { ok: false, code: 'replaced-session-completed', field: `sessions[${completed.index}].replacesSessionId` };

    const dates = previousSessionDates(previousPlan, previousOverlay, context.fixedActivities);
    const beforeBoundary = declarations.find(item => {
        const date = dates.get(item.replacesSessionId);
        return date !== undefined && date < effectiveFrom;
    });
    if (beforeBoundary) return { ok: false, code: 'replaced-session-before-effective-date', field: `sessions[${beforeBoundary.index}].replacesSessionId` };

    const previousAssignments = previousOverlay?.assignments ?? [];
    const assigned = new Set(previousAssignments.map(item => item.sessionId));
    const replaced = new Set(declarations.map(item => item.replacesSessionId));
    const kept = previousAssignments.map(item => replaced.has(item.sessionId) ? { ...item, status: 'superseded' as const } : item);
    const added = declarations.filter(item => !assigned.has(item.replacesSessionId)).flatMap(item => {
        const date = dates.get(item.replacesSessionId);
        return date ? [{ sessionId: item.replacesSessionId, date, status: 'superseded' as const }] : [];
    });
    const successors = Object.fromEntries(declarations.map(item => [item.replacesSessionId,
        { revision: newRevision, sessionId: item.sessionId }]));
    return { ok: true, assignments: [...kept, ...added], successors };
}
