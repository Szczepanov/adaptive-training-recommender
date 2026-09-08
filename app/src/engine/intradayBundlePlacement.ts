/**
 * ADR-0036 (H4) D-PLACEMENT: resolves one v4 intraday bundle's requested windows against
 * real `ScheduleWindow` availability (D-WINDOW), checks the combined minute/systemic-cost
 * budget via `dailyLedger.ts` (D-LEDGER), respects fixed commitments and ADR-0035 rest,
 * and computes scheduled separation from D-TIME's resolved instants. Produces an atomic
 * confirmed-proposal analogous to `externalPlacement.ts`'s `proposeReplacement`/
 * `applyConfirmedProposal`, but binding several same-date bundle members to distinct real
 * windows at once rather than moving one session to one date.
 *
 * Pure: no Firestore, no wiring into `evaluateTrainingWithIntent` or any decision path
 * yet -- see the H4 status notes in `docs/plans/cycling-primary-hybrid-evaluation.md`.
 * `POLICY_VERSION` is unchanged by this file.
 *
 * Scope note: this module resolves and validates a *scheduled* placement. "Separation"
 * here is the resolved gap between a predecessor's bound window end and a dependent's
 * bound window start, using D-TIME's instant resolution on the scheduled boundaries --
 * not the predecessor's actual execution end, which does not exist before either session
 * has started. Recomputing against real performed timestamps once execution begins is
 * D-REASSESS, a separate later ADR-0036 decision, not implemented here.
 */

import type { FixedActivity, ScheduleWindow, TrainingEnvironment } from './models';
import { resolveScheduleWindowsForDate, scheduleWindowsOverlap } from './scheduleWindows';
import { resolveLocalInstant, elapsedMinutesBetweenInstants } from './localInstant';
import { admitsCandidate, type DailyLedgerResult } from './dailyLedger';

export type BundleMemberPriority = 'key' | 'supporting' | 'optional';

/** One bundle member as D-PLACEMENT needs it -- a caller-projected view of a v4 session's
 * `intraday` request (`sessions/externalPlanV4.ts`) plus its already-estimated cost. This
 * module never estimates dose/duration/systemic-cost itself (D-LEDGER: "keep the current
 * common cost/eligibility authorities"); the caller supplies those from wherever the
 * existing decision path already computes them for a session. */
export interface IntradayBundleMember {
    sessionId: string;
    /** Unique within the bundle; earlier order = earlier in the day. Already validated
     * for uniqueness/reference-integrity by `externalPlanV4.ts` at import time -- this
     * module trusts that invariant rather than re-deriving it. */
    order: number;
    priority: BundleMemberPriority;
    /** HH:mm, the athlete-authored requested interval -- never imported as availability
     * (D-WINDOW); only ever intersected against a real `ScheduleWindow`. */
    requestedWindow: { startLocal: string; endLocal: string };
    /** An earlier required-completed predecessor's `sessionId`, when present. */
    afterSessionId?: string;
    minimumSeparationMinutes?: number;
    estimatedMinutes: number;
    /** 0..1, the same scale `dailyLedger.ts`'s `LedgerCeilings`/`LedgerEntry` use. */
    estimatedSystemicCost: number;
    /** True once this member has actually started. Its binding is carried through
     * unchanged and its window stays consumed; it is never re-bound or moved (ADR:
     * "once a member starts, do not move its history"). Requires `existingBinding`. */
    started: boolean;
    /** A previously confirmed binding for this member (required when `started`). When
     * present for an unstarted member, its window is preferred but still validated --
     * it is not blindly trusted, since the underlying `ScheduleWindow` set may have
     * changed since it was confirmed. */
    existingBinding?: ResolvedWindowBinding;
}

export interface ResolvedWindowBinding {
    sessionId: string;
    /** The real `ScheduleWindow.id` this session is bound to, or the sentinel below for
     * the legacy single-untimed-slot case. */
    windowId: string;
    /** The intersection of the requested window and the bound real window -- the actual
     * resolved interval, never wider than either. */
    boundStartLocal: string;
    boundEndLocal: string;
    /** D-TIME resolved instants for the bound interval, ISO-8601 UTC. */
    startInstant: string;
    endInstant: string;
}

