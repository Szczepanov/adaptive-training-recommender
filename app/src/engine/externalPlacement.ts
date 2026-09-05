import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import type {
    ExternalPlacementAssignment,
    ExternalPlanPlacement,
    ExternalRestDirective,
    ExternalWeekday,
    FixedActivity,
} from './models';
// M3.6: these functions only ever read placement/id fields, identical on v1 and v2
// sessions -- widened to accept either rather than kept v1-only.
import type { AnyExternalTrainingPlan as ExternalTrainingPlan, AnyExternalPlanSession as ExternalPlanSession } from '../sessions/externalPlanV2';

const WEEKDAY_OFFSET: Record<ExternalWeekday, number> = {
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};

export interface PlacedSession {
    session: ExternalPlanSession;
    date: string;
    status: ExternalPlacementAssignment['status'];
    /** True when the overlay moved this session off the date the plan implies. */
    moved: boolean;
}

/** A session still holds its date unless it was dropped or superseded. `moved` is what
 * `applyConfirmedProposal` writes for a reschedule, so treating only `planned` as
 * occupying would let the next flexible session stack on top of a session just moved. */
export function occupiesDate(status: ExternalPlacementAssignment['status']): boolean {
    return status !== 'dropped' && status !== 'superseded';
}

/** Dates already spoken for, so a re-placement does not stack two sessions on one day. */
export interface PlacementOccupancy {
    fixedActivities?: readonly FixedActivity[];
}

function weekStart(plan: ExternalTrainingPlan, week: number): string {
    return addDaysToLocalDateString(plan.startDate, (week - 1) * 7);
}

/**
 * ADR-0035: resolves one v3 rest directive to its plan-local absolute date, the same
 * relative-to-absolute arithmetic `impliedDate` uses for a session. Only `external-plan@3`
 * carries `restDays`; v1/v2 plans have no directives to resolve.
 */
export function resolveRestDate(plan: ExternalTrainingPlan, directive: ExternalRestDirective): string {
    return addDaysToLocalDateString(weekStart(plan, directive.week), WEEKDAY_OFFSET[directive.day]);
}

/** All of a v3 plan's rest directives resolved to dates, keyed by date. Empty for v1/v2
 * (no `restDays` field at all) and for a v3 plan with no directives. */
export function resolveRestDatesByDate(plan: ExternalTrainingPlan): Map<string, ExternalRestDirective> {
    const restDays = (plan as { restDays?: readonly ExternalRestDirective[] }).restDays ?? [];
    return new Map(restDays.map(directive => [resolveRestDate(plan, directive), directive]));
}

/** The date the plan itself implies, before any overlay. A session with no `preferredDay`
 * lands on its week's Monday; `resolvePlacement` then spreads it if that day is taken. */
export function impliedDate(plan: ExternalTrainingPlan, session: ExternalPlanSession): string {
    const offset = session.placement.preferredDay ? WEEKDAY_OFFSET[session.placement.preferredDay] : 0;
    return addDaysToLocalDateString(weekStart(plan, session.placement.week), offset);
}

function weekDates(plan: ExternalTrainingPlan, week: number): string[] {
    const start = weekStart(plan, week);
    return Array.from({ length: 7 }, (_, offset) => addDaysToLocalDateString(start, offset));
}

/** Only movable `preferred` sessions authored for the same week + weekday form one
 * intentional placement unit. `fixed` remains hard occupancy, preserving its pre-existing
 * precedence over movable work on the same date. */
function preferredBundleKey(session: ExternalPlanSession): string | null {
    const day = session.placement.preferredDay;
    return session.placement.flexibility === 'preferred' && day
        ? `${session.placement.week}:${day}`
        : null;
}

/**
 * Resolves every session to a date. The stored overlay wins. Movable sessions authored for
 * the same week + `preferredDay` are kept together as one intentional double/triple-day
 * bundle and, when their preferred date is occupied, move together within the week.
 * `fixed` sessions are placed first and never yield; `any_day` sessions then spread
 * individually across the remaining open dates.
 */
