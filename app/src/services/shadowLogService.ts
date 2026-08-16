import type { DailyRecommendation, DailyRecoverySnapshot, DailySubjectiveCheckin, DecisionJournalEntry } from '../engine/models';
import { buildShadowLog, type ShadowLogDayInput, type ShadowLogRow } from '../engine/shadowLog';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import { checkinService } from './checkinService';
import { decisionJournalService } from './decisionJournalService';
import { recommendationService } from './recommendationService';
import { recoverySnapshotService } from './recoverySnapshotService';

export interface ShadowLogResult {
    rows: ShadowLogRow[];
    startDate: string;
    endDate: string; // inclusive
    /** Sources that could not be read for at least part of the range. Rows still render
     *  for whatever was readable -- see `buildShadowLog`'s missingness argument -- but a
     *  reviewer relying on this for 9.0.7's volume gates needs to know a gap here is a
     *  read failure, not a genuine missing day. */
    unavailableSources: string[];
}

/**
 * Reads the four Phase 9.0 sources for a date range and joins them via
 * `buildShadowLog`, following the `contextBrief.ts` / `contextBriefService.ts` split:
 * this class does the I/O, `shadowLog.ts` does the (testable, pure) joining. Read-only.
 */
export class ShadowLogService {
    async build(userId: string, startDate: string, endDateInclusive: string): Promise<ShadowLogResult> {
        const throughExclusive = addDaysToLocalDateString(endDateInclusive, 1);
        const dayCount = getDayDiff(endDateInclusive, startDate) + 1;
        const dates = Array.from({ length: Math.max(dayCount, 0) }, (_, offset) => addDaysToLocalDateString(startDate, offset));
        const unavailableSources: string[] = [];

        const [snapshotResults, checkinResult, recommendationResult, journalResult] = await Promise.allSettled([
            // Day-by-day, same reasoning as contextBriefService: collapsing UNAVAILABLE and
            // MISSING to null would make a read outage indistinguishable from "no data that
            // day" and silently under-report the window.
            Promise.all(dates.map(date => recoverySnapshotService.getRecoverySnapshotState(userId, date))),
            checkinService.getCheckinsInRange(userId, startDate, endDateInclusive),
            recommendationService.getRecommendationsInRange(userId, startDate, throughExclusive),
            decisionJournalService.getEntriesInRange(userId, startDate, endDateInclusive),
        ] as const);

        const snapshotByDate = new Map<string, DailyRecoverySnapshot>();
        if (snapshotResults.status === 'fulfilled') {
            let unreadableDays = 0;
            snapshotResults.value.forEach((state, index) => {
                if (state.status === 'AVAILABLE') snapshotByDate.set(dates[index], state.data);
                else if (state.status !== 'MISSING') unreadableDays += 1;
            });
            if (unreadableDays > 0) unavailableSources.push(`recovery snapshots (${unreadableDays} day(s) unreadable)`);
        } else {
            unavailableSources.push('recovery snapshots');
        }

        // getCheckinsInRange predates the DataState-based history readers and returns raw
        // Firestore documents cast as DailySubjectiveCheckin -- re-parse them here, same as
        // contextBriefService, so one malformed historical record cannot silently enter the
        // export as a neutral subjective vector.
        const checkinByDate = new Map<string, DailySubjectiveCheckin>();
        if (checkinResult.status === 'fulfilled') {
            let invalidCheckins = 0;
            checkinResult.value.forEach((rawCheckin, index) => {
                const rawDate = typeof rawCheckin?.date === 'string' ? rawCheckin.date : `invalid-${index}`;
                const parsed = parseSubjectiveCheckin(rawCheckin, `users/${userId}/daily_subjective_checkins/${rawDate}`, userId, rawDate);
                if (parsed.status === 'AVAILABLE') checkinByDate.set(parsed.data.date, parsed.data);
                else invalidCheckins += 1;
            });
            if (invalidCheckins > 0) unavailableSources.push(`subjective check-ins (${invalidCheckins} invalid record(s) omitted)`);
        } else {
            unavailableSources.push('subjective check-ins');
        }

        // A single malformed document fails the whole range read (see
        // getRecommendationsInRange's doc comment) -- same tradeoff contextBriefService
        // already accepts for this reader.
        const recommendationByDate = new Map<string, DailyRecommendation>();
        if (recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE') {
            for (const recommendation of recommendationResult.value.data) recommendationByDate.set(recommendation.date, recommendation);
        } else {
            unavailableSources.push('recommendations and adherence');
        }

        const journalByDate = new Map<string, DecisionJournalEntry>();
        if (journalResult.status === 'fulfilled') {
            for (const entry of journalResult.value) journalByDate.set(entry.date, entry);
        } else {
            unavailableSources.push('decision journal');
        }

        const days: ShadowLogDayInput[] = dates.map(date => ({
            date,
            recommendation: recommendationByDate.get(date) ?? null,
            journalEntry: journalByDate.get(date) ?? null,
            checkin: checkinByDate.get(date) ?? null,
            recoverySnapshot: snapshotByDate.get(date) ?? null,
        }));

        return {
            rows: buildShadowLog(days),
            startDate,
            endDate: endDateInclusive,
            unavailableSources,
        };
    }
}

export const shadowLogService = new ShadowLogService();
