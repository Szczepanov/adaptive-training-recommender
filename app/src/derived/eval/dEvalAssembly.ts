/**
 * Pure D-EVAL ledger-to-criteria assembler (`docs/analysis/2026-10-25-adr-0052-d-eval-criteria.md`).
 *
 * Zero IO, zero clock, zero `app/src/engine/` imports (verified by `derived.architecture.test.ts`).
 * Converts already-read, hash-verified ledger records into `DEvalBlockInput` for
 * `evaluateDEvalBlock` / `renderDEvalResultMarkdown`.
 */

import { LEDGER_FLAG_IDS, type LedgerState } from '../../ledger/export/schema.ts';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation.ts';
import type {
    ActivityOverride,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
} from '../../ledger/models.ts';
import {
    hasRecordedPrevious,
    placementAsOf,
    placementBeforeHistory,
    type PlacementAssignment,
    type PlacementEvent,
} from '../../ledger/placementHistory.ts';
import { hasRecordedRedFlag } from '../../ledger/redFlagPause.ts';
import type { AssessmentAttempt } from '../../observations/models.ts';
import type { CurrentObservation } from '../../observations/progress.ts';
import {
    isProviderActivityRef,
    isStructuredExecutionRef,
    type PerformedTrainingOccurrence,
} from '../../training-occurrence/models.ts';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate.ts';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome.ts';
import type { DEvalC1BlockInput, DEvalC1PlannedSessionInput } from './dEvalC1.ts';
import type {
    DEvalC3FlagRecord,
    DEvalC3FlagSourceState,
    DEvalC3InjuryInput,
    DEvalC3PerformedSessionInput,
    DEvalSessionIntensity,
} from './dEvalC3.ts';
import { DEVAL_MIN_BLOCK_DAYS, isLocalCalendarDate, parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalBlockInput, DEvalRollbackUsage } from './dEvalReadout.ts';

export type DEvalSourceReadState = 'measured' | 'missing' | 'unavailable' | 'invalid';

export interface DEvalRawPlanSession {
    id: string;
    gating?: { intensity?: DEvalSessionIntensity };
    scaling?: { reducible?: boolean };
}

export interface DEvalRawPlanRevision {
    planId: string;
    revision: number;
    contentHash: string;
    importedAt: string;
    sessions: readonly DEvalRawPlanSession[];
}

export interface DEvalRawPlacementOverlay {
    planId: string;
    revision: number;
    updatedAt?: string;
    assignments: readonly PlacementAssignment[];
    successors?: Record<string, { revision: number; sessionId: string }>;
}

export interface DEvalRawExecution {
    executionId: string;
    state: 'in_progress' | 'completed' | 'abandoned';
    date: string;
    startedAt: string;
    completedAt?: string | null;
    executedDefinition?: 'authored' | 'reduced';
    completionEvidence?: { completedFraction?: number };
    sessionSource: {
        kind: string;
        planId?: string;
        revision?: number;
        sessionId?: string;
        contentHash?: string;
    };
}

export interface DEvalRawResponse {
    responseId: string;
    window: 'immediate' | 'later_day' | 'next_morning';
    date: string;
    sourceSession: { kind: string; id: string; date: string };
    completedFraction?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface DEvalRawPlanIssue {
    planId: string;
    revision?: number;
    reason:
        | 'unverified_revision'
        | 'history_truncated'
        | 'history_invalid'
        | 'history_unavailable'
        | 'placement_invalid'
        | 'placement_unavailable';
}

export interface DEvalRawLedgerData {
    externalPlansState: DEvalSourceReadState;
    planRevisions: readonly DEvalRawPlanRevision[];
    placements: readonly DEvalRawPlacementOverlay[];
    placementHistory: readonly PlacementEvent[];
    planIssues?: readonly DEvalRawPlanIssue[];

    occurrencesState: DEvalSourceReadState;
    performedOccurrences: readonly PerformedTrainingOccurrence[];
    executionsState: DEvalSourceReadState;
    executions: readonly DEvalRawExecution[];
    responsesState: DEvalSourceReadState;
    responses: readonly DEvalRawResponse[];