export function resolvePlacement(
    plan: ExternalTrainingPlan,
    overlay: ExternalPlanPlacement | null,
    occupancy: PlacementOccupancy = {},
): PlacedSession[] {
    const assigned = new Map((overlay?.assignments ?? []).map(item => [item.sessionId, item]));
    const fixedActivityDates = new Set(
        (occupancy.fixedActivities ?? []).filter(activity => !activity.isCompleted).map(activity => activity.date),
    );
    // ADR-0035: an authored rest date is closed to `any_day` placement and to a preferred
    // bundle's fallback spreading, the same way a booked fixed activity already is. Fixed
    // sessions and rest directives cannot share a date (validated at import time), so this
    // never contradicts the fixed-session block below.
    const restDates = new Set(resolveRestDatesByDate(plan).keys());
    const occupiedByDate = new Map<string, Set<string>>();
    const placed: PlacedSession[] = [];
    const authoredOrder = new Map(plan.sessions.map((session, index) => [session.id, index]));
    const stableWithinWeek = (left: ExternalPlanSession, right: ExternalPlanSession): number =>
        left.placement.week - right.placement.week
        || (authoredOrder.get(left.id) ?? 0) - (authoredOrder.get(right.id) ?? 0);

    const addOccupancy = (date: string, sessionId: string): void => {
        if (!date) return;
        const occupants = occupiedByDate.get(date) ?? new Set<string>();
        occupants.add(sessionId);
        occupiedByDate.set(date, occupants);
    };
    const isBlocked = (date: string, allowedSessionIds: ReadonlySet<string> = new Set<string>()): boolean => {
        if (fixedActivityDates.has(date) || restDates.has(date)) return true;
        const occupants = occupiedByDate.get(date);
        if (!occupants) return false;
        return [...occupants].some(sessionId => !allowedSessionIds.has(sessionId));
    };

    // Explicit overlay assignments are absolute per-session decisions and therefore win
    // before authored placement. A same-bundle assignment that remains on the authored
    // date may coexist with its unresolved preferred siblings below.
    for (const session of plan.sessions) {
        const override = assigned.get(session.id);
        if (!override) continue;
        const date = override.date;
        placed.push({
            session,
            date,
            status: override.status,
            moved: date !== impliedDate(plan, session),
        });
        if (occupiesDate(override.status)) addOccupancy(date, session.id);
    }

    // Preserve the original fixed-session contract: fixed work owns its implied date even
    // when that creates a real conflict. Preferred companions must yield rather than making
    // `preferred` silently equivalent to `fixed`.
    const fixedSessions = plan.sessions
        .filter(session => !assigned.has(session.id) && session.placement.flexibility === 'fixed')
        .sort(stableWithinWeek);
    for (const session of fixedSessions) {
        const date = impliedDate(plan, session);
        placed.push({ session, date, status: 'planned', moved: false });
        addOccupancy(date, session.id);
    }

    const bundles = new Map<string, ExternalPlanSession[]>();
    for (const session of plan.sessions) {
        const key = preferredBundleKey(session);
        if (assigned.has(session.id) || !key) continue;
        const bundle = bundles.get(key) ?? [];
        bundle.push(session);
        bundles.set(key, bundle);
    }

    // Match the pre-bundle resolver's stable sort: week first, authored order within a
    // week. Supporting double days must not become a reason to re-order unrelated work.
    const orderedBundles = [...bundles.entries()].sort(([, left], [, right]) =>
        stableWithinWeek(left[0], right[0]),
    );

    for (const [bundleKey, bundle] of orderedBundles) {
        const wanted = impliedDate(plan, bundle[0]);

        // An overlay for a preferred sibling that explicitly remains on the authored date
        // should not split the double day. A sibling moved elsewhere is intentionally not
        // ignored: overlay authority is per-session and may split the authored bundle.
        const sameBundleOverlayAtWanted = new Set(
            plan.sessions
                .filter(session => preferredBundleKey(session) === bundleKey)
                .filter(session => {
                    const assignment = assigned.get(session.id);
                    return assignment?.date === wanted && occupiesDate(assignment.status);
                })
                .map(session => session.id),
        );

        let date = wanted;
        if (isBlocked(wanted, sameBundleOverlayAtWanted)) {
            const week = weekDates(plan, bundle[0].placement.week);
            const free = week.find(candidate => candidate > wanted && !isBlocked(candidate))
                ?? week.find(candidate => !isBlocked(candidate));
            if (free) date = free;
        }

        for (const session of bundle) {
            placed.push({ session, date, status: 'planned', moved: date !== wanted });
            addOccupancy(date, session.id);
        }
    }

    // Distribute remaining non-fixed, non-bundled sessions (normally `any_day`) across the
    // open days. A preferred-day session only reaches this path when its schema combination
    // is not `flexibility: preferred`, so it remains an individual placement rather than an
    // authored double-day signal.
    const floatingSessions = plan.sessions
        .filter(session => !assigned.has(session.id)
            && session.placement.flexibility !== 'fixed'
            && !preferredBundleKey(session))
        .sort(stableWithinWeek);

    for (const session of floatingSessions) {
        const wanted = impliedDate(plan, session);
        let date = wanted;
        if (isBlocked(wanted)) {
            const week = weekDates(plan, session.placement.week);
            const free = week.find(candidate => candidate > wanted && !isBlocked(candidate))
                ?? week.find(candidate => !isBlocked(candidate));
            if (free) date = free;
        }
        addOccupancy(date, session.id);
        placed.push({ session, date, status: 'planned', moved: date !== wanted });
    }

    return placed.sort((left, right) => left.date.localeCompare(right.date) || left.session.id.localeCompare(right.session.id));
}

export type ReplacementOutcome = 'rescheduled' | 'dropped' | 'unresolved';

export interface ReplacementProposal {
    sessionId: string;
    outcome: ReplacementOutcome;
    /** The date the session was not done on. Carried so a confirmed `dropped` proposal has
     * a date to record even when the plan has no overlay entry for this session yet --
     * which is the common case, since an unmoved session lives only in the revision. */
    missedDate: string;
    /** Present only for `rescheduled`. */
    date?: string;
    rationale: string;
}

