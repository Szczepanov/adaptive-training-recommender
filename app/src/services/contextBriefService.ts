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
        const baselineDays = Math.max(SUBJECTIVE_BASELINE_DAYS, windowDays);
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
                Promise.all(snapshotDates.map(date => recoverySnapshotService.getRecoverySnapshotByDate(userId, date))),
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

        const snapshots: DailyRecoverySnapshot[] = snapshotResults.status === 'fulfilled'
            ? snapshotResults.value.filter((snapshot): snapshot is DailyRecoverySnapshot => snapshot !== null)
            : [];
        if (snapshotResults.status !== 'fulfilled') unavailableSources.push('recovery snapshots');

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

        const intentProfile = intentResult.status === 'fulfilled' && intentResult.value.status === 'AVAILABLE'
            ? intentResult.value.data
            : null;

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
