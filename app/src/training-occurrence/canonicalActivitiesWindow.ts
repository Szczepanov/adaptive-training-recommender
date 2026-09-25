/**
 * Canonical Activities window loader (ADR-0034). The post-sync reconciliation sweep only
 * runs when the current tab awaited the sync it observes, so a scheduled or other-device
 * Garmin sync can land activities that never get a canonical occurrence -- and the
 * read-only canonical view would then omit them indefinitely. Converging the displayed
 * window first (bounded, idempotent: already-linked sources short-circuit) closes that
 * gap. A sweep failure never blocks the read.
 */
import { getCompletedWorkoutsInRange } from './activitiesReadModelService';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { reconcileDateRangeForUser } from './reconciliationService';

export async function loadCanonicalActivitiesWindow(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<CompletedWorkoutView[]> {
    try {
        await reconcileDateRangeForUser(userId, fromDateInclusive, toDateExclusive);
    } catch (error) {
        console.warn('[training-occurrence] activities window reconciliation failed', error);
    }
    return getCompletedWorkoutsInRange(userId, fromDateInclusive, toDateExclusive);
}
