/**
 * Canonical Activities window loader (ADR-0034). The post-sync reconciliation sweep only
 * runs when the current tab awaited the sync it observes, so a scheduled or other-device
 * Garmin sync can land activities that never get a canonical occurrence -- and the
 * read-only canonical view would then omit them indefinitely. Converging the displayed
 * window first (bounded, idempotent: already-linked sources short-circuit) closes that
 * gap. A sweep failure never blocks the read, but it is reported: a sweep that threw, could
 * not read Activities, or hit a per-source error did not evaluate every source, so the read
 * model must not claim "no candidate" or an empty window (#895 WP5).
 */
import { getCompletedWorkoutsInRange } from './activitiesReadModelService';
import type { CompletedWorkoutView, ReconciliationSweepStatus } from './completedWorkoutView';
import { reconcileDateRangeForUser } from './reconciliationService';

export interface CanonicalActivitiesWindow {
    workouts: CompletedWorkoutView[];
    reconciliationSweep: Exclude<ReconciliationSweepStatus, 'not_run'>;
}

export async function loadCanonicalActivitiesWindow(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<CanonicalActivitiesWindow> {
    let reconciliationSweep: CanonicalActivitiesWindow['reconciliationSweep'] = 'completed';
    try {
        const summary = await reconcileDateRangeForUser(userId, fromDateInclusive, toDateExclusive);
        if (!summary.activitiesReadable || summary.sourceErrors > 0) reconciliationSweep = 'incomplete';
    } catch (error) {
        reconciliationSweep = 'failed';
        console.warn('[training-occurrence] activities window reconciliation failed', error);
    }
    const workouts = await getCompletedWorkoutsInRange(userId, fromDateInclusive, toDateExclusive, undefined, { reconciliationSweep });
    return { workouts, reconciliationSweep };
}
