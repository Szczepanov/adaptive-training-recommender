import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import type {
    ExternalPlacementAssignment,
    ExternalPlanPlacement,
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

/**
 * Resolves every session to a date. The stored overlay wins; otherwise the plan's own
 * week/day preference applies, and a `preferred`/`any_day` session shifts to the next free
 * day in its own week rather than doubling up.
 *
 * A `fixed` session never moves — if its day is taken it stays there and the caller sees
 * two sessions on one date, which is a real conflict the athlete should resolve rather
 * than one this function should silently paper over.
 */
export function resolvePlacement(
    plan: ExternalTrainingPlan,
    overlay: ExternalPlanPlacement | null,
    occupancy: PlacementOccupancy = {},
): PlacedSession[] {
    const assigned = new Map((overlay?.assignments ?? []).map(item => [item.sessionId, item]));
    const taken = new Set<string>(
        (occupancy.fixedActivities ?? []).filter(activity => !activity.isCompleted).map(activity => activity.date),
    );
    const placed: PlacedSession[] = [];

    // Fixed sessions first: they cannot yield, so everything else spreads around them.
    const ordered = [...plan.sessions].sort((left, right) => {
        const fixedRank = Number(right.placement.flexibility === 'fixed') - Number(left.placement.flexibility === 'fixed');
        if (fixedRank !== 0) return fixedRank;
        return left.placement.week - right.placement.week;
    });

    for (const session of ordered) {
        const override = assigned.get(session.id);
        if (override) {
            placed.push({
                session,
                date: override.date,
                status: override.status,
                moved: override.date !== impliedDate(plan, session),
            });
            if (occupiesDate(override.status) && override.date) taken.add(override.date);
            continue;
        }

        const wanted = impliedDate(plan, session);
        let date = wanted;
        if (session.placement.flexibility !== 'fixed' && taken.has(wanted)) {
            // Forward within the week first: moving a blocked Saturday session to Monday
            // would schedule it in the past relative to where the plan put it.
            const week = weekDates(plan, session.placement.week);
            const free = week.find(candidate => candidate > wanted && !taken.has(candidate))
                ?? week.find(candidate => !taken.has(candidate));
            if (free) date = free;
        }
        taken.add(date);
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