export type BundlePlacementOutcome = 'placed' | 'infeasible';

export interface BundlePlacementProposal {
    bundleId: string;
    outcome: BundlePlacementOutcome;
    /** One binding per member -- started members' preserved history included -- present
     * only when `outcome` is 'placed'. Absent (not partial) when infeasible: "if the
     * whole proposal cannot fit, explain the conflict and leave placement unchanged"
     * (ADR) -- this module never returns a partial bundle placement. */
    bindings?: ResolvedWindowBinding[];
    /** Present only when `outcome` is 'infeasible'; names the first blocking conflict. */
    reason?: string;
}

/** Stands in for the date's single untimed slot when no `ScheduleWindow` exists for it
 * (D-WINDOW's supported legacy case). Exactly one bundle member can bind to it, the same
 * "at most one occurrence per resolved window" rule a real window is subject to -- so a
 * legacy date can never silently grow an AM/PM pair from missing metadata. */
export const LEGACY_SINGLE_SLOT_WINDOW_ID = 'legacy-single-slot';

interface PlacementWindow {
    windowId: string;
    startLocal: string;
    endLocal: string;
    equipment?: readonly string[];
    environment?: TrainingEnvironment;
}

function minutesFromHHmm(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}

function hhmmFromMinutes(totalMinutes: number): string {
    const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
    const hours = Math.floor(clamped / 60) % 24;
    const minutes = clamped % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function infeasible(bundleId: string, reason: string): BundlePlacementProposal {
    return { bundleId, outcome: 'infeasible', reason };
}

/** Real windows for the date, or the single legacy slot spanning the whole day when none
 * are recorded -- requested windows are still intersected against it below, they just
 * cannot make it any wider than a full day. */
function resolvePlacementWindows(date: string, scheduleWindows: readonly ScheduleWindow[]): PlacementWindow[] {
    const real = resolveScheduleWindowsForDate(date, scheduleWindows);
    if (real.length > 0) {
        return real.map(window => ({
            windowId: window.id,
            startLocal: window.startLocal,
            endLocal: window.endLocal,
            equipment: window.equipment,
            environment: window.environment,
        }));
    }
    return [{ windowId: LEGACY_SINGLE_SLOT_WINDOW_ID, startLocal: '00:00', endLocal: '23:59' }];
}

/** The date's fixed-activity-occupied intervals. Only immovable commitments
 * (`fixed: true`) block placement -- a movable placeholder is exactly the thing the
 * athlete could reschedule around, so treating it the same as a booked commitment would
 * reject a placement that is not actually blocked. An activity with a known `startTime`
 * only blocks windows it actually overlaps; one without a resolvable clock time is
 * conservative and blocks the whole date, matching legacy single-slot placement's
 * existing whole-date fixed-activity precedent (`externalPlacement.ts`'s
 * `PlacementOccupancy`) when finer-grained information is unavailable. */
function fixedOccupiedIntervals(
    date: string,
    fixedActivities: readonly FixedActivity[],
): readonly { startLocal: string; endLocal: string }[] | 'whole-date' {
    const activities = fixedActivities.filter(activity => activity.date === date && activity.fixed && !activity.isCompleted);
    if (activities.length === 0) return [];
    const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
    const intervals: { startLocal: string; endLocal: string }[] = [];
    for (const activity of activities) {
        if (!activity.startTime || !HHMM_PATTERN.test(activity.startTime)) return 'whole-date';
        const startMinutes = minutesFromHHmm(activity.startTime);
        const endMinutes = startMinutes + activity.durationMin;
        if (endMinutes > 24 * 60) return 'whole-date'; // crosses midnight -- conservative
        intervals.push({ startLocal: activity.startTime, endLocal: hhmmFromMinutes(endMinutes) });
    }
    return intervals;
}

function windowBlockedByFixed(
    window: PlacementWindow,
    occupied: readonly { startLocal: string; endLocal: string }[] | 'whole-date',
): boolean {
    if (occupied === 'whole-date') return true;
    return occupied.some(interval => scheduleWindowsOverlap(window, interval));
}

/** The intersection of a requested interval and a real placement window, or `null` when
 * they do not overlap at all. Never wider than either input (D-WINDOW: a plan request
 * can never create or broaden availability). */
function intersectWindow(
    requested: { startLocal: string; endLocal: string },
    real: PlacementWindow,
): { startLocal: string; endLocal: string } | null {
    const start = Math.max(minutesFromHHmm(requested.startLocal), minutesFromHHmm(real.startLocal));
    const end = Math.min(minutesFromHHmm(requested.endLocal), minutesFromHHmm(real.endLocal));
    if (end <= start) return null;
    return { startLocal: hhmmFromMinutes(start), endLocal: hhmmFromMinutes(end) };
}

function overlapMinutes(a: { startLocal: string; endLocal: string }, b: { startLocal: string; endLocal: string }): number {
    const start = Math.max(minutesFromHHmm(a.startLocal), minutesFromHHmm(b.startLocal));
    const end = Math.min(minutesFromHHmm(a.endLocal), minutesFromHHmm(b.endLocal));
    return Math.max(0, end - start);
}

/** Resolves one bound interval's instants via D-TIME. `null` communicates a nonexistent
 * (spring-forward gap) or ambiguous (fall-back fold) boundary -- callers must treat this
 * as unresolved rather than silently choosing an offset (D-TIME). */
function resolveBoundInstants(date: string, startLocal: string, endLocal: string): { startInstant: string; endInstant: string } | null {
    const start = resolveLocalInstant(date, startLocal);
    const end = resolveLocalInstant(date, endLocal);
    if (start.status !== 'resolved' || end.status !== 'resolved') return null;
    return { startInstant: start.instant, endInstant: end.instant };
}

function debitLedger(current: DailyLedgerResult, minutes: number, systemicCost: number): DailyLedgerResult {
    return {
        ...current,
        remainingMinutes: Math.max(0, current.remainingMinutes - minutes),
        remainingSystemicCost: Math.max(0, current.remainingSystemicCost - systemicCost),
    };
}

interface AssignmentState {
    pool: readonly PlacementWindow[];
    ledger: DailyLedgerResult;
    bindings: ReadonlyMap<string, ResolvedWindowBinding>;
}

type AssignmentResult = { bindings: ReadonlyMap<string, ResolvedWindowBinding> } | { reason: string };

/** Recursively assigns members `sortedMembers[index..]`, backtracking over candidate
 * windows for each unstarted member so an earlier member's greedy choice never rules
 * out a complete assignment that exists via a different choice (a real bug caught in
 * review: picking the single best-overlap candidate for an earlier member could consume
 * the only window a later member can use, even when swapping the earlier member onto
 * its next-best candidate would let both fit). Bundles and a date's window count are
 * both small in practice (first release scope), so this stays cheap in the realistic
 * case despite worst-case exponential branching. */
function assignFrom(date: string, sortedMembers: readonly IntradayBundleMember[], index: number, state: AssignmentState): AssignmentResult {
    if (index >= sortedMembers.length) return { bindings: state.bindings };
    const member = sortedMembers[index];

    if (member.started && member.existingBinding) {
        const binding = member.existingBinding;
        const nextPool = state.pool.filter(window => !scheduleWindowsOverlap(window, { startLocal: binding.boundStartLocal, endLocal: binding.boundEndLocal }));
        const nextBindings = new Map(state.bindings);
        nextBindings.set(member.sessionId, binding);
        const nextLedger = debitLedger(state.ledger, member.estimatedMinutes, member.estimatedSystemicCost);
        return assignFrom(date, sortedMembers, index + 1, { pool: nextPool, ledger: nextLedger, bindings: nextBindings });
    }

    const candidates = state.pool
        .map(window => ({ window, intersection: intersectWindow(member.requestedWindow, window) }))
        .filter((candidate): candidate is { window: PlacementWindow; intersection: { startLocal: string; endLocal: string } } =>
            candidate.intersection !== null,
        )
        .filter(candidate => {
            const durationMinutes = minutesFromHHmm(candidate.intersection.endLocal) - minutesFromHHmm(candidate.intersection.startLocal);
            return durationMinutes >= member.estimatedMinutes;
        })
        .sort((a, b) => {
            const overlapDiff = overlapMinutes(member.requestedWindow, b.window) - overlapMinutes(member.requestedWindow, a.window);
            return overlapDiff !== 0 ? overlapDiff : minutesFromHHmm(a.window.startLocal) - minutesFromHHmm(b.window.startLocal);
        });

    if (candidates.length === 0) {
        return {
            reason: `Session '${member.sessionId}' requests ${member.requestedWindow.startLocal}-${member.requestedWindow.endLocal} on `
                + `${date}, but no available window fits its duration after fixed commitments and other bundle members.`,
        };
    }

    let lastReason = `Session '${member.sessionId}' has no window assignment that also lets the remaining bundle members fit.`;

    for (const candidate of candidates) {
        const resolvedInstants = resolveBoundInstants(date, candidate.intersection.startLocal, candidate.intersection.endLocal);
        if (!resolvedInstants) {
            lastReason = `Session '${member.sessionId}''s bound window on ${date} falls on a nonexistent or ambiguous local time and requires explicit resolution.`;
            continue;
        }

        const admission = admitsCandidate(
            state.ledger,
            minutesFromHHmm(candidate.intersection.endLocal) - minutesFromHHmm(candidate.intersection.startLocal),
            member.estimatedMinutes,
            member.estimatedSystemicCost,
        );
        if (!admission.admitted) {
            lastReason = `Session '${member.sessionId}' cannot be admitted: the day's remaining minute or systemic-cost capacity is exhausted.`;
            continue;
        }

        if (member.afterSessionId) {
            const predecessorBinding = state.bindings.get(member.afterSessionId);
            if (!predecessorBinding) {
                return { reason: `Session '${member.sessionId}''s predecessor '${member.afterSessionId}' has no resolved binding yet.` };
            }
            const requiredSeparation = member.minimumSeparationMinutes ?? 0;
            // elapsedMinutesBetweenInstants(startInstant, endInstant) computes
            // startInstant - endInstant (D-TIME: "start minus the predecessor's actual
            // end instant"), so the dependent's start is the first argument.
            const gapMinutes = elapsedMinutesBetweenInstants(resolvedInstants.startInstant, predecessorBinding.endInstant);
            if (gapMinutes < requiredSeparation) {
                lastReason = `Session '${member.sessionId}' starts only ${gapMinutes} minute(s) after predecessor '${member.afterSessionId}' `
                    + `ends, short of the required ${requiredSeparation}.`;
                continue;
            }
        }

        const nextBindings = new Map(state.bindings);
        nextBindings.set(member.sessionId, {
            sessionId: member.sessionId,
            windowId: candidate.window.windowId,
            boundStartLocal: candidate.intersection.startLocal,
            boundEndLocal: candidate.intersection.endLocal,
            startInstant: resolvedInstants.startInstant,
            endInstant: resolvedInstants.endInstant,
        });
        const nextPool = state.pool.filter(window => window.windowId !== candidate.window.windowId);
        const nextLedger = debitLedger(state.ledger, member.estimatedMinutes, member.estimatedSystemicCost);

        const result = assignFrom(date, sortedMembers, index + 1, { pool: nextPool, ledger: nextLedger, bindings: nextBindings });
        if ('bindings' in result) return result;
        // This candidate placed `member` but left no valid assignment for the rest of
        // the bundle -- backtrack and try the next candidate rather than reporting
        // infeasible from a single greedy choice.
        lastReason = result.reason;
    }

    return { reason: lastReason };
}

/**
 * Proposes placement for one intraday bundle on one date. Returns a single atomic
 * result: either every member (started members preserved, unstarted members newly
 * bound) has a resolved window binding, or the whole proposal is infeasible with a
 * reason -- never a partial placement.
 *
 * `members` need not be pre-sorted. `restDates` are ADR-0035 dates closed to every
 * window by default (D-PLACEMENT: "availability does not override rest"). `ledger` is
 * the date's already-computed `dailyLedger.ts` remainder *before any* of this bundle's
 * own members -- started or not -- are considered; this function debits every member of
 * the bundle sequentially in `order` itself, so a caller must not have already
 * subtracted a started member's own consumption from `ledger` (that would double-charge
 * it). Candidate window assignment backtracks: an earlier member's best-overlap choice
 * that would leave no valid assignment for a later member is retried with that earlier
 * member's next-best candidate before the whole proposal is reported infeasible.
 */
export function proposeBundlePlacement(
    bundleId: string,
    date: string,
    members: readonly IntradayBundleMember[],
    scheduleWindows: readonly ScheduleWindow[],
    fixedActivities: readonly FixedActivity[],
    restDates: ReadonlySet<string>,
    ledger: DailyLedgerResult,
): BundlePlacementProposal {
    if (members.length === 0) return infeasible(bundleId, 'Bundle has no members to place.');

    if (restDates.has(date)) {
        return infeasible(bundleId, `${date} is an authored rest date; every window is closed by default.`);
    }

    for (const member of members) {
        if (member.started && !member.existingBinding) {
            return infeasible(bundleId, `Session '${member.sessionId}' has started but carries no existing binding.`);
        }
    }

    const sorted = [...members].sort((a, b) => a.order - b.order);
    const occupied = fixedOccupiedIntervals(date, fixedActivities);
    const pool = resolvePlacementWindows(date, scheduleWindows).filter(window => !windowBlockedByFixed(window, occupied));

    const result = assignFrom(date, sorted, 0, { pool, ledger, bindings: new Map() });
    if ('reason' in result) return infeasible(bundleId, result.reason);

    return {
        bundleId,
        outcome: 'placed',
        bindings: sorted.map(member => result.bindings.get(member.sessionId)!),
    };
}

/**
 * Drops one optional, not-yet-started member from a bundle before re-proposing
 * placement for the remainder. This is an explicit athlete action, never an automatic
 * one (ADR: "an athlete may explicitly drop an optional member before re-evaluating the
 * remainder; do not silently split the bundle to make a proposal fit"). Dropped work is
 * not carried forward -- the caller re-runs `proposeBundlePlacement` on the returned,
 * smaller member list to see whether the remainder now fits.
 *
 * Never orphans a required member: D-SCHEMA already rejects a required session
 * depending on an optional predecessor at import time, so no remaining required member
 * can reference a dropped optional one as `afterSessionId`.
 */
export function dropOptionalBundleMember(
    members: readonly IntradayBundleMember[],
    sessionId: string,
): IntradayBundleMember[] {
    const target = members.find(member => member.sessionId === sessionId);
    if (!target) throw new Error(`Session '${sessionId}' is not part of this bundle.`);
    if (target.priority !== 'optional') throw new Error(`Session '${sessionId}' is not optional and cannot be dropped from the bundle.`);
    if (target.started) throw new Error(`Session '${sessionId}' has already started; its history cannot be dropped.`);
    return members.filter(member => member.sessionId !== sessionId);
}

/**
 * The athlete-confirmation boundary, mirroring `externalPlacement.ts`'s
 * `applyConfirmedProposal`. A `proposeBundlePlacement` result is only a proposal; this
 * function is the sole place that treats one as accepted. It writes nothing itself --
 * this module has no persistence, and no persisted bundle-binding store exists yet
 * (that is wiring/D-AUDIT's job, not delivered here) -- it simply asserts the proposal
 * is placeable and returns its bindings for a caller to persist.
 */
export function confirmBundlePlacement(proposal: BundlePlacementProposal): ResolvedWindowBinding[] {
    if (proposal.outcome !== 'placed' || !proposal.bindings) {
        throw new Error(`Cannot confirm an infeasible bundle placement: ${proposal.reason ?? 'no bindings available'}`);
    }
    return proposal.bindings;
}
