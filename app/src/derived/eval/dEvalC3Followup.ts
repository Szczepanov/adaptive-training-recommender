import type {
    DailySubjectiveCheckin,
    InjuryConstraint,
    RegionTissueResponse,
    TissueResponseLevel,
} from '../../ledger/models.ts';
import { hasRecordedRedFlag } from '../../ledger/redFlagPause.ts';
import { getLocalDateString } from '../../utils/localDate.ts';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome.ts';
import {
    DEVAL_ADVERSE_WINDOW_HOURS,
    isLocalCalendarDate,
    parseUtcTimestampMs,
} from './dEvalCriteria.ts';

export type DEvalSessionIntensity = 'recovery' | 'easy' | 'moderate' | 'hard' | 'max';

export interface DEvalC3PerformedSessionInput {
    sessionId: string;
    performedDate: string;
    performedAt?: string | null;
    performedIntensity?: DEvalSessionIntensity | null;
    authoredIntensity?: DEvalSessionIntensity | null;
    reducedIntensity?: DEvalSessionIntensity | null;
    executedDefinition?: 'authored' | 'reduced' | null;
}

export interface DEvalC3InjuryInput {
    id?: string;
    region?: InjuryConstraint['region'];
    severity: InjuryConstraint['severity'];
    since?: string | null;
    createdAt?: string | null;
}

export interface DEvalC3AdverseOutcome {
    source: 'daily_subjective_checkin' | 'injury_constraint' | 'health_anomaly_outcome';
    date: string;
    timestamp: string | null;
    sessionId: string;
    sessionDate: string;
    reason: string;
}

export interface SessionWindowContext {
    session: DEvalC3PerformedSessionInput;
    sessionMs: number | null;
    conservativeEndDate: string;
}

export const ADVERSE_WINDOW_MS = DEVAL_ADVERSE_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Attribution timestamp of a check-in: when it was submitted, falling back to its last update and
 * then its creation. Some writers (e.g. tissue follow-ups) can add adverse fields to an already
 * submitted check-in, and writes are not versioned. So a check-in whose later `updatedAt` falls in a
 * session's window while its attribution time does not is reported as incomplete follow-up, and
 * one updated after the as-of cutoff is excluded as unknown at the cutoff (see `dEvalC3.ts`).
 */
export function checkinAttributionMs(checkin: DailySubjectiveCheckin): number | null {
    return parseUtcTimestampMs(checkin.submittedAt)
        ?? parseUtcTimestampMs(checkin.updatedAt)
        ?? parseUtcTimestampMs(checkin.createdAt);
}

/** Attribution onset of an injury constraint: `since`, falling back to `createdAt`. */
export function injuryOnset(injury: DEvalC3InjuryInput): string | null {
    return injury.since ?? injury.createdAt ?? null;
}

/**
 * When an injury constraint became known: `createdAt`, falling back to `since`. Used for the
 * as-of cutoff, so a `since` backdated after the cutoff cannot pull a later record in.
 */
export function injuryRecordedAt(injury: DEvalC3InjuryInput): string | null {
    return injury.createdAt ?? injury.since ?? null;
}

/**
 * Attribution timestamp of an illness outcome: `createdAt`, when the outcome was first recorded.
 * `updatedAt` never establishes attribution, so a note-only edit cannot move an existing record
 * into a session's adverse window. Because the record is editable (e.g. relabelled to
 * `illness_symptoms`) and edits are not versioned, an edit inside the window on a record created
 * outside it is ambiguous; it is reported as incomplete follow-up rather than as pass or fail.
 */
export function illnessOutcomeRecordedMs(outcome: HealthAnomalyEpisodeOutcome): number | null {
    return parseUtcTimestampMs(outcome.createdAt);
}

function isEditedAfterCreation(outcome: HealthAnomalyEpisodeOutcome): boolean {
    const createdMs = parseUtcTimestampMs(outcome.createdAt);
    const updatedMs = parseUtcTimestampMs(outcome.updatedAt);
    return updatedMs !== null && (createdMs === null || updatedMs > createdMs);
}

/**
 * Pure copy of `engine/injuryPolicy.ts` `deriveTissueSeverity`, retained here so `derived/`
 * never imports from `engine/` (ADR-0052). Parity is verified by `dEvalReadout.test.ts`.
 */
