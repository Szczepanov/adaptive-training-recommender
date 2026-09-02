/**
 * PR 4 (ADR-0034 "Shadow calculation first"): the thin orchestration wrapper around
 * `historyShadowDiff.ts` -- fetches exactly the inputs the LIVE pipeline itself uses
 * (`reconcileCompletedTrainingEvents`, reused unchanged) alongside the canonical
 * occurrence-derived view (`getCompletedWorkoutsInRange`, PR 2, reused unchanged) for the
 * same window, and logs the diff.
 *
 * Not called from any recommendation/coach/history code path -- this is a standalone
 * diagnostic entry point a caller (a script, a future admin tool) opts into explicitly.
 */
import { activityService } from '../services/activityService';
import { recommendationService } from '../services/recommendationService';
import { reconcileCompletedTrainingEvents } from '../engine/completedTraining';
import { getCompletedWorkoutsInRange } from './activitiesReadModelService';
import { diffCompletedTrainingHistory, recordHistoryShadowDiff, type HistoryShadowDiff } from './historyShadowDiff';

export async function computeHistoryShadowDiffForUser(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<HistoryShadowDiff | null> {
    const [activitiesState, recommendationsState, canonicalWorkouts] = await Promise.all([
        activityService.getActivitiesInRange(userId, fromDateInclusive, toDateExclusive),
        recommendationService.getRecommendationsInRange(userId, fromDateInclusive, toDateExclusive),
        getCompletedWorkoutsInRange(userId, fromDateInclusive, toDateExclusive),
    ]);

    // Matches buildTrainingHistorySnapshot's own required-source contract (trainingHistorySnapshot.ts
    // requireAvailable) -- an unavailable/invalid required source means no trustworthy diff,
    // not a silently-empty one.
    if (activitiesState.status !== 'AVAILABLE' || recommendationsState.status !== 'AVAILABLE') return null;

    const liveEvents = reconcileCompletedTrainingEvents(activitiesState.data, recommendationsState.data);
    const diff = diffCompletedTrainingHistory(liveEvents, canonicalWorkouts);
    recordHistoryShadowDiff(userId, diff);
    return diff;
}
