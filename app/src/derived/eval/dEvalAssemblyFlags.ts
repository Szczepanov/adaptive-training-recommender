/** D-FLAGS and red-flag date lookups for the D-EVAL assembler. Pure. */

import { LEDGER_FLAG_IDS, type LedgerState } from '../../ledger/export/schema.ts';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation.ts';
import type { DailySubjectiveCheckin } from '../../ledger/models.ts';
import { hasRecordedRedFlag } from '../../ledger/redFlagPause.ts';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate.ts';
import type { DEvalC3FlagRecord, DEvalC3FlagSourceState } from './dEvalC3.ts';
import { isLocalCalendarDate, parseUtcTimestampMs } from './dEvalCriteria.ts';
import type { DEvalSourceReadState } from './dEvalRawLedger.ts';

const BLIND_FLAG_STATES: ReadonlySet<LedgerState> = new Set(['missing', 'unavailable', 'invalid']);

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
 *
 * An earlier `active: true` capture is kept alongside a later one that cleared it: the criteria ask
 * whether any flag was active on the date, and the flag was shown before it was cleared.
 */
export function deduplicateCapturedFlags(
    flags: readonly PersistedFlagEvaluation[],
    asOfDate: string,
    asOfMs: number | null,
): PersistedFlagEvaluation[] {
    const latestByKey = new Map<string, PersistedFlagEvaluation>();
    const latestActiveByKey = new Map<string, PersistedFlagEvaluation>();
    for (const flag of flags) {
        if (!isLocalCalendarDate(flag.observedOn) || flag.observedOn > asOfDate) continue;
        const evalMs = parseUtcTimestampMs(flag.evaluatedAt);
        if (evalMs === null) continue;
        if (asOfMs !== null) {
            if (evalMs > asOfMs) continue;
        } else if (getLocalDateString(new Date(evalMs)) > asOfDate) {
            continue;
        }
        const key = `${flag.observedOn}::${flag.id}::${flag.sessionRef ?? ''}`;
        const prev = latestByKey.get(key);
        if (!prev || compareFlagRevision(flag, prev) > 0) {
            latestByKey.set(key, flag);
        }
        const prevActive = latestActiveByKey.get(key);
        if (flag.active === true && (!prevActive || compareFlagRevision(flag, prevActive) > 0)) {
            latestActiveByKey.set(key, flag);
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

    const result: PersistedFlagEvaluation[] = [...latestActiveByKey]
        .filter(([key]) => latestByKey.get(key)?.active !== true)
        .map(([, flag]) => flag);
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

export function buildFlagLookup(
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

function checkinTimestampRelation(
    iso: string | undefined,
    asOfDate: string,
    asOfMs: number | null,
): 'none' | 'known' | 'after' | 'invalid' {
    if (iso === undefined || iso === null || iso === '') return 'none';
    const ms = parseUtcTimestampMs(iso);
    if (ms === null) return 'invalid';
    if (asOfMs !== null) return ms <= asOfMs ? 'known' : 'after';
    return getLocalDateString(new Date(ms)) <= asOfDate ? 'known' : 'after';
}

export function buildRedFlagLookup(
    checkins: readonly DailySubjectiveCheckin[],
    checkinsState: DEvalSourceReadState,
    asOfDate: string,
    asOfMs: number | null,
): (date: string) => boolean | null {
    const byDate = new Map<string, DailySubjectiveCheckin>();
    const unknownDates = new Set<string>();
    for (const checkin of checkins) {
        if (!isLocalCalendarDate(checkin.date) || checkin.date > asOfDate) continue;
        const createdRel = checkinTimestampRelation(checkin.createdAt, asOfDate, asOfMs);
        const submittedRel = checkinTimestampRelation(checkin.submittedAt, asOfDate, asOfMs);
        const updatedRel = checkinTimestampRelation(checkin.updatedAt, asOfDate, asOfMs);
        if (createdRel === 'invalid' || submittedRel === 'invalid' || updatedRel === 'invalid') {
            unknownDates.add(checkin.date);
            continue;
        }
        if (createdRel === 'after' || (createdRel === 'none' && submittedRel === 'after')) {
            continue;
        }
        if (updatedRel === 'after' || submittedRel === 'after') {
            unknownDates.add(checkin.date);
            continue;
        }
        if (asOfMs !== null && createdRel === 'none' && submittedRel === 'none' && updatedRel === 'none' && checkin.date === asOfDate) {
            unknownDates.add(checkin.date);
            continue;
        }
        byDate.set(checkin.date, checkin);
    }

    return (date: string): boolean | null => {
        if (unknownDates.has(date)) return null;
        const checkin = byDate.get(date);
        if (checkin && hasRecordedRedFlag(checkin)) return true;
        if (checkinsState === 'unavailable' || checkinsState === 'invalid') return null;
        return false;
    };
}