export function deriveTissueSeverity(response: RegionTissueResponse): InjuryConstraint['severity'] | null {
    const { morningState, painDuringTraining, afterTrainingState, nextMorningReaction } = response;
    const levels = [morningState, painDuringTraining, afterTrainingState, nextMorningReaction]
        .filter((level): level is TissueResponseLevel => level !== undefined);
    if (levels.length === 0) return null;
    if (levels.some(level => level === 'severe')) return 'exclude';
    if (morningState === 'moderate' || afterTrainingState === 'moderate' || nextMorningReaction === 'moderate') return 'limit';
    if (painDuringTraining === 'moderate') {
        const settled = (level: TissueResponseLevel | undefined): boolean => level === 'normal' || level === 'mild';
        return settled(afterTrainingState) && settled(nextMorningReaction) ? 'monitor' : 'limit';
    }
    return levels.some(level => level === 'mild') ? 'monitor' : null;
}

function isAdverseCheckin(checkin: DailySubjectiveCheckin): string | null {
    const reasons: string[] = [];
    if (checkin.illnessSymptoms === true) reasons.push('illnessSymptoms');
    if (checkin.painOrInjury === true) reasons.push('painOrInjury');
    if (hasRecordedRedFlag(checkin)) reasons.push('redFlags');
    const escalated = Object.values(checkin.tissueResponses ?? {}).some(resp => {
        if (!resp) return false;
        const severity = deriveTissueSeverity(resp);
        return severity === 'limit' || severity === 'exclude';
    });
    if (escalated) reasons.push('tissueResponses');
    return reasons.length > 0 ? reasons.join('+') : null;
}

export function collectCheckinOutcomes(
    ctx: SessionWindowContext,
    checkins: readonly DailySubjectiveCheckin[],
    adverse: DEvalC3AdverseOutcome[],
    incomplete: string[],
): boolean {
    let usedFallback = false;
    for (const checkin of checkins) {
        const checkinMs = checkinAttributionMs(checkin);
        let inWindow: boolean;
        if (ctx.sessionMs !== null && checkinMs !== null) {
            inWindow = checkinMs >= ctx.sessionMs && checkinMs <= ctx.sessionMs + ADVERSE_WINDOW_MS;
        } else {
            usedFallback = true;
            const sessionLinked = Object.values(checkin.tissueResponses ?? {}).some(r => r?.sourceSessionRef?.id === ctx.session.sessionId);
            inWindow = isLocalCalendarDate(checkin.date) && (
                (checkin.date > ctx.session.performedDate && checkin.date <= ctx.conservativeEndDate)
                || (checkin.date === ctx.session.performedDate && sessionLinked)
            );
        }
        if (!inWindow) {
            const updatedMs = parseUtcTimestampMs(checkin.updatedAt);
            if (
                ctx.sessionMs !== null
                && checkinMs !== null
                && updatedMs !== null
                && updatedMs > checkinMs
                && updatedMs >= ctx.sessionMs
                && updatedMs <= ctx.sessionMs + ADVERSE_WINDOW_MS
                && isAdverseCheckin(checkin)
            ) {
                // Its adverse fields may have been written inside the window; edits are not versioned.
                incomplete.push(`checkin_edited_in_window:${checkin.date}`);
            }
            continue;
        }
        const reason = isAdverseCheckin(checkin);
        if (reason) {
            adverse.push({
                source: 'daily_subjective_checkin',
                date: checkin.date,
                timestamp: checkinMs !== null ? new Date(checkinMs).toISOString() : null,
                sessionId: ctx.session.sessionId,
                sessionDate: ctx.session.performedDate,
                reason,
            });
        } else if (
            checkin.dataQuality?.missingFields?.includes('illnessSymptoms')
            || checkin.dataQuality?.missingFields?.includes('painOrInjury')
        ) {
            incomplete.push(`incomplete_checkin:${checkin.date}`);
        }
    }
    return usedFallback;
}

