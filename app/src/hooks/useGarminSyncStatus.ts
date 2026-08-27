import { useState, useEffect, useRef, useCallback } from 'react';
import { garminWorkoutQueueService, type GarminQueuedWorkout } from '../services/garminWorkoutQueueService';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import type { DailyRecoverySnapshot } from '../engine/models';
import { isAwaitedSyncTerminal } from '../utils/garminSyncRequestState';
import { isSyncRequestInFlight, isSyncRequestStale } from '../utils/garminSyncStaleness';
import { getLocalDateString } from '../utils/localDate';

export type GarminSyncStatusState = 'idle' | 'pending' | 'synced' | 'failed';

export interface UseGarminSyncStatusResult {
    status: GarminSyncStatusState;
    queuedWorkout: GarminQueuedWorkout | null;
    pendingCount: number;
    isPending: boolean;
    isBusy: boolean;
    isStale: boolean;
    error: string | null;
    latestSyncedAt: string | null;
    latestGetSyncedAt: string | null;
    latestPostSyncedAt: string | null;
    triggerSync: () => Promise<string | null>;
}

function getLatestIsoString(a: string | null | undefined, b: string | null | undefined): string | null {
    if (a && b) {
        return a.localeCompare(b) >= 0 ? a : b;
    }
    return a || b || null;
}

export function useGarminSyncStatus(
    userId: string | null | undefined,
    date?: string,
    onSynced?: () => void
): UseGarminSyncStatusResult {
    const [queueItems, setQueueItems] = useState<GarminQueuedWorkout[]>([]);
    const [syncRequest, setSyncRequest] = useState<GarminSyncRequest | null>(null);
    const [snapshot, setSnapshot] = useState<DailyRecoverySnapshot | null>(null);
    const [triggering, setTriggering] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const awaitingRequestedAtRef = useRef<string | null>(null);
    const onSyncedRef = useRef(onSynced);

    useEffect(() => {
        onSyncedRef.current = onSynced;
    }, [onSynced]);

    const targetDate = date || getLocalDateString();

    // Reset awaiting state on user change
    useEffect(() => {
        awaitingRequestedAtRef.current = null;
        setLocalError(null);
    }, [userId]);

    // 1. Subscribe to Workout Push Queue (POST)
    useEffect(() => {
        if (!userId) {
            setQueueItems([]);
            return;
        }

        const unsubscribe = garminWorkoutQueueService.subscribeToUserQueue(
            userId,
            (items) => {
                setQueueItems(items);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Workout queue subscription error:', err);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId]);

    // 2. Subscribe to Manual/Auto Sync Requests (GET)
    useEffect(() => {
        if (!userId) {
            setSyncRequest(null);
            return;
        }

        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (next) => {
                setSyncRequest(next);
                if (isAwaitedSyncTerminal(next, awaitingRequestedAtRef.current)) {
                    awaitingRequestedAtRef.current = null;
                    onSyncedRef.current?.();
                }
            },
            (err) => {
                console.error('[useGarminSyncStatus] Sync request subscription error:', err);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId]);

    // 3. Subscribe to Recovery Snapshot (GET)
    useEffect(() => {
        if (!userId || !targetDate) {
            setSnapshot(null);
            return;
        }

        const unsubscribe = recoverySnapshotService.subscribeToSnapshot(
            userId,
            targetDate,
            (snap) => {
                setSnapshot(snap);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Snapshot subscription error:', err);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId, targetDate]);

    // In-flight and staleness detection
    const isGetInFlight = isSyncRequestInFlight(syncRequest);
    const isStale = isSyncRequestStale(syncRequest, now);

    useEffect(() => {
        if (!isGetInFlight) return;
        const interval = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, [isGetInFlight]);

    const activeItems = userId ? queueItems : [];
    const pendingItems = activeItems.filter(item => item.status === 'pending');
    const failedItems = activeItems.filter(item => item.status === 'failed');
    const syncedItems = activeItems
        .filter(item => item.status === 'synced')
        .sort((a, b) => (b.syncedAt || b.queuedAt || '').localeCompare(a.syncedAt || a.queuedAt || ''));

    const isPostPending = pendingItems.length > 0;
    const isBusy = (triggering || isGetInFlight || isPostPending) && !isStale;

    // Timestamps
    const latestPostSyncedAt = syncedItems[0]?.syncedAt || null;
    const snapshotSyncedAt = snapshot?.source?.garminSyncedAt || null;
    const requestCompletedAt = (syncRequest?.status === 'completed' && syncRequest.completedAt) ? syncRequest.completedAt : null;
    const latestGetSyncedAt = getLatestIsoString(snapshotSyncedAt, requestCompletedAt);
    const latestSyncedAt = getLatestIsoString(latestGetSyncedAt, latestPostSyncedAt);

    // Status resolution
    let status: GarminSyncStatusState = 'idle';
    let queuedWorkout: GarminQueuedWorkout | null = null;
    let activeError: string | null = localError;

    if (isBusy || (isGetInFlight && !isStale) || isPostPending) {
        status = 'pending';
        if (pendingItems.length > 0) {
            queuedWorkout = [...pendingItems].sort((a, b) => (b.queuedAt || '').localeCompare(a.queuedAt || ''))[0];
        }
    } else if (localError) {
        status = 'failed';
    } else if (!isStale && syncRequest?.status === 'failed') {
        status = 'failed';
        activeError = syncRequest.error || 'Garmin sync failed';
    } else if (failedItems.length > 0) {
        status = 'failed';
        queuedWorkout = failedItems[0];
        activeError = queuedWorkout.error || 'Workout sync failed';
    } else if (latestSyncedAt) {
        status = 'synced';
        if (syncedItems.length > 0) {
            queuedWorkout = syncedItems[0];
        }
    }

    const triggerSync = useCallback(async (): Promise<string | null> => {
        if (!userId || isBusy) return null;
        setTriggering(true);
        setLocalError(null);
        try {
            const requestedAt = await garminSyncRequestService.requestSync(userId);
            awaitingRequestedAtRef.current = requestedAt;

            try {
                const current = await garminSyncRequestService.getRequest(userId);
                if (
                    awaitingRequestedAtRef.current === requestedAt &&
                    isAwaitedSyncTerminal(current, requestedAt)
                ) {
                    awaitingRequestedAtRef.current = null;
                    onSyncedRef.current?.();
                }
            } catch (reconcileErr) {
                console.warn('[useGarminSyncStatus] Failed to reconcile sync state:', reconcileErr);
            }
            return requestedAt;
        } catch (err) {
            console.error('Failed to request Garmin sync:', err);
            setLocalError('Could not request sync — try again.');
            awaitingRequestedAtRef.current = null;
            return null;
        } finally {
            setTriggering(false);
        }
    }, [userId, isBusy]);

    return {
        status,
        queuedWorkout,
        pendingCount: pendingItems.length + (isGetInFlight && !isStale ? 1 : 0),
        isPending: status === 'pending',
        isBusy,
        isStale,
        error: activeError,
        latestSyncedAt,
        latestGetSyncedAt,
        latestPostSyncedAt,
        triggerSync,
    };
}
