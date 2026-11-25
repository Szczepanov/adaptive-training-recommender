/** C1 planned-session reconstruction for the D-EVAL assembler. Pure. */

import {
    hasRecordedPrevious,
    placementAsOf,
    placementBeforeHistory,
    type PlacementAssignment,
    type PlacementEvent,
} from '../../ledger/placementHistory.ts';
import { isStructuredExecutionRef, type PerformedTrainingOccurrence } from '../../training-occurrence/models.ts';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate.ts';
import type { DEvalC1BlockInput, DEvalC1PlannedSessionInput } from './dEvalC1.ts';
import { isLocalCalendarDate, parseUtcTimestampMs } from './dEvalCriteria.ts';
import { createPlanGovernance, type PlanGovernance } from './dEvalPlanGovernance.ts';
import type {
    DEvalRawExecution,
    DEvalRawLedgerData,
    DEvalRawPlacementOverlay,
    DEvalRawPlanIssue,
    DEvalRawPlanRevision,
    DEvalRawPlanSession,
    DEvalRawResponse,
} from './dEvalRawLedger.ts';

const RESPONSE_WINDOW_ORDER: Record<DEvalRawResponse['window'], number> = {
    immediate: 0,
    later_day: 1,
    next_morning: 2,
};

export function occurrenceLocalDate(occ: PerformedTrainingOccurrence): string | null {
    if (occ.localDate && isLocalCalendarDate(occ.localDate)) return occ.localDate;
    if (occ.startedAt) {
        const ms = parseUtcTimestampMs(occ.startedAt);
        if (ms !== null) return getLocalDateString(new Date(ms));
    }
    return null;
}

function resolveResponseCompletedFraction(
    responses: readonly DEvalRawResponse[],
    asOfDate: string,
    asOfMs: number | null,
): number | undefined {
    const valid = responses
        .filter(resp => {
            if (resp.date > asOfDate) return false;
            if (asOfMs !== null) {
                const updatedMs = parseUtcTimestampMs(resp.updatedAt) ?? parseUtcTimestampMs(resp.createdAt);
                if (updatedMs !== null && updatedMs > asOfMs) return false;
            }
            return resp.completedFraction !== undefined;
        })
        .sort((a, b) => RESPONSE_WINDOW_ORDER[a.window] - RESPONSE_WINDOW_ORDER[b.window]);

    if (valid.length === 0) return undefined;
    const first = valid[0]!.completedFraction!;
    const conflicts = valid.some(
        resp => (resp.completedFraction === 1) !== (first === 1) || Math.abs(resp.completedFraction! - first) > 1e-6,
    );
    // Conflicting completion fractions across response windows resolve to `unknown` in `classifyDEvalSessionOutcome`.
    return conflicts ? Number.NaN : first;
}

interface LinkedSessionMatch {
    occurrence: PerformedTrainingOccurrence;
    performedDate: string | null;
    execution: DEvalRawExecution;
    responseCompletedFraction: number | undefined;
}

export function revisionKey(planId: string, revision: number): string {
    return `${planId}@${revision}`;
}

function sessionKey(planId: string, revision: number, sessionId: string): string {
    return `${planId}@${revision}:${sessionId}`;
}

export interface RevisionPlacementIndex {
    verifiedRevMap: Map<string, DEvalRawPlanRevision>;
    overlaysByRev: Map<string, DEvalRawPlacementOverlay>;
    eventsByRev: Map<string, PlacementEvent[]>;
    issueReasonsByRev: Map<string, Set<DEvalRawPlanIssue['reason']>>;
    issueReasonsByPlan: Map<string, Set<DEvalRawPlanIssue['reason']>>;
    governingOn: PlanGovernance;
    /** Session key -> governed dates on which it came due with no recorded assignment. */
    unrecordedSessions: ReadonlyMap<string, readonly string[]>;
}

