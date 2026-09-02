/**
 * Public surface of the PR 1 shadow-reconciliation module (ADR-0034). Hooks that trigger
 * shadow reconciliation (`hooks/useSessionRunner.ts`, `hooks/useAutoGarminSync.ts`,
 * `hooks/useGarminSyncTrigger.ts`) import only from here.
 */
import { getLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { reconcileDateRangeForUser } from './reconciliationService';

export type {
    PerformedTrainingOccurrence,
    PerformedOccurrenceSourceRef,
    ReconciliationSourceFacts,
} from './models';
export {
    reconcileStructuredCompletion,
    reconcileGarminActivity,
    reconcileDateRangeForUser,
    reconcileSourceFacts,
} from './reconciliationService';
export { rebuildOccurrence, rebuildDateRangeForUser } from './rebuildService';
export { performedTrainingOccurrenceRepository } from './repository';
export { getShadowReconciliationCounters, resetShadowReconciliationCounters } from './metrics';
export { getCompletedWorkoutsInRange } from './activitiesReadModelService';
export type { CompletedWorkoutView } from './completedWorkoutView';
// PR 4: diagnostic-only, never called from a live recommendation/coach/history path.
export { computeHistoryShadowDiffForUser } from './historyShadowService';
export { diffCompletedTrainingHistory, type HistoryShadowDiff } from './historyShadowDiff';

/** A bounded recent-day sweep -- the hook doesn't know which specific activity IDs a
 * Garmin sync just landed, so it sweeps a small window instead. 3 days back covers a
 * structured completion that reconciled before this sync landed (or a short delay/travel
 * timezone edge), 1 day forward covers a session already logged for "tomorrow" in another
 * timezone; both bounds are intentionally small since this runs on every sync completion. */
export async function triggerGarminShadowReconciliationSweep(userId: string): Promise<void> {
    const today = getLocalDateString();
    const fromDateInclusive = addDaysToLocalDateString(today, -3);
    const toDateExclusive = addDaysToLocalDateString(today, 2);
    await reconcileDateRangeForUser(userId, fromDateInclusive, toDateExclusive);
}
