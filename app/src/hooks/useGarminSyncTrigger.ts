import { useState, useEffect, useRef, useCallback } from 'react';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import { isAwaitedSyncTerminal } from '../utils/garminSyncRequestState';
import { isSyncRequestInFlight, isSyncRequestStale } from '../utils/garminSyncStaleness';
import { triggerGarminShadowReconciliationSweep } from '../training-occurrence';

export interface UseGarminSyncTriggerResult {
    request: GarminSyncRequest | null;
    triggering: boolean;
    localError: string | null;
    isInFlight: boolean;
    isStale: boolean;
    triggerSync: () => Promise<string | null>;
}

/**
 * Shared "Sync Now" plumbing for the Garmin manual sync request
 * (`users/{userId}/garmin_sync_requests/latest`): subscribes to the shared request doc,
 * exposes its in-flight/staleness state, and provides a `triggerSync()` that writes a
 * fresh request and reconciles it against a possible race between the write resolving
 * and the realtime listener observing its own terminal snapshot. Used by both
 * GarminSyncNowButton and useGarminSyncStatus so this reconcile/staleness dance is
 * implemented once.
 */
export function useGarminSyncTrigger(
    userId: string | null | undefined,
    onSynced?: () => void
): UseGarminSyncTriggerResult {
    const [request, setRequest] = useState<GarminSyncRequest | null>(null);
    const [triggering, setTriggering] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const awaitingRequestedAtRef = useRef<string | null>(null);
    const onSyncedRef = useRef(onSynced);

    useEffect(() => {
        onSyncedRef.current = onSynced;
    }, [onSynced]);

    useEffect(() => {
        awaitingRequestedAtRef.current = null;
        setLocalError(null);
    }, [userId]);

    useEffect(() => {
        if (!userId) {
            setRequest(null);
            return;
        }

        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (next) => {
                setRequest(next);
                // A fresh update from the backend supersedes any stale client-side error
                // from a previous triggerSync() failure -- otherwise a transient write
                // failure would keep the badge pinned to 'failed' even after a later
                // sync (manual or auto-poller-driven) succeeds.
                setLocalError(null);
                if (isAwaitedSyncTerminal(next, awaitingRequestedAtRef.current)) {
                    awaitingRequestedAtRef.current = null;
                    onSyncedRef.current?.();
                    if (next?.status === 'completed') {
                        // PR 1 (ADR-0034) shadow reconciliation: fire-and-forget, never
                        // affects sync UX.
                        void triggerGarminShadowReconciliationSweep(userId)
                            .catch(sweepErr => console.warn('[training-occurrence] shadow reconciliation sweep failed', sweepErr));
                    }
                }
            },
            (err) => {
                console.error('[useGarminSyncTrigger] Subscription error:', err);
                setLocalError(err.message);
            }
        );

        return unsubscribe;
    }, [userId]);

    const isInFlight = isSyncRequestInFlight(request);

    // Firestore won't push a new snapshot if the poller execution that claimed this
    // request died mid-run -- the doc just sits at 'processing' forever. Re-checking
    // staleness on a timer (rather than only on snapshot updates) is what lets callers
    // notice and re-enable themselves.
    useEffect(() => {
        if (!isInFlight) return;
        const interval = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, [isInFlight]);

    const isStale = isSyncRequestStale(request, now);

    const triggerSync = useCallback(async (): Promise<string | null> => {
        if (!userId) return null;
        setTriggering(true);
        setLocalError(null);
        try {
            const requestedAt = await garminSyncRequestService.requestSync(userId);
            awaitingRequestedAtRef.current = requestedAt;

            // A request we join can finish between requestSync() resolving and the
            // awaiting timestamp being installed above. The realtime listener may have
            // already emitted that terminal snapshot while nothing was awaited, so do
            // one reconciliation read after installing the correlation key.
            try {
                const current = await garminSyncRequestService.getRequest(userId);
                if (
                    awaitingRequestedAtRef.current === requestedAt &&
                    isAwaitedSyncTerminal(current, requestedAt)
                ) {
                    awaitingRequestedAtRef.current = null;
                    onSyncedRef.current?.();
                    if (current?.status === 'completed') {
                        void triggerGarminShadowReconciliationSweep(userId)
                            .catch(sweepErr => console.warn('[training-occurrence] shadow reconciliation sweep failed', sweepErr));
                    }
                }
            } catch (reconcileErr) {
                // The realtime subscription remains the primary completion path; a
                // transient read failure is not a failed sync request.
                console.warn('[useGarminSyncTrigger] Failed to reconcile sync state:', reconcileErr);
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
    }, [userId]);

    return { request, triggering, localError, isInFlight, isStale, triggerSync };
}
