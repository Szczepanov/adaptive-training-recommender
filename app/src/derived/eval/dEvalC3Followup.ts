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
        const checkinMs = parseUtcTimestampMs(checkin.submittedAt)
            ?? parseUtcTimestampMs(checkin.updatedAt)
            ?? parseUtcTimestampMs(checkin.createdAt);
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
        if (!inWindow) continue;
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
        const onset = injury.since ?? injury.createdAt ?? null;
        if (!onset) continue;
        const onsetMs = parseUtcTimestampMs(onset);
        let inWindow = false;
        let onsetDate = onset;
        if (ctx.sessionMs !== null && onsetMs !== null) {
            inWindow = onsetMs >= ctx.sessionMs && onsetMs <= ctx.sessionMs + ADVERSE_WINDOW_MS;
            onsetDate = getLocalDateString(new Date(onsetMs));
        } else if (isLocalCalendarDate(onset)) {
            usedFallback = true;
            inWindow = onset >= ctx.session.performedDate && onset <= ctx.conservativeEndDate;
            if (inWindow && onset === ctx.session.performedDate) {
                matchedSameDayDateOnly = true;
            }
        }
        if (inWindow) {
            adverse.push({
                source: 'injury_constraint',
                date: onsetDate,
                timestamp: onsetMs !== null ? onset : null,
                sessionId: ctx.session.sessionId,
                sessionDate: ctx.session.performedDate,
                reason: injury.region ? `new_injury:${injury.region}:${injury.severity}` : `new_injury:${injury.severity}`,
            });
        }
    }
    return { usedFallback, matchedSameDayDateOnly };
}

export function collectIllnessOutcomeRecords(
    ctx: SessionWindowContext,
    outcomes: readonly HealthAnomalyEpisodeOutcome[],
    adverse: DEvalC3AdverseOutcome[],
): boolean {
    let usedFallback = false;
    for (const outcome of outcomes) {
        const isIllness = outcome.explanation === 'illness_symptoms' || outcome.respiratoryTest?.result === 'positive';
        if (!isIllness) continue;
        const onsetDate = outcome.symptomOnset?.date ?? null;
        const updatedMs = parseUtcTimestampMs(outcome.updatedAt);
        let inWindow = false;
        let recordDate = outcome.sourceAssessment.date;
        if (onsetDate !== null && isLocalCalendarDate(onsetDate)) {
            const preSessionUpdate = ctx.sessionMs !== null && updatedMs !== null && updatedMs < ctx.sessionMs;
            if (!preSessionUpdate) {
                if (ctx.sessionMs !== null) usedFallback = true;
                inWindow = onsetDate >= ctx.session.performedDate && onsetDate <= ctx.conservativeEndDate;
                recordDate = onsetDate;
            }
        } else if (ctx.sessionMs !== null && updatedMs !== null) {
            inWindow = updatedMs >= ctx.sessionMs && updatedMs <= ctx.sessionMs + ADVERSE_WINDOW_MS;
            recordDate = getLocalDateString(new Date(updatedMs));
        } else {
            const fallbackDate = updatedMs !== null
                ? getLocalDateString(new Date(updatedMs))
                : isLocalCalendarDate(outcome.updatedAt) ? outcome.updatedAt : null;
            if (fallbackDate) {
                usedFallback = true;
                recordDate = fallbackDate;
                inWindow = fallbackDate >= ctx.session.performedDate && fallbackDate <= ctx.conservativeEndDate;
            }
        }
        if (inWindow) {
            adverse.push({
                source: 'health_anomaly_outcome',
                date: recordDate,
                timestamp: updatedMs !== null ? outcome.updatedAt : null,
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
