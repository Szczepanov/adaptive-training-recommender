import type { GarminQueuedWorkout } from '../services/garminWorkoutQueueService';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';
import type { DailyRecoverySnapshot } from '../engine/models';
import type { GarminSyncStatusState } from './useGarminSyncStatus';

export interface GarminSyncStatusInputs {
    queueItems: GarminQueuedWorkout[];
    syncRequest: GarminSyncRequest | null;
    snapshot: DailyRecoverySnapshot | null;
    triggering: boolean;
    isGetInFlight: boolean;
    isStale: boolean;
    /** Any client-side error not already reflected by syncRequest.status === 'failed'
     * -- e.g. a failed triggerSync() write, or a Firestore subscription error. */
    clientError: string | null;
}

export interface GarminSyncStatusResolution {
    status: GarminSyncStatusState;
    queuedWorkout: GarminQueuedWorkout | null;
    pendingCount: number;
    isBusy: boolean;
    error: string | null;
    latestSyncedAt: string | null;
    latestGetSyncedAt: string | null;
    latestPostSyncedAt: string | null;
}

/** Both `snapshotSyncedAt`/`requestCompletedAt` and `latestPostSyncedAt` are always
 * written by the same Python backend (`datetime.now(timezone.utc).isoformat()`), so a
 * plain lexicographic compare of the ISO strings is a safe proxy for chronological
 * order here -- there's no client-written 'Z'-suffixed timestamp mixed into this
 * comparison to break that assumption. */
function getLatestIsoString(a: string | null | undefined, b: string | null | undefined): string | null {
    if (a && b) {
        return a.localeCompare(b) >= 0 ? a : b;
    }
    return a || b || null;
}

/** Pure status-resolution logic for useGarminSyncStatus, kept separate from the hook's
 * subscriptions/effects so it's directly unit-testable (this repo has no interactive
 * component/hook-render test harness -- see GarminSyncNowButton.test.tsx). */
export function resolveGarminSyncStatus({
    queueItems,
    syncRequest,
    snapshot,
    triggering,
    isGetInFlight,
    isStale,
    clientError,
}: GarminSyncStatusInputs): GarminSyncStatusResolution {
    const pendingItems = queueItems.filter(item => item.status === 'pending');
    const failedItems = queueItems.filter(item => item.status === 'failed');
    const syncedItems = queueItems
        .filter(item => item.status === 'synced')
        .sort((a, b) => (b.syncedAt || b.queuedAt || '').localeCompare(a.syncedAt || a.queuedAt || ''));

    const isPostPending = pendingItems.length > 0;
    // Staleness only describes the GET sync-request doc, so it must not gate the POST
    // workout queue's own pending state -- a stuck/stale GET request must never mask a
    // genuinely in-flight workout push.
    const isBusy = triggering || isPostPending || (isGetInFlight && !isStale);

    const latestPostSyncedAt = syncedItems[0]?.syncedAt || null;
    const snapshotSyncedAt = snapshot?.source?.garminSyncedAt || null;
    const requestCompletedAt = (syncRequest?.status === 'completed' && syncRequest.completedAt) ? syncRequest.completedAt : null;
    const latestGetSyncedAt = getLatestIsoString(snapshotSyncedAt, requestCompletedAt);
    const latestSyncedAt = getLatestIsoString(latestGetSyncedAt, latestPostSyncedAt);

    let status: GarminSyncStatusState = 'idle';
    let queuedWorkout: GarminQueuedWorkout | null = null;
    let error: string | null = clientError;

    if (isBusy) {
        status = 'pending';
        if (pendingItems.length > 0) {
            queuedWorkout = [...pendingItems].sort((a, b) => (b.queuedAt || '').localeCompare(a.queuedAt || ''))[0];
        }
    } else if (clientError) {
        status = 'failed';
    } else if (!isStale && syncRequest?.status === 'failed') {
        status = 'failed';
        error = syncRequest.error || 'Garmin sync failed';
    } else if (failedItems.length > 0) {
        status = 'failed';
        queuedWorkout = failedItems[0];
        error = queuedWorkout.error || 'Workout sync failed';
    } else if (latestSyncedAt) {
        status = 'synced';
        if (syncedItems.length > 0) {
            queuedWorkout = syncedItems[0];
        }
    }

    return {
        status,
        queuedWorkout,
        pendingCount: pendingItems.length + (isGetInFlight && !isStale ? 1 : 0),
        isBusy,
        error,
        latestSyncedAt,
        latestGetSyncedAt,
        latestPostSyncedAt,
    };
}
