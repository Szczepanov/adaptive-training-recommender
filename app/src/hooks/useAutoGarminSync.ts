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

type AwaitedSyncOutcome = 'completed' | 'failed' | null;

interface ActiveTriggerContext {
    userId: string;
    targetDate: string;
}

/**
 * Classify a subscription/read snapshot only when it belongs to the exact request
 * this hook is awaiting. This lets both the realtime listener and the post-request
 * reconciliation read share the same correlation rules.
 */
export function getAwaitedSyncOutcome(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): AwaitedSyncOutcome {
    if (!awaitingRequestedAt || !request || request.requestedAt !== awaitingRequestedAt) {
        return null;
    }
    if (request.status === 'completed' || request.status === 'failed') {
        return request.status;
    }
    return null;
}

/**
 * Pure predicate kept for focused regression tests and callers that only care about
 * successful completion.
 */
export function isAwaitedSyncComplete(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): boolean {
    return getAwaitedSyncOutcome(request, awaitingRequestedAt) === 'completed';
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
    // requestedAt of the specific request *this hook* queued/joined, so the
    // completion subscription can distinguish it from another update to the shared
    // garmin_sync_requests/latest document.
    const awaitingRequestedAtRef = useRef<string | null>(null);
    // Guards asynchronous requestSync/getRequest continuations from an older user/date
    // from installing stale awaiting state after navigation or an identity change.
    const activeTriggerRef = useRef<ActiveTriggerContext | null>(null);
    const onSyncedRef = useRef(onSynced);

    useEffect(() => {
        onSyncedRef.current = onSynced;
    }, [onSynced]);

    // A new user or calendar date is a distinct auto-sync lifecycle.
    useEffect(() => {
        hasTriggeredForDateRef.current = null;
        awaitingRequestedAtRef.current = null;
        activeTriggerRef.current = null;
    }, [userId, decisionInput?.date]);

    // Subscribe to sync request state changes to notify caller when our sync finishes.
    useEffect(() => {
        if (!userId || !enabled) return;

        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (request) => {
                const outcome = getAwaitedSyncOutcome(request, awaitingRequestedAtRef.current);
                if (!outcome) return;

                awaitingRequestedAtRef.current = null;
                activeTriggerRef.current = null;
                if (outcome === 'completed') {
                    onSyncedRef.current?.();
                }
            },
            (err) => console.error('[useAutoGarminSync] Subscription error:', err)
        );

        return unsubscribe;
    }, [userId, enabled]);

    // Check staleness and trigger sync if needed.
    useEffect(() => {
        if (!enabled || !userId || !decisionInput) return;

        const targetDate = decisionInput.date;
        if (hasTriggeredForDateRef.current === targetDate) return;

        const isStale = isRecoverySnapshotStale(decisionInput.recoverySnapshot, targetDate);
        if (!isStale) return;

        const triggerContext: ActiveTriggerContext = { userId, targetDate };
        hasTriggeredForDateRef.current = targetDate;
        activeTriggerRef.current = triggerContext;

        garminSyncRequestService
            .requestSync(userId)
            .then(async (requestedAt) => {
                const active = activeTriggerRef.current;
                if (
                    !active ||
                    active.userId !== triggerContext.userId ||
                    active.targetDate !== triggerContext.targetDate
                ) {
                    return;
                }

                awaitingRequestedAtRef.current = requestedAt;

                // A request we joined can finish between the transaction resolving and
                // this continuation installing awaitingRequestedAtRef. In that case the
                // realtime listener already emitted the terminal snapshot while nothing
                // was being awaited. Re-read once after installing the correlation key so
                // completion cannot be lost permanently.
                try {
                    const currentRequest = await garminSyncRequestService.getRequest(userId);
                    const stillActive = activeTriggerRef.current;
                    if (
                        !stillActive ||
                        stillActive.userId !== triggerContext.userId ||
                        stillActive.targetDate !== triggerContext.targetDate ||
                        awaitingRequestedAtRef.current !== requestedAt
                    ) {
                        return;
                    }

                    const outcome = getAwaitedSyncOutcome(currentRequest, requestedAt);
                    if (!outcome) return;

                    awaitingRequestedAtRef.current = null;
                    activeTriggerRef.current = null;
                    if (outcome === 'completed') {
                        onSyncedRef.current?.();
                    }
                } catch (err) {
                    // The realtime subscription remains the primary completion path; a
                    // transient reconciliation-read failure should not turn a successfully
                    // queued sync into a user-visible error.
                    console.warn('[useAutoGarminSync] Failed to reconcile sync state:', err);
                }
            })
            .catch((err) => {
                const active = activeTriggerRef.current;
                if (
                    active &&
                    active.userId === triggerContext.userId &&
                    active.targetDate === triggerContext.targetDate
                ) {
                    activeTriggerRef.current = null;
                    awaitingRequestedAtRef.current = null;
                    // The request was never queued. Let a later dashboard refresh/rerender
                    // retry this same date instead of permanently suppressing auto-sync.
                    if (hasTriggeredForDateRef.current === targetDate) {
                        hasTriggeredForDateRef.current = null;
                    }
                }
                console.warn('[useAutoGarminSync] Failed to request auto sync:', err);
            });
    }, [userId, decisionInput, enabled]);
}
