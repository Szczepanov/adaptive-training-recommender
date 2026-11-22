import type { LedgerFlagId, LedgerState } from '../../ledger/export/schema.ts';
import type { DailySubjectiveCheckin } from '../../ledger/models.ts';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate.ts';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome.ts';
import {
    ADVERSE_WINDOW_MS,
    collectCheckinOutcomes,
    collectIllnessOutcomeRecords,
    collectInjuryOutcomes,
    deriveTissueSeverity,
    type DEvalC3AdverseOutcome,
    type DEvalC3InjuryInput,
    type DEvalC3PerformedSessionInput,
    type DEvalSessionIntensity,
    type SessionWindowContext,
} from './dEvalC3Followup.ts';
import {
    DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE,
    isLocalCalendarDate,
    parseUtcTimestampMs,
    type DEvalCriterionStatus,
} from './dEvalCriteria.ts';

export { deriveTissueSeverity };
export type {
    DEvalC3AdverseOutcome,
    DEvalC3InjuryInput,
    DEvalC3PerformedSessionInput,
    DEvalSessionIntensity,
};

export interface DEvalC3FlagRecord {
    id: LedgerFlagId;
    observedOn: string;
    active: boolean | null;
    state: LedgerState;
    sessionRef?: string;
    inputs?: readonly { name: string; value: { state: LedgerState } }[];
}

export interface DEvalC3FlagSourceState {
    date: string;
    state: LedgerState;
    source?: string;
}

export interface DEvalC3Input {
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    flags: readonly DEvalC3FlagRecord[];
    flagSourceStates?: readonly DEvalC3FlagSourceState[];
    performedSessions: readonly DEvalC3PerformedSessionInput[];
    checkins?: readonly DailySubjectiveCheckin[];
    injuries?: readonly DEvalC3InjuryInput[];
    healthAnomalyOutcomes?: readonly HealthAnomalyEpisodeOutcome[];
    flagSourcesComplete?: boolean;
    followUpSourcesComplete?: boolean;
    followUpSourceStates?: {
        checkins?: LedgerState;
        injuries?: LedgerState;
        healthAnomalyOutcomes?: LedgerState;
    };
}

export interface DEvalC3Result {
    status: DEvalCriterionStatus;
    flaggedHardSessions: readonly {
        sessionId: string;
        performedDate: string;
        performedAt: string | null;
        activeFlagIds: readonly LedgerFlagId[];
        windowClosed: boolean;
    }[];
    flaggedHardDays: readonly string[];
    adverseOutcomes: readonly DEvalC3AdverseOutcome[];
    blindFlagDates: readonly string[];
    lastFollowUpWindowClosedAt: string | null;
    openWindowSessionIds: readonly string[];
    incompleteFollowUps: readonly string[];
    reasons: readonly string[];
    knownLimits: readonly string[];
}

const BLIND_STATES: ReadonlySet<LedgerState> = new Set(['missing', 'unavailable', 'invalid']);

function resolveSessionIntensity(session: DEvalC3PerformedSessionInput): DEvalSessionIntensity | null {
    if (session.performedIntensity !== null && session.performedIntensity !== undefined) return session.performedIntensity;
    if (session.executedDefinition === 'reduced') return session.reducedIntensity ?? null;
    return session.authoredIntensity ?? null;
}

function maxLocalDate(current: string | null, candidate: string): string {
    return current === null || candidate > current ? candidate : current;
}

function resolveLastCloseLabel(latestCloseMs: number | null, latestCloseDateOnly: string | null): string | null {
    if (latestCloseDateOnly !== null) {
        const msDate = latestCloseMs !== null ? getLocalDateString(new Date(latestCloseMs)) : null;
        if (msDate === null || latestCloseDateOnly >= msDate) {
            return `${latestCloseDateOnly} (Warsaw end-of-day)`;
        }
    }
    return latestCloseMs !== null ? new Date(latestCloseMs).toISOString() : null;
}