export function indexPlans(raw: DEvalRawLedgerData): RevisionPlacementIndex {
    const verifiedRevMap = new Map<string, DEvalRawPlanRevision>();
    const issueReasonsByRev = new Map<string, Set<DEvalRawPlanIssue['reason']>>();
    const issueReasonsByPlan = new Map<string, Set<DEvalRawPlanIssue['reason']>>();

    for (const issue of raw.planIssues ?? []) {
        if (issue.revision !== undefined) {
            const key = revisionKey(issue.planId, issue.revision);
            const set = issueReasonsByRev.get(key) ?? new Set();
            set.add(issue.reason);
            issueReasonsByRev.set(key, set);
        } else {
            const set = issueReasonsByPlan.get(issue.planId) ?? new Set();
            set.add(issue.reason);
            issueReasonsByPlan.set(issue.planId, set);
        }
    }

    for (const rev of raw.planRevisions) {
        const key = revisionKey(rev.planId, rev.revision);
        if (!issueReasonsByRev.get(key)?.has('unverified_revision')) {
            verifiedRevMap.set(key, rev);
        }
    }

    const overlaysByRev = new Map<string, DEvalRawPlacementOverlay>();
    for (const overlay of raw.placements) {
        overlaysByRev.set(revisionKey(overlay.planId, overlay.revision), overlay);
    }

    const eventsByRev = new Map<string, PlacementEvent[]>();
    for (const event of raw.placementHistory) {
        const key = revisionKey(event.planId, event.revision);
        const list = eventsByRev.get(key) ?? [];
        list.push(event);
        eventsByRev.set(key, list);
    }
    for (const list of eventsByRev.values()) {
        list.sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt));
    }

    const governingOn = createPlanGovernance(verifiedRevMap.values());
    const unrecordedSessions = indexUnrecordedSessions(verifiedRevMap, eventsByRev, overlaysByRev, governingOn);
    return {
        verifiedRevMap, overlaysByRev, eventsByRev, issueReasonsByRev, issueReasonsByPlan, governingOn, unrecordedSessions,
    };
}

function snapshotOverlayOnDate(
    events: readonly PlacementEvent[],
    overlay: DEvalRawPlacementOverlay | undefined,
    date: string,
): readonly PlacementAssignment[] | null {
    if (events.length === 0) return overlay?.assignments ?? [];
    return placementAsOf(events, date) ?? placementBeforeHistory(events);
}

function findRecordedSuccessor(
    events: readonly PlacementEvent[],
    overlay: DEvalRawPlacementOverlay | undefined,
    sessionId: string,
    asOfDate: string,
): { revision: number; sessionId: string } | null {
    const priorEvents = events.filter(event => event.changedOn <= asOfDate);
    for (let i = priorEvents.length - 1; i >= 0; i -= 1) {
        const successor = priorEvents[i]!.successors[sessionId];
        if (successor) return successor;
    }
    return overlay?.successors?.[sessionId] ?? null;
}

