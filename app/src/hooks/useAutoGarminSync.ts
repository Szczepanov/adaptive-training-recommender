import { useEffect, useRef } from 'react';
import type { DailyDecisionInput } from '../engine/models';
import { garminSyncRequestService } from '../services/garminSyncRequestService';
import { isRecoverySnapshotStale, isSyncRequestInFlight } from '../utils/garminSyncStaleness';

export interface UseAutoGarminSyncOptions {
    userId: string | null | undefined;
    decisionInput: DailyDecisionInput | null;
    onSynced?: () => void;
    enabled?: boolean;
}

/**
 * Automatically checks whether today's Garmin recovery snapshot has been ingested
 * and is up-to-date upon login or dashboard load.
 *
 * If the snapshot for decisionInput.date is missing, incomplete, or older than 60 minutes,
 * an automated sync request is queued (matching manual "Sync Now" behavior) and onSynced
 * is invoked when the ingestion completes.
 */
export function useAutoGarminSync({
    userId,
    decisionInput,
    onSynced,
    enabled = true,
}: UseAutoGarminSyncOptions): void {
    const hasTriggeredForDateRef = useRef<string | null>(null);
    const awaitingSyncRef = useRef<boolean>(false);
    const onSyncedRef = useRef(onSynced);

    useEffect(() => {
        onSyncedRef.current = onSynced;
    }, [onSynced]);

    // Reset the auto-trigger tracker when the user identity changes
    useEffect(() => {
        hasTriggeredForDateRef.current = null;
        awaitingSyncRef.current = false;
    }, [userId]);

    // Subscribe to sync request state changes to notify caller when our sync finishes
    useEffect(() => {
        if (!userId || !enabled) return;

        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (request) => {
                if (awaitingSyncRef.current && request && !isSyncRequestInFlight(request)) {
                    awaitingSyncRef.current = false;
                    onSyncedRef.current?.();
                }
            },
            (err) => console.error('[useAutoGarminSync] Subscription error:', err)
        );

        return unsubscribe;
    }, [userId, enabled]);

    // Check staleness and trigger sync if needed
    useEffect(() => {
        if (!enabled || !userId || !decisionInput) return;

        const targetDate = decisionInput.date;
        if (hasTriggeredForDateRef.current === targetDate) return;

        const isStale = isRecoverySnapshotStale(decisionInput.recoverySnapshot, targetDate);
        if (isStale) {
            hasTriggeredForDateRef.current = targetDate;
            awaitingSyncRef.current = true;
            garminSyncRequestService.requestSync(userId).catch((err) => {
                console.warn('[useAutoGarminSync] Failed to request auto sync:', err);
                awaitingSyncRef.current = false;
            });
        }
    }, [userId, decisionInput, enabled]);
}
