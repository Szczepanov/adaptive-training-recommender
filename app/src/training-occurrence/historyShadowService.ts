/**
 * PR 4 (ADR-0034 "Shadow calculation first"): the thin orchestration wrapper around
 * `historyShadowDiff.ts` -- fetches exactly the inputs the LIVE pipeline itself uses
 * (`reconcileCompletedTrainingEvents`, reused unchanged) alongside the canonical
 * occurrence-derived view (`getCompletedWorkoutsInRange`, PR 2, reused unchanged) for the
 * same window, and logs the diff.
 *
 * Both sides read Activities from the exact same fetch: `getCompletedWorkoutsInRange`
 * would otherwise perform its own independent Activities read during canonical
 * hydration, and two independent reads around the same moment can observe different
 * revisions if a sync commits in between, making the diff compare mismatched source
 * sets and report a false gap. Fetching once at `hydrationWindowFor`'s window and passing
 * it into canonical hydration via `preloadedActivities` removes that race.
 *
 * Not called from any recommendation/coach/history code path -- this is a standalone
 * diagnostic entry point a caller (a script, a future admin tool) opts into explicitly.
 */
import { activityService } from '../services/activityService';
import { recommendationService } from '../services/recommendationService';
import { reconcileCompletedTrainingEvents } from '../engine/completedTraining';
import { getCompletedWorkoutsInRange, hydrationWindowFor } from './activitiesReadModelService';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { diffCompletedTrainingHistory, recordHistoryShadowDiff, type HistoryShadowDiff } from './historyShadowDiff';

function hasTransientStructuredReadFailure(read: CompletedWorkoutView['sourceReads']['structured']): boolean {
    switch (read.status) {
        case 'execution_unavailable':
        case 'entries_unavailable':
            return true;
        case 'definition_unresolved':
            return read.definition === 'UNAVAILABLE';
        case 'not_linked':
        case 'available':
        case 'execution_missing':
        case 'execution_invalid':
            return false;
    }
}

export async function computeHistoryShadowDiffForUser(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<HistoryShadowDiff | null> {
    const hydrationWindow = hydrationWindowFor(fromDateInclusive, toDateExclusive);
    const [activitiesState, recommendationsState] = await Promise.all([
        activityService.getActivitiesInRange(userId, hydrationWindow.from, hydrationWindow.to),
        recommendationService.getRecommendationsInRange(userId, fromDateInclusive, toDateExclusive),
    ]);

    // Matches buildTrainingHistorySnapshot's own required-source contract (trainingHistorySnapshot.ts
    // requireAvailable) -- an unavailable/invalid required source means no trustworthy diff,
    // not a silently-empty one.
    if (activitiesState.status !== 'AVAILABLE' || recommendationsState.status !== 'AVAILABLE') return null;

    // reconcileCompletedTrainingEvents (matching buildTrainingHistorySnapshot's own
    // contract) expects the exact caller range, not the wider hydration window.
    const exactRangeActivities = activitiesState.data.filter(
        activity => activity.date >= fromDateInclusive && activity.date < toDateExclusive,
    );
    const liveEvents = reconcileCompletedTrainingEvents(exactRangeActivities, recommendationsState.data);
    const canonicalWorkouts = await getCompletedWorkoutsInRange(userId, fromDateInclusive, toDateExclusive, activitiesState.data);
    // A *temporarily* unreadable structured source is missing evidence, not a downgraded tier:
    // diffing it would log a false ADR-0034 regression. Persistent states (a deleted execution,
    // an invalid document, a definition that is MISSING/INVALID) are real data and keep diffing,
    // otherwise one such row would silence the shadow diff for every window containing it.
    if (canonicalWorkouts.some(workout => hasTransientStructuredReadFailure(workout.sourceReads.structured))) return null;
    const diff = diffCompletedTrainingHistory(liveEvents, canonicalWorkouts);
    recordHistoryShadowDiff(userId, diff);
    return diff;
}
