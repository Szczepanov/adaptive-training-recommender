import { useEffect, useRef } from 'react';
import type { DailyDecisionInput } from '../engine/models';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import { isRecoverySnapshotStale } from '../utils/garminSyncStaleness';

export interface UseAutoGarminSyncOptions {
    userId: string | null | undefined;
    decisionInput: DailyDecisionInput | null;
    onSynced?: () => void;
    enabled?: boolean;
}

/**
 * Pure predicate behind the completion subscription below, extracted so it's
 * testable without a render harness (this repo has no interactive component-test
 * harness -- see GarminSyncNowButton.test.tsx / garminSyncStaleness.ts).
 *
 * `awaitingRequestedAt` is the `requestedAt` of the specific request this hook
 * queued (see requestSync()'s docstring). A snapshot only counts as "our sync
 * finished" when it's that same request AND it reached 'completed' -- an update
 * that matches the identifier but is still 'pending'/'processing', or that
 * terminated as 'failed', must not fire onSynced.
 */
export function isAwaitedSyncComplete(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): boolean {
    return (
        !!awaitingRequestedAt &&
        !!request &&
        request.requestedAt === awaitingRequestedAt &&
        request.status === 'completed'
    );
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
    // requestedAt of the specific request *this hook* queued, so the completion
    // subscription below can tell "our sync finished" apart from "the shared doc
    // changed for some other reason" (a stale terminal snapshot observed before our
    // write lands, another tab's request, etc.) -- see requestSync()'s docstring.
    const awaitingRequestedAtRef = useRef<string | null>(null);
    const onSyncedRef = useRef(onSynced);

    useEffect(() => {
        onSyncedRef.current = onSynced;
    }, [onSynced]);

    // Reset the auto-trigger tracker when the user identity changes
    useEffect(() => {
        hasTriggeredForDateRef.current = null;
        awaitingRequestedAtRef.current = null;
    }, [userId]);

    // Subscribe to sync request state changes to notify caller when our sync finishes
    useEffect(() => {
        if (!userId || !enabled) return;

        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (request) => {
                if (isAwaitedSyncComplete(request, awaitingRequestedAtRef.current)) {
                    awaitingRequestedAtRef.current = null;
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
            garminSyncRequestService
                .requestSync(userId)
                .then((requestedAt) => {
                    awaitingRequestedAtRef.current = requestedAt;
                })
                .catch((err) => {
                    console.warn('[useAutoGarminSync] Failed to request auto sync:', err);
                });
        }
    }, [userId, decisionInput, enabled]);
}
