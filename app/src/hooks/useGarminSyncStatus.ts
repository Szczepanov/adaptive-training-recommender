import { useState, useEffect } from 'react';
import { garminWorkoutQueueService, type GarminQueuedWorkout } from '../services/garminWorkoutQueueService';

export type GarminSyncStatusState = 'idle' | 'pending' | 'synced' | 'failed';

export interface UseGarminSyncStatusResult {
    status: GarminSyncStatusState;
    queuedWorkout: GarminQueuedWorkout | null;
    pendingCount: number;
    isPending: boolean;
    error: string | null;
}

export function useGarminSyncStatus(userId: string | null | undefined): UseGarminSyncStatusResult {
    const [queueItems, setQueueItems] = useState<GarminQueuedWorkout[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) {
            return;
        }

        const unsubscribe = garminWorkoutQueueService.subscribeToUserQueue(
            userId,
            (items) => {
                setQueueItems(items);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Subscription error:', err);
                setError(err.message);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId]);

    const activeItems = userId ? queueItems : [];
    const pendingItems = activeItems.filter(item => item.status === 'pending');
    const failedItems = activeItems.filter(item => item.status === 'failed');
    const syncedItems = activeItems
        .filter(item => item.status === 'synced')
        .sort((a, b) => (b.syncedAt || b.queuedAt || '').localeCompare(a.syncedAt || a.queuedAt || ''));

    let status: GarminSyncStatusState = 'idle';
    let queuedWorkout: GarminQueuedWorkout | null = null;
    let activeError: string | null = error;

    if (pendingItems.length > 0) {
        status = 'pending';
        // Pick the most recently queued pending item
        queuedWorkout = [...pendingItems].sort((a, b) => (b.queuedAt || '').localeCompare(a.queuedAt || ''))[0];
    } else if (failedItems.length > 0) {
        status = 'failed';
        queuedWorkout = failedItems[0];
        activeError = queuedWorkout.error || error || 'Sync failed';
    } else if (syncedItems.length > 0) {
        status = 'synced';
        queuedWorkout = syncedItems[0];
    }

    return {
        status,
        queuedWorkout,
        pendingCount: pendingItems.length,
        isPending: status === 'pending',
        error: activeError,
    };
}