export function buildExecutionAndLinkIndexes(
    raw: DEvalRawLedgerData,
    verifiedRevMap: ReadonlyMap<string, DEvalRawPlanRevision>,
    asOfDate: string,
    asOfMs: number | null,
) {
    const execById = new Map<string, DEvalRawExecution>();
    const execsBySession = new Map<string, DEvalRawExecution[]>();
    const unverifiedSessions = new Set<string>();

    for (const exec of raw.executions) {
        if (exec.date > asOfDate) continue;
        if (asOfMs !== null) {
            const startedMs = parseUtcTimestampMs(exec.startedAt);
            if (startedMs !== null && startedMs > asOfMs) continue;
        }
        execById.set(exec.executionId, exec);
        const src = exec.sessionSource;
        if (src.kind === 'external_plan' && src.planId && src.revision !== undefined && src.sessionId) {
            const key = sessionKey(src.planId, src.revision, src.sessionId);
            const verifiedRev = verifiedRevMap.get(revisionKey(src.planId, src.revision));
            if (!verifiedRev || !src.contentHash || verifiedRev.contentHash !== src.contentHash) {
                unverifiedSessions.add(key);
                continue;
            }
            const list = execsBySession.get(key) ?? [];
            list.push(exec);
            execsBySession.set(key, list);
        }
    }

    const responsesByExecId = new Map<string, DEvalRawResponse[]>();
    for (const resp of raw.responses) {
        if (resp.sourceSession.kind !== 'execution') continue;
        const list = responsesByExecId.get(resp.sourceSession.id) ?? [];
        list.push(resp);
        responsesByExecId.set(resp.sourceSession.id, list);
    }

    const linksBySession = new Map<string, LinkedSessionMatch[]>();

    for (const occ of raw.performedOccurrences) {
        if (occ.status !== 'active') continue;
        const occDate = occurrenceLocalDate(occ);
        if (occDate !== null && occDate > asOfDate) continue;
        if (asOfMs !== null && occ.startedAt) {
            const startedMs = parseUtcTimestampMs(occ.startedAt);
            if (startedMs !== null && startedMs > asOfMs) continue;
        }
        for (const ref of occ.sourceRefs) {
            if (!isStructuredExecutionRef(ref)) continue;
            const exec = execById.get(ref.executionId);
            if (!exec) continue;
            const src = exec.sessionSource;
            if (src.kind !== 'external_plan' || !src.planId || src.revision === undefined || !src.sessionId) continue;
            const key = sessionKey(src.planId, src.revision, src.sessionId);
            const verifiedRev = verifiedRevMap.get(revisionKey(src.planId, src.revision));
            if (!verifiedRev || !src.contentHash || verifiedRev.contentHash !== src.contentHash) {
                unverifiedSessions.add(key);
                continue;
            }
            const resps = responsesByExecId.get(exec.executionId) ?? [];
            const match: LinkedSessionMatch = {
                occurrence: occ,
                performedDate: occDate,
                execution: exec,
                responseCompletedFraction: resolveResponseCompletedFraction(resps, asOfDate, asOfMs),
            };
            const list = linksBySession.get(key) ?? [];
            list.push(match);
            linksBySession.set(key, list);
        }
    }

    for (const list of linksBySession.values()) {
        list.sort((a, b) =>
            (a.performedDate ?? '').localeCompare(b.performedDate ?? '')
            || (a.occurrence.startedAt ?? '').localeCompare(b.occurrence.startedAt ?? '')
            || a.occurrence.performedOccurrenceId.localeCompare(b.occurrence.performedOccurrenceId));
    }

    return { execById, execsBySession, unverifiedSessions, linksBySession };
}

/** The date a session was shown on just before the first placement that recorded it. */
function shownDateBeforePlacement(assignment: PlacementAssignment, session: DEvalRawPlanSession): string {
    if (assignment.status === 'moved') return assignment.movedFrom ?? session.authoredDate;
    return assignment.date;
}

/**
 * The last event that removed a session's recorded assignment before it came due. Only an overlay
 * reset does this; the session then returns to its plan date, so earlier placements say nothing more.
 */
function findRemovalBeforeDue(
    events: readonly PlacementEvent[],
    sessionId: string,
): { index: number; changedOn: string; recordedDate: string } | null {
    const dateIn = (items: readonly PlacementAssignment[]) => items.find(item => item.sessionId === sessionId)?.date ?? null;
    let held = events.length > 0 ? dateIn(events[0]!.previous) : null;
    let removal: { index: number; changedOn: string; recordedDate: string } | null = null;
    events.forEach((event, index) => {
        const next = dateIn(event.assignments);
        if (held !== null && next === null) {
            removal = held >= event.changedOn ? { index, changedOn: event.changedOn, recordedDate: held } : null;
        }
        held = next;
    });
    return removal;
}

/**
 * Dates on which a session came due without any recorded assignment, or null when its assignment is
 * recorded from the start or was placed on or before the date it was shown on.
 *
 * The overlay records only departures from the plan (a move, drop or replacement). A session done or
 * missed as authored therefore has no assignment, and one first moved or dropped after its date has
 * none on that date. Where a floating session was shown depended on that week's other sessions and
 * fixed activities, which are not kept, so any day of its week is possible.
 */
