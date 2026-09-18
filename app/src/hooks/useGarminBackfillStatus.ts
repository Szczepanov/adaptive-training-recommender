import { useCallback, useEffect, useRef, useState } from 'react';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import { getGarminBackfillStatus, type GarminBackfillStatus } from '../utils/garminBackfillStatus';

export interface UseGarminBackfillStatusResult {
    request: GarminSyncRequest | null;
    status: GarminBackfillStatus;
    retrying: boolean;
    localError: string | null;
    retryBackfill: () => Promise<void>;
}

/**
 * Surfaces request-backed historical backfills (the initial account-link request
 * and later manual retries) and offers a retry when one failed or the claimed poller
 * run went stale -- see docs/ops/data-backfill-and-rebuild.md. Reuses the same
 * users/{uid}/garmin_sync_requests/latest doc as useGarminSyncTrigger/
 * GarminSyncNowButton; getGarminBackfillStatus filters out an ordinary "Sync Now"
 * request sitting on the same doc.
 */
export function useGarminBackfillStatus(userId: string | null | undefined): UseGarminBackfillStatusResult {
    const [request, setRequest] = useState<GarminSyncRequest | null>(null);
    const [retrying, setRetrying] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const userIdRef = useRef(userId);
    // Keep identity current synchronously with render. An effect-only update leaves a
    // small window after an account switch where a fast retry click could target the
    // previous user's request document.
    userIdRef.current = userId;

    useEffect(() => {
        setLocalError(null);
        setRetrying(false);
        if (!userId) {
            setRequest(null);
            return;
        }

        const subscribedUserId = userId;
        return garminSyncRequestService.subscribeToRequest(
            subscribedUserId,
            (next) => {
                if (userIdRef.current !== subscribedUserId) return;
                setRequest(next);
                setLocalError(null);
            },
            (err) => {
                if (userIdRef.current !== subscribedUserId) return;
                console.error('[useGarminBackfillStatus] Subscription error:', err);
                setLocalError('Could not refresh historical load status — try again later.');
            }
        );
    }, [userId]);

    const status = getGarminBackfillStatus(request, now);

    // Firestore won't push a new snapshot if the poller execution that claimed this
    // request died mid-run -- the doc just sits at 'processing' forever. Re-checking
    // staleness on a timer (rather than only on snapshot updates) is what lets the
    // retry option appear without requiring a reload.
    useEffect(() => {
        if (status !== 'in_progress') return;
        const interval = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, [status]);

    const retryBackfill = useCallback(async () => {
        const uid = userIdRef.current;
        if (!uid) return;
        setRetrying(true);
        setLocalError(null);
        try {
            await garminSyncRequestService.requestBackfill(uid);
        } catch (err) {
            console.error('[useGarminBackfillStatus] Failed to request backfill retry:', err);
            if (userIdRef.current === uid) {
                setLocalError('Could not request a retry — try again.');
            }
        } finally {
            if (userIdRef.current === uid) {
                setRetrying(false);
            }
        }
    }, []);

    return { request, status, retrying, localError, retryBackfill };
}