export function collectInjuryOutcomes(
    ctx: SessionWindowContext,
    injuries: readonly DEvalC3InjuryInput[],
    adverse: DEvalC3AdverseOutcome[],
): { usedFallback: boolean; matchedSameDayDateOnly: boolean } {
    let usedFallback = false;
    let matchedSameDayDateOnly = false;
    for (const injury of injuries) {
        const onset = injuryOnset(injury);
        if (!onset) continue;
        const onsetMs = parseUtcTimestampMs(onset);
        let inWindow = false;
        // A timestamped onset still yields a Warsaw calendar date for the date-only fallback.
        const onsetDate = onsetMs !== null
            ? getLocalDateString(new Date(onsetMs))
            : isLocalCalendarDate(onset) ? onset : null;
        if (ctx.sessionMs !== null && onsetMs !== null) {
            inWindow = onsetMs >= ctx.sessionMs && onsetMs <= ctx.sessionMs + ADVERSE_WINDOW_MS;
        } else if (onsetDate !== null) {
            usedFallback = true;
            inWindow = onsetDate >= ctx.session.performedDate && onsetDate <= ctx.conservativeEndDate;
            if (inWindow && onsetDate === ctx.session.performedDate) {
                matchedSameDayDateOnly = true;
            }
        }
        if (inWindow) {
            adverse.push({
                source: 'injury_constraint',
                date: onsetDate ?? onset,
                timestamp: onsetMs !== null ? onset : null,
                sessionId: ctx.session.sessionId,
                sessionDate: ctx.session.performedDate,
                reason: injury.region ? `new_injury:${injury.region}:${injury.severity}` : `new_injury:${injury.severity}`,
            });
        }
    }
    return { usedFallback, matchedSameDayDateOnly };
}

function isInSessionWindow(ctx: SessionWindowContext, ms: number | null, date: string | null): boolean {
    if (ctx.sessionMs !== null && ms !== null) {
        return ms >= ctx.sessionMs && ms <= ctx.sessionMs + ADVERSE_WINDOW_MS;
    }
    const localDate = ms !== null ? getLocalDateString(new Date(ms)) : date;
    return localDate !== null && isLocalCalendarDate(localDate)
        && localDate >= ctx.session.performedDate && localDate <= ctx.conservativeEndDate;
}

export function collectIllnessOutcomeRecords(
    ctx: SessionWindowContext,
    outcomes: readonly HealthAnomalyEpisodeOutcome[],
    adverse: DEvalC3AdverseOutcome[],
    incomplete: string[],
): boolean {
    let usedFallback = false;
    for (const outcome of outcomes) {
        const isIllness = outcome.explanation === 'illness_symptoms' || outcome.respiratoryTest?.result === 'positive';
        if (!isIllness) continue;
        const onsetDate = outcome.symptomOnset?.date ?? null;
        const recordedMs = illnessOutcomeRecordedMs(outcome);
        let inWindow = false;
        let recordDate = outcome.sourceAssessment.date;
        if (onsetDate !== null && isLocalCalendarDate(onsetDate)) {
            // A labelled symptom onset dates the illness itself, whenever the record was created or edited.
            if (ctx.sessionMs !== null) usedFallback = true;
            inWindow = onsetDate >= ctx.session.performedDate && onsetDate <= ctx.conservativeEndDate;
            recordDate = onsetDate;
        } else if (ctx.sessionMs !== null && recordedMs !== null) {
            inWindow = recordedMs >= ctx.sessionMs && recordedMs <= ctx.sessionMs + ADVERSE_WINDOW_MS;
            recordDate = getLocalDateString(new Date(recordedMs));
        } else {
            const fallbackDate = recordedMs !== null
                ? getLocalDateString(new Date(recordedMs))
                : isLocalCalendarDate(outcome.createdAt) ? outcome.createdAt : null;
            if (fallbackDate) {
                usedFallback = true;
                recordDate = fallbackDate;
                inWindow = fallbackDate >= ctx.session.performedDate && fallbackDate <= ctx.conservativeEndDate;
            }
        }
        if (
            !inWindow
            && (onsetDate === null || !isLocalCalendarDate(onsetDate))
            && isEditedAfterCreation(outcome)
            && isInSessionWindow(ctx, parseUtcTimestampMs(outcome.updatedAt), null)
        ) {
            // Possibly relabelled to illness inside the window; edits are not versioned.
            incomplete.push(`illness_outcome_edited_in_window:${outcome.episodeId}`);
        }
        if (inWindow) {
            adverse.push({
                source: 'health_anomaly_outcome',
                date: recordDate,
                timestamp: recordedMs !== null ? outcome.createdAt : null,
                sessionId: ctx.session.sessionId,
                sessionDate: ctx.session.performedDate,
                reason: outcome.respiratoryTest?.result === 'positive'
                    ? 'illness_positive_respiratory_test'
                    : 'illness_symptoms_outcome',
            });
        }
    }
    return usedFallback;
}
