import { useState, useEffect } from 'react';
import { garminWorkoutQueueService, type GarminQueuedWorkout } from '../services/garminWorkoutQueueService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import type { DailyRecoverySnapshot } from '../engine/models';
import { useGarminSyncTrigger } from './useGarminSyncTrigger';
import { resolveGarminSyncStatus } from './garminSyncStatusResolver';
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

export function useGarminSyncStatus(
    userId: string | null | undefined,
    date?: string,
    onSynced?: () => void
): UseGarminSyncStatusResult {
    const [queueItems, setQueueItems] = useState<GarminQueuedWorkout[]>([]);
    const [snapshot, setSnapshot] = useState<DailyRecoverySnapshot | null>(null);
    // Surfaces a queue/snapshot subscription failure (e.g. Firestore rules denial, the
    // client going offline) as a real error status instead of silently swallowing it.
    // Cleared on the next successful update from either subscription so it can't
    // outlive the problem that caused it.
    const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

    const {
        request: syncRequest,
        triggering,
        localError: triggerError,
        isInFlight: isGetInFlight,
        isStale,
        triggerSync,
    } = useGarminSyncTrigger(userId, onSynced);

    const targetDate = date || getLocalDateString();

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
                setSubscriptionError(null);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Workout queue subscription error:', err);
                setSubscriptionError(err.message);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId]);

    // 2. Subscribe to Recovery Snapshot (GET)
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
                setSubscriptionError(null);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Snapshot subscription error:', err);
                setSubscriptionError(err.message);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId, targetDate]);

    const activeItems = userId ? queueItems : [];

    const resolution = resolveGarminSyncStatus({
        queueItems: activeItems,
        syncRequest,
        snapshot,
        triggering,
        isGetInFlight,
        isStale,
        // A client-side subscription/request error takes priority for the tooltip,
        // falling back to a subscription-connectivity error.
        clientError: triggerError || subscriptionError,
    });

    return {
        status: resolution.status,
        queuedWorkout: resolution.queuedWorkout,
        pendingCount: resolution.pendingCount,
        isPending: resolution.status === 'pending',
        isBusy: resolution.isBusy,
        isStale,
        error: resolution.error,
        latestSyncedAt: resolution.latestSyncedAt,
        latestGetSyncedAt: resolution.latestGetSyncedAt,
        latestPostSyncedAt: resolution.latestPostSyncedAt,
        triggerSync,
    };
}
