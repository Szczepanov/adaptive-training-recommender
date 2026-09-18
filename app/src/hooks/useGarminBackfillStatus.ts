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
    // Guards against a retry's async completion landing after a newer retry (or a user
    // change) has already moved on -- without this, a slow failed attempt could overwrite
    // state a more recent attempt already resolved.
    const retryGenerationRef = useRef(0);

    useEffect(() => {
        userIdRef.current = userId;
        retryGenerationRef.current += 1;
        setLocalError(null);
        setRetrying(false);
        if (!userId) {
            setRequest(null);
            return;
        }

        let active = true;
        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (next) => {
                if (!active) return;
                setRequest(next);
                setLocalError(null);
            },
            (err) => {
                if (!active) return;
                console.error('[useGarminBackfillStatus] Subscription error:', err);
                setLocalError('Could not refresh historical load status — try again later.');
            }
        );

        return () => {
            active = false;
            unsubscribe();
        };
    }, [userId]);

    // React preserves state across prop changes. Never let the previous user's last
    // snapshot flash as the new user's history status while the new subscription is
    // being installed.
    const currentRequest = request?.userId === userId ? request : null;
    const status = getGarminBackfillStatus(currentRequest, now);

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
        const uid = userId;
        if (!uid) return;
        const generation = (retryGenerationRef.current += 1);
        setRetrying(true);
        setLocalError(null);
        try {
            await garminSyncRequestService.requestBackfill(uid);
        } catch (err) {
            console.error('[useGarminBackfillStatus] Failed to request backfill retry:', err);
            if (userIdRef.current === uid && retryGenerationRef.current === generation) {
                setLocalError('Could not request a retry — try again.');
            }
        } finally {
            if (userIdRef.current === uid && retryGenerationRef.current === generation) {
                setRetrying(false);
            }
        }
    }, [userId]);

    return { request: currentRequest, status, retrying, localError, retryBackfill };
}
