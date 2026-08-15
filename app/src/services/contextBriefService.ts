import type { DailyRecoverySnapshot } from '../engine/models';
import {
    briefWindowStart,
    buildContextBrief,
    defaultBriefWindowDays,
    SUBJECTIVE_BASELINE_DAYS,
    type ContextBriefInput,
} from '../engine/contextBrief';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { activityService } from './activityService';
import { checkinService } from './checkinService';
import { preferencesService } from './preferencesService';
import { recommendationService } from './recommendationService';
import { recoverySnapshotService } from './recoverySnapshotService';
import { trainingIntentProfileService } from './trainingIntentProfileService';
import { trainingSettingsService } from './trainingSettingsService';

export interface ContextBriefResult {
    /** The rendered markdown, ready to paste into an external planner. */
    text: string;
    startDate: string;
    asOfDate: string;
    windowDays: number;
    /** Sources that could not be read. The brief still renders; it says what is missing
     * rather than presenting a partial window as complete. */
    unavailableSources: string[];
}

/** Assembles the context brief from the user-scoped stores. Read-only: it persists
 * nothing and mutates nothing, so it is safe to call at any point in the day. */
export class ContextBriefService {
    async build(userId: string, asOfDate?: string, windowDays: number = defaultBriefWindowDays()): Promise<ContextBriefResult> {
        const targetDate = asOfDate ?? getLocalDateString();
        const startDate = briefWindowStart(targetDate, windowDays);
        // Strictly longer than the window, so there is always prior history to compare
        // against even when the caller asks for a long window.
        const baselineDays = Math.max(SUBJECTIVE_BASELINE_DAYS, windowDays * 2);
        const baselineStart = briefWindowStart(targetDate, baselineDays);
        // Activity and recommendation range queries are end-exclusive; the brief window
        // is inclusive of targetDate, so the fetch reaches one day further.
        const throughExclusive = addDaysToLocalDateString(targetDate, 1);
        const unavailableSources: string[] = [];

        const snapshotDates = Array.from(
            { length: windowDays },
            (_, offset) => addDaysToLocalDateString(startDate, offset),
        );

        const [snapshotResults, checkinResult, activityResult, recommendationResult, settingsResult, preferencesResult, intentResult] =
            await Promise.allSettled([
                // getRecoverySnapshotByDate collapses UNAVAILABLE and MISSING to null, so a
                // read outage would be indistinguishable from "no data that day" and the
                // brief would silently under-report the window. Read the state instead.
                Promise.all(snapshotDates.map(date => recoverySnapshotService.getRecoverySnapshotState(userId, date))),
                // A date range, not getRecentCheckins' most-recent-N-documents: with gaps
                // that returns a longer span than requested, which would make the
                // baseline's coverage count meaningless (it would always look complete).
                checkinService.getCheckinsInRange(userId, baselineStart, targetDate),
                activityService.getActivitiesInRange(userId, startDate, throughExclusive),
                recommendationService.getRecommendationsInRange(userId, startDate, throughExclusive),
                trainingSettingsService.getTrainingSettingsState(userId),
                preferencesService.getPreferencesState(userId),
                trainingIntentProfileService.getProfileState(userId),
            ] as const);

        const snapshots: DailyRecoverySnapshot[] = [];
        if (snapshotResults.status === 'fulfilled') {
            let unreadableDays = 0;
            for (const state of snapshotResults.value) {
                if (state.status === 'AVAILABLE') snapshots.push(state.data);
                // MISSING is a genuine "no data that day" and is not a failure to report.
                else if (state.status !== 'MISSING') unreadableDays += 1;
            }
            if (unreadableDays > 0) unavailableSources.push(`recovery snapshots (${unreadableDays} day(s) unreadable)`);
        } else {
            unavailableSources.push('recovery snapshots');
        }

        const checkins = checkinResult.status === 'fulfilled' ? checkinResult.value : [];
        if (checkinResult.status !== 'fulfilled') unavailableSources.push('subjective check-ins');

        const activities = activityResult.status === 'fulfilled' && activityResult.value.status === 'AVAILABLE'
            ? activityResult.value.data
            : [];
        if (activityResult.status !== 'fulfilled' || activityResult.value.status !== 'AVAILABLE') {
            unavailableSources.push('recorded activities');
        }

        const recommendations = recommendationResult.status === 'fulfilled' && recommendationResult.value.status === 'AVAILABLE'
            ? recommendationResult.value.data
            : [];
        if (recommendationResult.status !== 'fulfilled' || recommendationResult.value.status !== 'AVAILABLE') {
            unavailableSources.push('recommendations and adherence');
        }

        const trainingSettings = settingsResult.status === 'fulfilled' && settingsResult.value.status === 'AVAILABLE'
            ? settingsResult.value.data
            : null;
        if (!trainingSettings) unavailableSources.push('training settings');

        const preferences = preferencesResult.status === 'fulfilled' && preferencesResult.value.status === 'AVAILABLE'
            ? preferencesResult.value.data
            : null;
        // Preferences own `unavailableModalities`, a hard exclusion the brief prints under
        // "a session that violates any of these cannot be executed". Losing them silently
        // would let that heading make a promise the content no longer keeps. An absent
        // document (MISSING) genuinely means nothing is configured; a failed read does not.
        if (preferencesResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(preferencesResult.value.status)) {
            unavailableSources.push('preferences (modality exclusions may be missing)');
        }

        const intentProfile = intentResult.status === 'fulfilled' && intentResult.value.status === 'AVAILABLE'
            ? intentResult.value.data
            : null;
        if (intentResult.status !== 'fulfilled' || !['AVAILABLE', 'MISSING'].includes(intentResult.value.status)) {
            unavailableSources.push('training intent profile');
        }

        const input: ContextBriefInput = {
            asOfDate: targetDate,
            windowDays,
            subjectiveBaselineDays: baselineDays,
            snapshots,
            checkins,
            activities,
            recommendations,
            trainingSettings,
            preferences,
            intentProfile,
        };

        return {
            text: buildContextBrief(input),
            startDate,
            asOfDate: targetDate,
            windowDays,
            unavailableSources,
        };
    }
}

export const contextBriefService = new ContextBriefService();
