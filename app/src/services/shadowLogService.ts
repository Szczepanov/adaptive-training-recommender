import type { DailyRecommendation, DailyRecoverySnapshot, DailySubjectiveCheckin, DecisionJournalEntry } from '../engine/models';
import { buildShadowLog, type ShadowLogDayInput, type ShadowLogRow } from '../engine/shadowLog';
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
     * for whatever was readable -- see `buildShadowLog`'s missingness argument -- but a
     * reviewer relying on this for 9.0.7's volume gates needs to know a gap here is a
     * read/validation failure, not a genuine missing day. */
    unavailableSources: string[];
    /** Range-state provenance stays separate from ordinary record absence. This lets the
     * readout distinguish a legitimate no-check-in day from a failed/invalid query. */
    sourceQuality: {
        subjectiveCheckins: {
            status: 'AVAILABLE' | 'MISSING' | 'INVALID' | 'UNAVAILABLE';
            issueCount: number;
        };
    };
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
        let subjectiveCheckinQuality: ShadowLogResult['sourceQuality']['subjectiveCheckins'] = {
            status: 'UNAVAILABLE',
            issueCount: 0,
        };

        const [snapshotResults, checkinResult, recommendationResult, journalResult] = await Promise.allSettled([
            // Day-by-day, same reasoning as contextBriefService: collapsing UNAVAILABLE and
            // MISSING to null would make a read outage indistinguishable from "no data that
            // day" and silently under-report the window.
            Promise.all(dates.map(date => recoverySnapshotService.getRecoverySnapshotState(userId, date))),
            checkinService.getCheckinsInRangeState(userId, startDate, throughExclusive),
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

        const checkinByDate = new Map<string, DailySubjectiveCheckin>();
        if (checkinResult.status === 'fulfilled') {
            const state = checkinResult.value;
            const issueCount = state.status === 'AVAILABLE' || state.status === 'INVALID'
                ? state.issues?.length ?? 0
                : 0;
            subjectiveCheckinQuality = { status: state.status, issueCount };
            if (state.status === 'AVAILABLE') {
                for (const checkin of state.data) checkinByDate.set(checkin.date, checkin);
                if (issueCount > 0) unavailableSources.push(`subjective check-ins (${issueCount} invalid record(s) omitted)`);
            } else if (state.status === 'INVALID') {
                unavailableSources.push('subjective check-ins (range invalid)');
            } else if (state.status === 'UNAVAILABLE') {
                unavailableSources.push('subjective check-ins (range unavailable)');
            }
        } else {
            unavailableSources.push('subjective check-ins (range unavailable)');
        }

        // A single malformed document fails the whole range read (see
        // getRecommendationsInRange's doc comment) -- same tradeoff contextBriefService
        // already accepts for this reader.
        const recommendationByDate = new Map<string, DailyRecommendation>();
        if (recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE') {
            for (const recommendation of recommendationResult.value.data) recommendationByDate.set(recommendation.date, recommendation);
        } else {
            unavailableSources.push('recommendations and feedback');
        }

        const journalByDate = new Map<string, DecisionJournalEntry>();
        if (journalResult.status === 'fulfilled') {
            for (const entry of journalResult.value.entries) journalByDate.set(entry.date, entry);
            if (journalResult.value.invalidRecords > 0) {
                unavailableSources.push(`decision journal (${journalResult.value.invalidRecords} invalid record(s) omitted)`);
            }
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
            sourceQuality: { subjectiveCheckins: subjectiveCheckinQuality },
        };
    }
}

export const shadowLogService = new ShadowLogService();