function unrecordedDueDates(
    session: DEvalRawPlanSession,
    events: readonly PlacementEvent[],
    overlay: DEvalRawPlacementOverlay | undefined,
): { dates: readonly string[] } | null {
    const isSession = (item: PlacementAssignment) => item.sessionId === session.id;
    const removal = findRemovalBeforeDue(events, session.id);
    if (
        removal === null
        && (events.length > 0 ? events[0]!.previous.some(isSession) : overlay?.assignments.some(isSession))
    ) return null;

    const firstEvent = events.slice(removal === null ? 0 : removal.index + 1).find(item => item.assignments.some(isSession));
    if (firstEvent) {
        const shown = shownDateBeforePlacement(firstEvent.assignments.find(isSession)!, session);
        return firstEvent.changedOn <= shown ? null : { dates: [shown] };
    }
    const planDates = session.floating
        ? Array.from({ length: 7 }, (_, offset) => addDaysToLocalDateString(session.authoredDate, offset))
        : [session.authoredDate];
    if (removal === null) return { dates: planDates };
    const remaining = planDates.filter(date => date >= removal.changedOn);
    return { dates: remaining.length > 0 ? remaining : [removal.recordedDate] };
}

/** Sessions that came due without a recorded assignment, with the governed dates they may have been due on. */
function indexUnrecordedSessions(
    verifiedRevMap: ReadonlyMap<string, DEvalRawPlanRevision>,
    eventsByRev: ReadonlyMap<string, readonly PlacementEvent[]>,
    overlaysByRev: ReadonlyMap<string, DEvalRawPlacementOverlay>,
    governingOn: PlanGovernance,
): Map<string, readonly string[]> {
    const unrecorded = new Map<string, readonly string[]>();
    for (const [revKey, rev] of verifiedRevMap) {
        for (const session of rev.sessions) {
            const due = unrecordedDueDates(session, eventsByRev.get(revKey) ?? [], overlaysByRev.get(revKey));
            const governed = due?.dates.filter(date => governingOn(date) === rev) ?? [];
            if (governed.length > 0) unrecorded.set(sessionKey(rev.planId, rev.revision, session.id), governed);
        }
    }
    return unrecorded;
}