    activitiesState?: DEvalSourceReadState;
    activities?: readonly NormalizedGarminActivity[];
    activityOverridesState?: DEvalSourceReadState;
    activityOverrides?: Readonly<Record<string, ActivityOverride>>;

    flagEvaluationsState: DEvalSourceReadState;
    flagEvaluations: readonly PersistedFlagEvaluation[];

    checkinsState: DEvalSourceReadState;
    checkins: readonly DailySubjectiveCheckin[];
    trainingSettingsState: DEvalSourceReadState;
    injuries: readonly DEvalC3InjuryInput[];
    healthAnomalyOutcomesState: DEvalSourceReadState;
    healthAnomalyOutcomes: readonly HealthAnomalyEpisodeOutcome[];

    observationsState: DEvalSourceReadState;
    observations: readonly CurrentObservation[];
    unreadableObservationsCount?: number;
    attemptsState: DEvalSourceReadState;
    attempts?: readonly AssessmentAttempt[];
    unreadableAttemptsCount?: number;
    attemptsTruncated?: boolean;

    preferencesState?: DEvalSourceReadState;
    engineRecommendationsEnabled?: boolean | null;
}

export interface DEvalAssemblyOptions {
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    includeBaseline?: boolean;
    criteriaCommit?: string | null;
    phase2Commit?: string | null;
    rollbackState: DEvalRollbackUsage;
    rollbackReason?: string | null;
    rollbackAtDate?: string | null;
}

const BLIND_FLAG_STATES: ReadonlySet<LedgerState> = new Set(['missing', 'unavailable', 'invalid']);
const VALID_SESSION_INTENSITIES: ReadonlySet<string> = new Set(['recovery', 'easy', 'moderate', 'hard', 'max']);
const RESPONSE_WINDOW_ORDER: Record<DEvalRawResponse['window'], number> = {
    immediate: 0,
    later_day: 1,
    next_morning: 2,
};

function compareFlagRevision(a: PersistedFlagEvaluation, b: PersistedFlagEvaluation): number {
    const aMs = parseUtcTimestampMs(a.evaluatedAt);
    const bMs = parseUtcTimestampMs(b.evaluatedAt);
    if (aMs !== null && bMs !== null && aMs !== bMs) return aMs - bMs;
    const atCmp = a.evaluatedAt.localeCompare(b.evaluatedAt);
    return atCmp !== 0 ? atCmp : a.revisionId.localeCompare(b.revisionId);
}

/**
 * Reduces persisted flag revisions up to the as-of cutoff to the latest revision per
 * `(observedOn, id, sessionRef)`. A pre-sync `injury_constraint_touches_session` capture without
 * `sessionRef` that is strictly older than later per-session captures on the same date is dropped
 * so transient initial failures do not mask subsequent same-day captures.
 */
function deduplicateCapturedFlags(
    flags: readonly PersistedFlagEvaluation[],
    asOfDate: string,
    asOfMs: number | null,
): PersistedFlagEvaluation[] {
    const latestByKey = new Map<string, PersistedFlagEvaluation>();
    for (const flag of flags) {
        if (!isLocalCalendarDate(flag.observedOn) || flag.observedOn > asOfDate) continue;
        if (asOfMs !== null) {
            const evalMs = parseUtcTimestampMs(flag.evaluatedAt);
            if (evalMs === null || evalMs > asOfMs) continue;
        }
        const key = `${flag.observedOn}::${flag.id}::${flag.sessionRef ?? ''}`;
        const prev = latestByKey.get(key);
        if (!prev || compareFlagRevision(flag, prev) > 0) {
            latestByKey.set(key, flag);
        }
    }

    const perDateSessionRecords = new Map<string, PersistedFlagEvaluation[]>();
    for (const flag of latestByKey.values()) {
        if (flag.id === 'injury_constraint_touches_session' && flag.sessionRef) {
            const list = perDateSessionRecords.get(flag.observedOn) ?? [];
            list.push(flag);
            perDateSessionRecords.set(flag.observedOn, list);
        }
    }

    const result: PersistedFlagEvaluation[] = [];
    for (const flag of latestByKey.values()) {
        if (flag.id === 'injury_constraint_touches_session' && !flag.sessionRef) {
            const sessionRecords = perDateSessionRecords.get(flag.observedOn) ?? [];
            if (
                sessionRecords.length > 0
                && sessionRecords.every(other => compareFlagRevision(other, flag) > 0)
            ) {
                continue;
            }
        }
        result.push(flag);
    }

    return result.sort((a, b) =>
        a.observedOn.localeCompare(b.observedOn)
        || a.id.localeCompare(b.id)
        || (a.sessionRef ?? '').localeCompare(b.sessionRef ?? ''),
    );
}

function isFlagRecordBlind(flag: PersistedFlagEvaluation): boolean {
    if (BLIND_FLAG_STATES.has(flag.state)) return true;
    if (flag.active === null && (flag.state === 'stale' || flag.state === 'not_recorded')) return true;
    return flag.active !== true
        && flag.inputs.some(input => BLIND_FLAG_STATES.has(input.value.state) || input.value.state === 'stale');
}

function buildFlagLookup(
    flags: readonly PersistedFlagEvaluation[],
    flagReadState: DEvalSourceReadState,
    rangeStart: string,
    rangeEnd: string,
): {
    c3Flags: DEvalC3FlagRecord[];
    c3SourceStates: DEvalC3FlagSourceState[];
    activeFlagOnDate: (date: string) => boolean | null;
} {
    const byDate = new Map<string, PersistedFlagEvaluation[]>();
    for (const flag of flags) {
        const list = byDate.get(flag.observedOn) ?? [];
        list.push(flag);
        byDate.set(flag.observedOn, list);
    }

    const c3Flags: DEvalC3FlagRecord[] = flags.map(flag => ({
        id: flag.id,
        observedOn: flag.observedOn,
        active: flag.active,
        state: flag.state,
        ...(flag.sessionRef ? { sessionRef: flag.sessionRef } : {}),
        inputs: flag.inputs.map(entry => ({ name: entry.name, value: { state: entry.value.state } })),
    }));

    const c3SourceStates: DEvalC3FlagSourceState[] = [];
    if (isLocalCalendarDate(rangeStart) && isLocalCalendarDate(rangeEnd) && rangeStart <= rangeEnd) {
        for (let date = rangeStart; date <= rangeEnd; date = addDaysToLocalDateString(date, 1)) {
            if (flagReadState === 'unavailable' || flagReadState === 'invalid') {
                c3SourceStates.push({ date, state: flagReadState, source: 'flag_evaluations' });
                continue;
            }
            const dayFlags = byDate.get(date) ?? [];
            const missingAnyId = LEDGER_FLAG_IDS.some(id => !dayFlags.some(flag => flag.id === id));
            if (missingAnyId) {
                c3SourceStates.push({ date, state: 'not_recorded', source: 'flag_evaluations' });
            }
        }
    }

    const activeFlagOnDate = (date: string): boolean | null => {
        const dayFlags = byDate.get(date) ?? [];
        if (dayFlags.some(flag => flag.active === true)) return true;
        if (flagReadState === 'unavailable' || flagReadState === 'invalid') return null;
        const hasAllIds = LEDGER_FLAG_IDS.every(id => dayFlags.some(flag => flag.id === id));
        if (!hasAllIds || dayFlags.some(isFlagRecordBlind)) return null;
        return false;
    };

    return { c3Flags, c3SourceStates, activeFlagOnDate };
}

function buildRedFlagLookup(
    checkins: readonly DailySubjectiveCheckin[],
    checkinsState: DEvalSourceReadState,
    asOfDate: string,
    asOfMs: number | null,
): (date: string) => boolean | null {
    const byDate = new Map<string, DailySubjectiveCheckin>();
    for (const checkin of checkins) {
        if (!isLocalCalendarDate(checkin.date) || checkin.date > asOfDate) continue;
        if (asOfMs !== null) {
            const subMs = parseUtcTimestampMs(checkin.submittedAt)
                ?? parseUtcTimestampMs(checkin.updatedAt)
                ?? parseUtcTimestampMs(checkin.createdAt);
            if (subMs !== null) {
                if (subMs > asOfMs) continue;
            } else if (checkin.date === asOfDate) {
                continue;
            }
        }
        byDate.set(checkin.date, checkin);
    }

    return (date: string): boolean | null => {
        const checkin = byDate.get(date);
        if (checkin && hasRecordedRedFlag(checkin)) return true;
        if (checkinsState === 'unavailable' || checkinsState === 'invalid') return null;
        return false;
    };
}

function occurrenceLocalDate(occ: PerformedTrainingOccurrence): string | null {
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

function revisionKey(planId: string, revision: number): string {
    return `${planId}@${revision}`;
}

function sessionKey(planId: string, revision: number, sessionId: string): string {
    return `${planId}@${revision}:${sessionId}`;
}

interface RevisionPlacementIndex {
    verifiedRevMap: Map<string, DEvalRawPlanRevision>;
    overlaysByRev: Map<string, DEvalRawPlacementOverlay>;
    eventsByRev: Map<string, PlacementEvent[]>;
    issueReasonsByRev: Map<string, Set<DEvalRawPlanIssue['reason']>>;
    issueReasonsByPlan: Map<string, Set<DEvalRawPlanIssue['reason']>>;
}

function indexPlans(raw: DEvalRawLedgerData): RevisionPlacementIndex {
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

    return { verifiedRevMap, overlaysByRev, eventsByRev, issueReasonsByRev, issueReasonsByPlan };
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

function buildExecutionAndLinkIndexes(
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
    const allLinkedOccurrencesBySessionKey = new Map<string, PerformedTrainingOccurrence>();

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
            if (!allLinkedOccurrencesBySessionKey.has(key)) {
                allLinkedOccurrencesBySessionKey.set(key, occ);
            }
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

function assembleC1Window(params: {
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
            const snapshot = snapshotOverlayOnDate(events, overlay, date);
            if (snapshot === null) continue;

            for (const assignment of snapshot) {
                if (assignment.date !== date) continue;
                const key = `${revKey}:${assignment.sessionId}`;
                if (seenSessionKeys.has(key)) continue;

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
                const evidenceComplete = baseReadsComplete
                    && !hasHistoryOrOverlayFailure
                    && !priorUnknownBeforeRepair
                    && !missingSuccessor
                    && !(events.length === 0 && overlay === undefined);

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

function normalizeIntensity(raw: string | undefined | null): DEvalSessionIntensity | null {
    if (!raw) return null;
    const lower = raw.trim().toLowerCase();
    return VALID_SESSION_INTENSITIES.has(lower) ? (lower as DEvalSessionIntensity) : null;
}

function buildC3PerformedSessions(params: {
    raw: DEvalRawLedgerData;
    planIndex: RevisionPlacementIndex;
    execById: ReadonlyMap<string, DEvalRawExecution>;
    blockStartDate: string;
    effectiveEnd: string;
    asOfMs: number | null;
}): DEvalC3PerformedSessionInput[] {
    const { raw, planIndex, execById, blockStartDate, effectiveEnd, asOfMs } = params;
    const activitiesById = new Map((raw.activities ?? []).map(act => [act.activityId, act]));
    const overridesByActivityId = raw.activityOverrides ?? {};

    const result: DEvalC3PerformedSessionInput[] = [];
    for (const occ of raw.performedOccurrences) {
        if (occ.status !== 'active') continue;
        const occDate = occurrenceLocalDate(occ);
        if (!occDate || occDate < blockStartDate || occDate > effectiveEnd) continue;
        if (asOfMs !== null && occ.startedAt) {
            const startedMs = parseUtcTimestampMs(occ.startedAt);
            if (startedMs !== null && startedMs > asOfMs) continue;
        }

        const structRef = occ.sourceRefs.find(isStructuredExecutionRef);
        const exec = structRef ? execById.get(structRef.executionId) : undefined;
        const src = exec?.sessionSource;

        let authoredIntensity: DEvalSessionIntensity | null = null;
        let performedIntensity: DEvalSessionIntensity | null = null;
        const executedDefinition = exec?.executedDefinition ?? null;

        if (src?.kind === 'external_plan' && src.planId && src.revision !== undefined && src.sessionId) {
            const rev = planIndex.verifiedRevMap.get(revisionKey(src.planId, src.revision));
            if (rev && src.contentHash && rev.contentHash === src.contentHash) {
                const planSession = rev.sessions.find(item => item.id === src.sessionId);
                authoredIntensity = normalizeIntensity(planSession?.gating?.intensity);
            }
        } else {
            // Unplanned occurrence: check athlete override intensity, then Garmin activity tag.
            const providerRefs = occ.sourceRefs.filter(isProviderActivityRef);
            for (const pRef of providerRefs) {
                const override = overridesByActivityId[pRef.activityId];
                const overrideIntensity = normalizeIntensity(override?.overriddenIntensity);
                if (overrideIntensity) {
                    performedIntensity = overrideIntensity;
                    break;
                }
                const activity = activitiesById.get(pRef.activityId);
                const activityIntensity = normalizeIntensity(activity?.intensityTag);
                if (activityIntensity) {
                    performedIntensity = activityIntensity;
                    break;
                }
            }
        }

        result.push({
            sessionId: occ.performedOccurrenceId,
            performedDate: occDate,
            performedAt: occ.startedAt ?? exec?.startedAt ?? null,
            executedDefinition,
            authoredIntensity,
            reducedIntensity: null,
            performedIntensity,
        });
    }

    return result.sort((a, b) =>
        a.performedDate.localeCompare(b.performedDate) || a.sessionId.localeCompare(b.sessionId));
}

function toC3SourceState(readState: DEvalSourceReadState): LedgerState {
    if (readState === 'measured' || readState === 'missing') return 'measured';
    return readState;
}

/**
 * Pure assembler translating raw user-ledger collections into `DEvalBlockInput` for
 * `evaluateDEvalBlock` and `renderDEvalResultMarkdown`.
 */
export function assembleDEvalBlockInput(
    raw: DEvalRawLedgerData,
    options: DEvalAssemblyOptions,
): DEvalBlockInput {
    const {
        blockStartDate,
        blockEndDate,
        asOfDate,
        asOfTimestamp = null,
        includeBaseline = true,
        criteriaCommit = null,
        phase2Commit = null,
        rollbackState,
        rollbackReason = null,
        rollbackAtDate = null,
    } = options;

    const asOfMs = parseUtcTimestampMs(asOfTimestamp);
    const extraKnownLimits: string[] = [];

    const validBlockDates = isLocalCalendarDate(blockStartDate)
        && isLocalCalendarDate(blockEndDate)
        && isLocalCalendarDate(asOfDate)
        && blockStartDate <= blockEndDate;

    const effectiveBlockEnd = validBlockDates
        ? (asOfDate < blockEndDate ? asOfDate : blockEndDate)
        : blockEndDate;

    if (validBlockDates && asOfDate <= blockEndDate) {
        extraKnownLimits.push(
            `Dry-run readout at as-of date ${asOfDate} (on or before block end ${blockEndDate}); `
            + 'pending or ±1-day sessions and open follow-up windows may still resolve.',
        );
    }

    const baselineStart = isLocalCalendarDate(blockStartDate)
        ? addDaysToLocalDateString(blockStartDate, -DEVAL_MIN_BLOCK_DAYS)
        : '';
    const baselineEnd = isLocalCalendarDate(blockStartDate)
        ? addDaysToLocalDateString(blockStartDate, -1)
        : '';

    const dedupedFlags = deduplicateCapturedFlags(raw.flagEvaluations, asOfDate, asOfMs);
    const { c3Flags, c3SourceStates, activeFlagOnDate } = buildFlagLookup(
        dedupedFlags,
        raw.flagEvaluationsState,
        blockStartDate,
        effectiveBlockEnd,
    );
    const redFlagOnDate = buildRedFlagLookup(raw.checkins, raw.checkinsState, asOfDate, asOfMs);

    const planIndex = indexPlans(raw);
    const { execById, execsBySession, unverifiedSessions, linksBySession } = buildExecutionAndLinkIndexes(
        raw,
        planIndex.verifiedRevMap,
        asOfDate,
        asOfMs,
    );

    const mainC1 = assembleC1Window({
        windowStart: blockStartDate,
        windowEnd: blockEndDate,
        effectiveEnd: effectiveBlockEnd,
        raw,
        planIndex,
        execsBySession,
        unverifiedSessions,
        linksBySession,
        activeFlagOnDate,
        redFlagOnDate,
        asOfDate,
        asOfMs,
    });
    extraKnownLimits.push(...mainC1.knownLimits);

    let baselineC1: DEvalC1BlockInput | null = null;
    if (includeBaseline && isLocalCalendarDate(baselineStart) && isLocalCalendarDate(baselineEnd) && asOfDate >= blockStartDate) {
        const baselineWindow = assembleC1Window({
            windowStart: baselineStart,
            windowEnd: baselineEnd,
            effectiveEnd: baselineEnd,
            raw,
            planIndex,
            execsBySession,
            unverifiedSessions,
            linksBySession,
            activeFlagOnDate,
            redFlagOnDate,
            asOfDate,
            asOfMs,
        });
        baselineC1 = baselineWindow.block;
    }

    const attemptsReliable = raw.attemptsState === 'measured'
        && (raw.unreadableAttemptsCount ?? 0) === 0
        && raw.attemptsTruncated !== true
        && raw.attempts !== undefined;
    if (!attemptsReliable) {
        extraKnownLimits.push('Assessment attempt records were unavailable, truncated, or contained unreadable rows; C2 cannot verify attempt completion.');
    }
    if (raw.observationsState !== 'measured' || (raw.unreadableObservationsCount ?? 0) > 0) {
        extraKnownLimits.push('Metric observations were unavailable or contained unreadable records.');
    }

    const performedSessions = buildC3PerformedSessions({
        raw,
        planIndex,
        execById,
        blockStartDate,
        effectiveEnd: effectiveBlockEnd,
        asOfMs,
    });

    const checkinsSourceState = toC3SourceState(raw.checkinsState);
    const injuriesSourceState = toC3SourceState(raw.trainingSettingsState);
    const outcomesSourceState = toC3SourceState(raw.healthAnomalyOutcomesState);
    const performedReadsOk = (raw.occurrencesState === 'measured' || raw.occurrencesState === 'missing')
        && (raw.executionsState === 'measured' || raw.executionsState === 'missing');
    if (!performedReadsOk) {
        extraKnownLimits.push('Performed occurrence or execution reads were incomplete; C3 flagged-day evaluation is marked incomplete.');
    }

    const flagSourcesComplete = raw.flagEvaluationsState === 'measured' || raw.flagEvaluationsState === 'missing';
    const followUpSourcesComplete = performedReadsOk
        && checkinsSourceState === 'measured'
        && injuriesSourceState === 'measured'
        && outcomesSourceState === 'measured';

    let rollbackSettingState: string;
    if (raw.preferencesState === 'measured' || raw.preferencesState === 'missing') {
        rollbackSettingState = raw.engineRecommendationsEnabled === true ? 'on (enabled)' : 'off';
        if (raw.engineRecommendationsEnabled === true && rollbackState === 'unused') {
            extraKnownLimits.push(
                'Preference `engineRecommendationsEnabled` is currently enabled while rollback state was reported as `unused`.',
            );
        }
    } else {
        rollbackSettingState = `unknown (${raw.preferencesState ?? 'unread'})`;
        extraKnownLimits.push('User preference `engineRecommendationsEnabled` could not be verified.');
    }

    return {
        blockStartDate,
        blockEndDate,
        asOfDate,
        asOfTimestamp,
        criteriaCommit,
        phase2Commit,
        rollbackSettingState,
        c1: {
            block: mainC1.block,
            baseline: baselineC1,
        },
        c2: {
            observations: raw.observations,
            attemptRecords: attemptsReliable ? raw.attempts : undefined,
            rollbackBeforeAfterAttempt: rollbackState !== 'unused',
            rollbackAtDate,
        },
        c3: {
            flags: c3Flags,
            flagSourceStates: c3SourceStates,
            performedSessions,
            checkins: raw.checkins,
            injuries: raw.injuries,
            healthAnomalyOutcomes: raw.healthAnomalyOutcomes,
            flagSourcesComplete,
            followUpSourcesComplete,
            followUpSourceStates: {
                checkins: checkinsSourceState,
                injuries: injuriesSourceState,
                healthAnomalyOutcomes: outcomesSourceState,
            },
        },
        c4: {
            rollbackState,
            reason: rollbackReason,
            rollbackAtDate,
        },
        extraKnownLimits: [...new Set(extraKnownLimits)],
    };
}