/** Evaluates ADR-0052 D-EVAL Criterion C3 (adverse flagged-day outcomes and OD8/OD9 blind-date gate). */
export function evaluateC3FlaggedOutcomes(input: DEvalC3Input): DEvalC3Result {
    if (
        !isLocalCalendarDate(input.blockStartDate)
        || !isLocalCalendarDate(input.blockEndDate)
        || !isLocalCalendarDate(input.asOfDate)
        || input.blockStartDate > input.blockEndDate
    ) {
        return {
            status: 'inconclusive',
            flaggedHardSessions: [],
            flaggedHardDays: [],
            adverseOutcomes: [],
            blindFlagDates: [],
            lastFollowUpWindowClosedAt: null,
            openWindowSessionIds: [],
            incompleteFollowUps: ['invalid_dates'],
            reasons: ['invalid_block_or_as_of_dates'],
            knownLimits: [],
        };
    }

    const inBlock = (date: string): boolean =>
        isLocalCalendarDate(date) && date >= input.blockStartDate && date <= input.blockEndDate;
    const blindDatesSet = new Set<string>();
    const activeFlagsByDate = new Map<string, Set<LedgerFlagId>>();

    for (const flag of input.flags) {
        if (!inBlock(flag.observedOn)) continue;
        const isBlindFlag = BLIND_STATES.has(flag.state)
            || (flag.active === null && (flag.state === 'stale' || flag.state === 'not_recorded'));
        const hasBlindInput = flag.active !== true
            && (flag.inputs ?? []).some(entry => BLIND_STATES.has(entry.value.state) || entry.value.state === 'stale');
        if (isBlindFlag || hasBlindInput) blindDatesSet.add(flag.observedOn);
        if (flag.active === true) {
            const set = activeFlagsByDate.get(flag.observedOn) ?? new Set<LedgerFlagId>();
            set.add(flag.id);
            activeFlagsByDate.set(flag.observedOn, set);
        }
    }
    for (const entry of input.flagSourceStates ?? []) {
        if (inBlock(entry.date) && (BLIND_STATES.has(entry.state) || entry.state === 'stale' || entry.state === 'not_recorded')) {
            blindDatesSet.add(entry.date);
        }
    }

    const blindFlagDates = [...blindDatesSet].sort();
    const asOfMs = parseUtcTimestampMs(input.asOfTimestamp);
    const incompleteFollowUps: string[] = [];
    if (input.flagSourcesComplete === false) incompleteFollowUps.push('flag_sources_incomplete');
    if (input.followUpSourcesComplete === false) incompleteFollowUps.push('follow_up_sources_incomplete');
    for (const [name, state] of Object.entries(input.followUpSourceStates ?? {})) {
        if (state && BLIND_STATES.has(state)) incompleteFollowUps.push(`source_${name}_${state}`);
    }

    const checkins = input.checkins ?? [];
    const injuries = input.injuries ?? [];
    const outcomes = input.healthAnomalyOutcomes ?? [];
    let usedCalendarDateFallback = false;
    let matchedSameDayDateOnlyInjury = false;
    const flaggedHardSessions: DEvalC3Result['flaggedHardSessions'][number][] = [];
    const adverseOutcomes: DEvalC3AdverseOutcome[] = [];
    const openWindowSessionIds: string[] = [];
    let latestCloseMs: number | null = null;
    let latestCloseDateOnly: string | null = null;

    for (const session of input.performedSessions) {
        if (!inBlock(session.performedDate)) continue;
        const activeIds = activeFlagsByDate.get(session.performedDate);
        if (!activeIds || activeIds.size === 0) continue;

        const intensity = resolveSessionIntensity(session);
        if (intensity === null) {
            incompleteFollowUps.push(`unknown_intensity:${session.sessionId}`);
            continue;
        }
        if (intensity !== 'hard' && intensity !== 'max') continue;

        const sessionMs = parseUtcTimestampMs(session.performedAt);
        const conservativeEndDate = addDaysToLocalDateString(session.performedDate, 3);
        let windowClosed: boolean;
        if (sessionMs !== null) {
            const closeMs = sessionMs + ADVERSE_WINDOW_MS;
            latestCloseMs = latestCloseMs === null ? closeMs : Math.max(latestCloseMs, closeMs);
            windowClosed = asOfMs !== null
                ? asOfMs >= closeMs
                : input.asOfDate > getLocalDateString(new Date(closeMs));
        } else {
            usedCalendarDateFallback = true;
            latestCloseDateOnly = maxLocalDate(latestCloseDateOnly, conservativeEndDate);
            windowClosed = input.asOfDate > conservativeEndDate;
        }
        if (!windowClosed) openWindowSessionIds.push(session.sessionId);

        flaggedHardSessions.push({
            sessionId: session.sessionId,
            performedDate: session.performedDate,
            performedAt: session.performedAt ?? null,
            activeFlagIds: [...activeIds].sort(),
            windowClosed,
        });

        const ctx: SessionWindowContext = { session, sessionMs, conservativeEndDate };
        if (collectCheckinOutcomes(ctx, checkins, adverseOutcomes, incompleteFollowUps)) usedCalendarDateFallback = true;
        const injuryOutcome = collectInjuryOutcomes(ctx, injuries, adverseOutcomes);
        if (injuryOutcome.usedFallback) usedCalendarDateFallback = true;
        if (injuryOutcome.matchedSameDayDateOnly) matchedSameDayDateOnlyInjury = true;
        if (collectIllnessOutcomeRecords(ctx, outcomes, adverseOutcomes)) usedCalendarDateFallback = true;
    }

    const knownLimits: string[] = [];
    if (usedCalendarDateFallback) {
        knownLimits.push('Missing elapsed timestamps fell back conservatively to the next 3 Warsaw calendar dates for 72h C3 attribution.');
    }
    if (matchedSameDayDateOnlyInjury) {
        knownLimits.push('Date-only same-day injury onset (`since`) cannot prove post-vs-pre-session order against a same-day flagged hard session.');
    }
    if (injuries.some(injury => !(injury.since ?? injury.createdAt))) {
        knownLimits.push('Legacy injury constraints without recorded creation dates (`since`) remained unattributed in C3.');
    }

    const reasons: string[] = [];
    let status: DEvalCriterionStatus;
    if (adverseOutcomes.length > 0) {
        status = 'fail';
        reasons.push('adverse_flagged_day_outcome_observed');
    } else if (
        openWindowSessionIds.length > 0
        || incompleteFollowUps.length > 0
        || blindFlagDates.length >= DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE
    ) {
        status = 'inconclusive';
        if (openWindowSessionIds.length > 0) reasons.push('followup_72h_window_still_open');
        if (incompleteFollowUps.length > 0) reasons.push('followup_evidence_incomplete');
        if (blindFlagDates.length >= DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE) reasons.push('blind_flag_dates_exceeded_od8');
    } else {
        status = 'pass';
        reasons.push('zero_adverse_flagged_day_outcomes');
    }

    return {
        status,
        flaggedHardSessions,
        flaggedHardDays: [...new Set(flaggedHardSessions.map(session => session.performedDate))].sort(),
        adverseOutcomes,
        blindFlagDates,
        lastFollowUpWindowClosedAt: resolveLastCloseLabel(latestCloseMs, latestCloseDateOnly),
        openWindowSessionIds,
        incompleteFollowUps: [...new Set(incompleteFollowUps)],
        reasons,
        knownLimits,
    };
}