/**
 * Proposes what to do with a session that was not done on its date.
 *
 * Returns a **proposal**. It writes nothing: the athlete confirms, consistent with the
 * fallback-labelling posture everywhere else in the engine. It also never re-ranks or
 * substitutes — placement moves a session in time and does nothing else, because selection
 * belongs to the plan's author (ADR-0019 D-EXT).
 */
export function proposeReplacement(
    plan: ExternalTrainingPlan,
    overlay: ExternalPlanPlacement | null,
    missedSessionId: string,
    missedDate: string,
    occupancy: PlacementOccupancy = {},
    /** Today. A replacement must never be proposed into the past, which `missedDate` alone
     * cannot prevent: a session noticed as missed three days late would otherwise be
     * offered a date that has already gone. Defaults to `missedDate` so a caller reporting
     * a miss on the day it happened is unaffected. */
    today: string = missedDate,
): ReplacementProposal {
    const earliest = today > missedDate ? today : missedDate;
    const session = plan.sessions.find(item => item.id === missedSessionId);
    if (!session) {
        return { sessionId: missedSessionId, missedDate, outcome: 'unresolved', rationale: 'That session is not part of this plan revision.' };
    }

    if (session.placement.ifMissed === 'drop') {
        return {
            sessionId: missedSessionId,
            missedDate,
            outcome: 'dropped',
            rationale: 'Your plan marks this session as one to let go rather than chase.',
        };
    }

    const placed = resolvePlacement(plan, overlay, occupancy);
    const taken = new Set([
        ...placed.filter(item => item.session.id !== missedSessionId && occupiesDate(item.status)).map(item => item.date),
        // Booked commitments block a proposal exactly as they block initial placement --
        // otherwise a replacement can be proposed onto a match day.
        ...(occupancy.fixedActivities ?? []).filter(activity => !activity.isCompleted).map(activity => activity.date),
        // ADR-0035: an authored rest date blocks a missed-session replacement exactly as it
        // blocks initial placement -- chasing a missed session should not silently undo a
        // deliberate rest day.
        ...resolveRestDatesByDate(plan).keys(),
    ]);

    // If a miss is noticed later, today is a valid candidate when still in the same week.
    // If the athlete reports the miss on the missed day itself, that date is not offered
    // back to them: a replacement must still be strictly after the date they missed.
    const withinWeek = weekDates(plan, session.placement.week)
        .filter(date => date > missedDate && date >= earliest && !taken.has(date));
    if (withinWeek.length > 0) {
        return {
            sessionId: missedSessionId,
            missedDate,
            outcome: 'rescheduled',
            date: withinWeek[0],
            rationale: `Moved to ${withinWeek[0]}, the next free day in the same week.`,
        };
    }

    if (session.placement.ifMissed === 'reschedule_within_week') {
        return {
            sessionId: missedSessionId,
            missedDate,
            outcome: 'dropped',
            rationale: 'No free day is left in this session\'s own week, and your plan does not carry it forward.',
        };
    }

    // carry_forward: search onward across the rest of the plan, bounded by its own length.
    // A late-reported miss may use today itself; a same-day report still starts tomorrow.
    const lastDate = addDaysToLocalDateString(plan.startDate, plan.weekCount * 7 - 1);
    const startOffset = earliest > missedDate ? 0 : 1;
    for (let offset = startOffset; offset <= getDayDiff(lastDate, earliest); offset++) {
        const candidate = addDaysToLocalDateString(earliest, offset);
        if (candidate > missedDate && !taken.has(candidate)) {
            return {
                sessionId: missedSessionId,
                missedDate,
                outcome: 'rescheduled',
                date: candidate,
                rationale: `Carried forward to ${candidate}, the next free day in the plan.`,
            };
        }
    }

    return {
        sessionId: missedSessionId,
        missedDate,
        outcome: 'unresolved',
        rationale: 'No free day remains before this plan ends. Re-plan rather than forcing it in.',
    };
}

/** Applies a confirmed proposal to the overlay. Callers must not invoke this from the
 * proposal path — confirmation is the athlete's, and this is the only writer. */
export function applyConfirmedProposal(
    overlay: ExternalPlanPlacement,
    proposal: ReplacementProposal,
): ExternalPlanPlacement {
    if (proposal.outcome === 'unresolved') return overlay;
    const others = overlay.assignments.filter(item => item.sessionId !== proposal.sessionId);
    if (proposal.outcome === 'dropped') {
        const existing = overlay.assignments.find(item => item.sessionId === proposal.sessionId);
        // An unmoved session has no overlay entry at all -- the common case, since the
        // overlay only records departures from the plan. `missedDate` supplies the date so
        // the drop is recorded rather than silently discarded; writing an empty string
        // instead would read back as a PlacedSession dated '', sorting before every real date.
        return {
            ...overlay,
            assignments: [...others, { sessionId: proposal.sessionId, date: existing?.date ?? proposal.missedDate, status: 'dropped' }],
        };
    }
    return {
        ...overlay,
        assignments: [...others, { sessionId: proposal.sessionId, date: proposal.date!, status: 'moved' }],
    };
}
