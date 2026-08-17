import { useState, useEffect } from 'react';
import { garminWorkoutQueueService, type GarminQueuedWorkout } from '../services/garminWorkoutQueueService';

export type GarminSyncStatusState = 'idle' | 'pending' | 'synced' | 'failed';

export interface UseGarminSyncStatusResult {
    status: GarminSyncStatusState;
    queuedWorkout: GarminQueuedWorkout | null;
    isPending: boolean;
    error: string | null;
}

export function useGarminSyncStatus(userId: string | null | undefined, date: string): UseGarminSyncStatusResult {
    const [queuedWorkout, setQueuedWorkout] = useState<GarminQueuedWorkout | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId || !date) {
            return;
        }

        const unsubscribe = garminWorkoutQueueService.subscribeToQueueItem(
            userId,
            date,
            (item) => {
                setQueuedWorkout(item);
                setError(item?.error ?? null);
            },
            (err) => {
                console.error('[useGarminSyncStatus] Subscription error:', err);
                setError(err.message);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [userId, date]);

    const activeItem = userId && date ? queuedWorkout : null;
    const activeError = userId && date ? error : null;
    const status: GarminSyncStatusState = activeItem?.status ?? 'idle';

    return {
        status,
        queuedWorkout: activeItem,
        isPending: status === 'pending',
        error: activeError,
    };
}
