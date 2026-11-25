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

function isTimestampAfterCutoff(
    iso: string | null | undefined,
    asOfDate: string,
    asOfMs: number | null,
): boolean {
    const ms = parseUtcTimestampMs(iso);
    if (ms === null) return true;
    return asOfMs !== null ? ms > asOfMs : getLocalDateString(new Date(ms)) > asOfDate;
}

function resolveResponseCompletedFraction(
    responses: readonly DEvalRawResponse[],
    asOfDate: string,
    asOfMs: number | null,
): number | undefined {
    const valid = responses
        .filter(resp => {
            if (resp.date > asOfDate) return false;
            if (resp.updatedAt !== undefined && isTimestampAfterCutoff(resp.updatedAt, asOfDate, asOfMs)) {
                return false;
            }
            if (resp.createdAt !== undefined && isTimestampAfterCutoff(resp.createdAt, asOfDate, asOfMs)) {
                return false;
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

export function indexPlans(raw: DEvalRawLedgerData, asOfMs: number | null = null): RevisionPlacementIndex {
    const verifiedRevMap = new Map<string, DEvalRawPlanRevision>();
    const postCutoffRevKeys = new Set<string>();
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
        if (asOfMs !== null) {
            const importedMs = parseUtcTimestampMs(rev.importedAt);
            if (importedMs !== null && importedMs > asOfMs) {
                postCutoffRevKeys.add(key);
                continue;
            }
        }
        if (!issueReasonsByRev.get(key)?.has('unverified_revision')) {
            verifiedRevMap.set(key, rev);
        }
    }

    const overlaysByRev = new Map<string, DEvalRawPlacementOverlay>();
    for (const overlay of raw.placements) {
        const key = revisionKey(overlay.planId, overlay.revision);
        if (postCutoffRevKeys.has(key)) continue;
        overlaysByRev.set(key, overlay);
    }

    const eventsByRev = new Map<string, PlacementEvent[]>();
    for (const event of raw.placementHistory) {
        const key = revisionKey(event.planId, event.revision);
        if (postCutoffRevKeys.has(key)) continue;
        const list = eventsByRev.get(key) ?? [];
        list.push(event);
        eventsByRev.set(key, list);
    }
    for (const list of eventsByRev.values()) {
        list.sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt));
    }

    const governingOn = createPlanGovernance(verifiedRevMap.values(), asOfMs);
    const unrecordedSessions = indexUnrecordedSessions(verifiedRevMap, eventsByRev, governingOn);
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
    sessionId: string,
    asOfDate: string,
): { revision: number; sessionId: string } | null {
    const priorEvents = events.filter(event => event.changedOn <= asOfDate);
    for (let i = priorEvents.length - 1; i >= 0; i -= 1) {
        const successor = priorEvents[i]!.successors[sessionId];
        if (successor) return successor;
    }
    return null;
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
        const startedMs = parseUtcTimestampMs(exec.startedAt);
        if (startedMs !== null) {
            const startedAfter = asOfMs !== null
                ? startedMs > asOfMs
                : getLocalDateString(new Date(startedMs)) > asOfDate;
            if (startedAfter) continue;
        }
        const completedAfterCutoff = (exec.state === 'completed' || exec.state === 'abandoned')
            && exec.completedAt !== undefined
            && exec.completedAt !== null
            && isTimestampAfterCutoff(exec.completedAt, asOfDate, asOfMs);
        const effectiveExec: DEvalRawExecution = completedAfterCutoff
            ? {
                ...exec,
                state: 'in_progress',
                completedAt: null,
                completionEvidence: undefined,
            }
            : exec;
        execById.set(exec.executionId, effectiveExec);
        const src = exec.sessionSource;
        if (src.kind === 'external_plan' && src.planId && src.revision !== undefined && src.sessionId) {
            const key = sessionKey(src.planId, src.revision, src.sessionId);
            const verifiedRev = verifiedRevMap.get(revisionKey(src.planId, src.revision));
            if (!verifiedRev || !src.contentHash || verifiedRev.contentHash !== src.contentHash) {
                unverifiedSessions.add(key);
                continue;
            }
            const list = execsBySession.get(key) ?? [];
            list.push(effectiveExec);
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
): { dates: readonly string[] } | null {
    const findAssignment = (items: readonly PlacementAssignment[]) =>
        items.find(item => item.sessionId === session.id) ?? null;

    let held = events.length > 0 ? (findAssignment(events[0]!.previous)?.date ?? null) : null;
    let lastRemoval: { changedOn: string; recordedDate: string } | null = null;

    for (const event of events) {
        const nextAssignment = findAssignment(event.assignments);
        const next = nextAssignment?.date ?? null;

        if (held === null && nextAssignment !== null) {
            const rawShown = shownDateBeforePlacement(nextAssignment, session);
            const shown = lastRemoval !== null && rawShown < lastRemoval.changedOn
                ? lastRemoval.recordedDate
                : rawShown;
            if (event.changedOn > shown) {
                // Already came due unrecorded on `shown`; no later move or reset can erase it.
                return { dates: [shown] };
            }
            held = next;
        } else if (held !== null && next === null) {
            if (held < event.changedOn) {
                // Already came due on its recorded date before the reset; overlay history owns it.
                return null;
            }
            lastRemoval = { changedOn: event.changedOn, recordedDate: held };
            held = null;
        } else if (held !== null && next !== null) {
            if (held < event.changedOn && next !== held) {
                // Already came due on `held` before being moved later; overlay history owns it.
                return null;
            }
            held = next;
        }
    }

    if (held !== null) return null;

    const planDates = session.floating
        ? Array.from({ length: 7 }, (_, offset) => addDaysToLocalDateString(session.authoredDate, offset))
        : [session.authoredDate];
    if (lastRemoval === null) return { dates: planDates };
    const remaining = planDates.filter(date => date >= lastRemoval.changedOn);
    return { dates: remaining.length > 0 ? remaining : [lastRemoval.recordedDate] };
}

/** Sessions that came due without a recorded assignment, with the governed dates they may have been due on. */
function indexUnrecordedSessions(
    verifiedRevMap: ReadonlyMap<string, DEvalRawPlanRevision>,
    eventsByRev: ReadonlyMap<string, readonly PlacementEvent[]>,
    governingOn: PlanGovernance,
): Map<string, readonly string[]> {
    const unrecorded = new Map<string, readonly string[]>();
    for (const [revKey, rev] of verifiedRevMap) {
        for (const session of rev.sessions) {
            const due = unrecordedDueDates(session, eventsByRev.get(revKey) ?? []);
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

        const hasUndatedOverlay = events.length === 0 && (overlay?.assignments.length ?? 0) > 0;
        if (hasHistoryOrOverlayFailure) {
            knownLimits.push(`Placement or placement history for ${revKey} was truncated or unreadable.`);
        }
        if (hasUndatedOverlay) {
            knownLimits.push(`Placement overlay for ${revKey} has no dated placement history; historical assignments are unknown.`);
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

                // A future session replaced on or before its due date is counted once through its verified successor.
                if (assignment.status === 'superseded') {
                    const successor = findRecordedSuccessor(events, assignment.sessionId, date);
                    if (successor) {
                        const successorRevKey = revisionKey(planId, successor.revision);
                        const successorRev = planIndex.verifiedRevMap.get(successorRevKey);
                        const successorVerified = Boolean(
                            successorRev
                            && !planIndex.issueReasonsByRev.get(successorRevKey)?.has('unverified_revision')
                            && successorRev.sessions.some(item => item.id === successor.sessionId),
                        );
                        if (successorVerified) {
                            seenSessionKeys.add(key);
                            continue;
                        }
                        knownLimits.push(
                            `Superseded assignment ${key} points to unverified or missing successor ${successorRevKey}:${successor.sessionId}; kept as unknown.`,
                        );
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
                    && !hasUndatedOverlay
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