export function assembleC1Window(params: {
    windowStart: string;
    windowEnd: string;
    effectiveEnd: string;
    raw: DEvalRawLedgerData;
    planIndex: RevisionPlacementIndex;
    execsBySession: ReadonlyMap<string, readonly DEvalRawExecution[]>;
    unverifiedSessions: ReadonlySet<string>;
    linksBySession: ReadonlyMap<string, readonly LinkedSessionMatch[]>;
    activeFlagOnDate: (date: string) => boolean | null;
    redFlagOnDate: (date: string) => boolean | null;
    asOfDate: string;
    asOfMs: number | null;
}): {
    block: DEvalC1BlockInput;
    linkedOccurrenceIds: Set<string>;
    knownLimits: string[];
} {
    const {
        windowStart,
        windowEnd,
        effectiveEnd,
        raw,
        planIndex,
        execsBySession,
        unverifiedSessions,
        linksBySession,
        activeFlagOnDate,
        redFlagOnDate,
        asOfDate,
        asOfMs,
    } = params;

    const plannedSessions: DEvalC1PlannedSessionInput[] = [];
    const linkedOccurrenceIds = new Set<string>();
    const knownLimits: string[] = [];
    const seenSessionKeys = new Set<string>();

    if (!isLocalCalendarDate(windowStart) || !isLocalCalendarDate(effectiveEnd) || windowStart > effectiveEnd) {
        return { block: { plannedSessions: [], unplannedCount: 0 }, linkedOccurrenceIds, knownLimits };
    }

    const baseReadsComplete = raw.externalPlansState === 'measured'
        && raw.occurrencesState === 'measured'
        && raw.executionsState === 'measured'
        && raw.responsesState === 'measured';

    if (!baseReadsComplete) {
        knownLimits.push(`Incomplete source reads for ${windowStart}..${effectiveEnd}; planned sessions default to unknown.`);
    }

    const revKeys = [...new Set([...planIndex.overlaysByRev.keys(), ...planIndex.eventsByRev.keys()])].sort();

    for (const revKey of revKeys) {
        const overlay = planIndex.overlaysByRev.get(revKey);
        const events = planIndex.eventsByRev.get(revKey) ?? [];
        const planId = overlay?.planId ?? events[0]?.planId ?? '';
        const revIssues = planIndex.issueReasonsByRev.get(revKey);
        const planWideIssues = planIndex.issueReasonsByPlan.get(planId);
        const isRevUnverified = !planIndex.verifiedRevMap.has(revKey)
            || Boolean(revIssues?.has('unverified_revision'))
            || Boolean(planWideIssues?.has('unverified_revision'));
        const hasHistoryOrOverlayFailure = Boolean(
            revIssues?.has('history_truncated')
            || revIssues?.has('history_invalid')
            || revIssues?.has('history_unavailable')
            || revIssues?.has('placement_invalid')
            || revIssues?.has('placement_unavailable')
            || planWideIssues?.has('placement_invalid')
            || planWideIssues?.has('placement_unavailable'),
        );

        // Latest repair event over a corrupt overlay: dates strictly before it lack recorded prior history.
        const latestCorruptPrior = [...events]
            .filter(event => event.changedOn <= effectiveEnd && !hasRecordedPrevious(event))
            .at(-1);

        if (hasHistoryOrOverlayFailure) {
            knownLimits.push(`Placement or placement history for ${revKey} was truncated or unreadable.`);
        }

        for (let date = windowStart; date <= effectiveEnd; date = addDaysToLocalDateString(date, 1)) {
            const governing = planIndex.governingOn(date);
            const isStaleRevision = governing !== null && revisionKey(governing.planId, governing.revision) !== revKey;
            const snapshot = snapshotOverlayOnDate(events, overlay, date);
            if (snapshot === null) continue;

            for (const assignment of snapshot) {
                if (assignment.date !== date) continue;
                const key = `${revKey}:${assignment.sessionId}`;
                // First moved, dropped or replaced after the date it was shown on: it is due there, in
                // whichever window holds that date, so this later assignment is not a second one.
                if (seenSessionKeys.has(key) || planIndex.unrecordedSessions.has(key)) continue;

                // If moved from before this window AFTER its original pre-window due date, it belonged there.
                if (assignment.status === 'moved' && assignment.movedFrom && assignment.movedFrom < windowStart) {
                    const origSnapshot = snapshotOverlayOnDate(events, overlay, assignment.movedFrom);
                    const wasDueBefore = origSnapshot?.some(
                        item => item.sessionId === assignment.sessionId && item.date === assignment.movedFrom,
                    );
                    if (wasDueBefore) continue;
                }

                // A future session replaced on or before its due date is counted once through its successor.
                if (assignment.status === 'superseded') {
                    const successor = findRecordedSuccessor(events, overlay, assignment.sessionId, date);
                    if (successor) {
                        seenSessionKeys.add(key);
                        continue;
                    }
                }

                seenSessionKeys.add(key);

                const matches = linksBySession.get(key) ?? [];
                const primaryMatch = matches[0] ?? null;
                if (primaryMatch) {
                    linkedOccurrenceIds.add(primaryMatch.occurrence.performedOccurrenceId);
                }

                const priorUnknownBeforeRepair = Boolean(latestCorruptPrior && date < latestCorruptPrior.changedOn);
                const missingSuccessor = assignment.status === 'superseded';
                const unverifiedEvidence = isRevUnverified
                    || unverifiedSessions.has(key)
                    || matches.length > 1;
                // A leftover assignment of a replaced revision was no longer shown, and a session whose
                // +1-day window is still open can still be completed: neither is a confirmed miss.
                const missUnconfirmed = primaryMatch === null
                    && (isStaleRevision || asOfDate <= addDaysToLocalDateString(date, 1));
                const evidenceComplete = baseReadsComplete
                    && !missUnconfirmed
                    && !hasHistoryOrOverlayFailure
                    && !priorUnknownBeforeRepair
                    && !missingSuccessor;

                const sessionExecutions = (execsBySession.get(key) ?? []).map(exec => ({ state: exec.state }));
                const performedDate = primaryMatch?.performedDate ?? null;

                plannedSessions.push({
                    sessionKey: `${key}@${date}`,
                    assignedDate: date,
                    asOfDate,
                    status: assignment.status,
                    evidenceComplete,
                    linked: primaryMatch !== null,
                    unverifiedEvidence,
                    executions: sessionExecutions,
                    performedDate,
                    performedOccurrenceId: primaryMatch?.occurrence.performedOccurrenceId ?? null,
                    blockStartDate: windowStart,
                    blockEndDate: windowEnd,
                    linkedExecution: primaryMatch
                        ? {
                            state: primaryMatch.execution.state,
                            executedDefinition: primaryMatch.execution.executedDefinition ?? null,
                            completedFraction: primaryMatch.execution.completionEvidence?.completedFraction ?? null,
                        }
                        : null,
                    responseCompletedFraction: primaryMatch?.responseCompletedFraction ?? null,
                    activeFlagOnAssignedDate: activeFlagOnDate(date),
                    redFlagOnAssignedDate: redFlagOnDate(date),
                });
            }
        }
    }

    // A floating session whose week straddles two windows is unknown in both: either may have held it.
    const unrecordedInWindow = [...planIndex.unrecordedSessions].flatMap(([key, dates]) => {
        const date = dates.find(candidate => candidate >= windowStart && candidate <= effectiveEnd);
        return date === undefined ? [] : [{ key, date }];
    });
    for (const { key, date } of unrecordedInWindow) {
        const matches = linksBySession.get(key) ?? [];
        plannedSessions.push({
            sessionKey: `${key}@${date}`,
            assignedDate: date,
            asOfDate,
            status: null,
            evidenceComplete: false,
            linked: matches.length > 0,
            unverifiedEvidence: unverifiedSessions.has(key),
            executions: (execsBySession.get(key) ?? []).map(exec => ({ state: exec.state })),
            performedOccurrenceId: matches[0]?.occurrence.performedOccurrenceId ?? null,
            blockStartDate: windowStart,
            blockEndDate: windowEnd,
        });
    }
    if (unrecordedInWindow.length > 0) {
        knownLimits.push(
            `${unrecordedInWindow.length} authored plan session(s) in ${windowStart}..${effectiveEnd} had no placement recorded `
            + 'by the date they were due (the overlay records only moves, drops and replacements); counted as unknown.',
        );
    }

    plannedSessions.sort((a, b) =>
        a.assignedDate.localeCompare(b.assignedDate) || (a.sessionKey ?? '').localeCompare(b.sessionKey ?? ''));

    const allLinkedOccurrenceIds = new Set<string>();
    for (const matches of linksBySession.values()) {
        for (const match of matches) {
            allLinkedOccurrenceIds.add(match.occurrence.performedOccurrenceId);
        }
    }

    let unplannedCount = 0;
    for (const occ of raw.performedOccurrences) {
        if (occ.status !== 'active') continue;
        const occDate = occurrenceLocalDate(occ);
        if (!occDate || occDate < windowStart || occDate > effectiveEnd) continue;
        if (asOfMs !== null && occ.startedAt) {
            const startedMs = parseUtcTimestampMs(occ.startedAt);
            if (startedMs !== null && startedMs > asOfMs) continue;
        }
        if (!linkedOccurrenceIds.has(occ.performedOccurrenceId) && !allLinkedOccurrenceIds.has(occ.performedOccurrenceId)) {
            unplannedCount += 1;
        }
    }

    return { block: { plannedSessions, unplannedCount }, linkedOccurrenceIds, knownLimits };
}
