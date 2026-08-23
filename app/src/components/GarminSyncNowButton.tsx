import { useState, useEffect, useRef, useCallback } from 'react';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import { isAwaitedSyncTerminal } from '../utils/garminSyncRequestState';
import { isSyncRequestStale, isSyncRequestInFlight } from '../utils/garminSyncStaleness';
import './GarminSyncNowButton.css';

export interface GarminSyncNowButtonProps {
    userId: string;
    /** Called once a request this button made or joined finishes (successfully or not),
     * so the caller can reload whatever data the sync may have just refreshed. */
    onSynced?: () => void;
}

/**
 * Manual override for the Garmin morning poll window (docs/ops/cloud-run-deployment.md):
 * lets an athlete who's up before ~5am (or just wants the latest numbers) force an
 * immediate sync instead of waiting for the next scheduled tick. Writes a request via
 * garminSyncRequestService and watches it resolve.
 */
export function GarminSyncNowButton({ userId, onSynced }: GarminSyncNowButtonProps) {
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
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (next) => {
                setRequest(next);
                if (isAwaitedSyncTerminal(next, awaitingRequestedAtRef.current)) {
                    awaitingRequestedAtRef.current = null;
                    onSyncedRef.current?.();
                }
            },
            (err) => console.error('[GarminSyncNowButton] Subscription error:', err)
        );
        return unsubscribe;
    }, [userId]);

    const isInFlight = isSyncRequestInFlight(request);

    // Firestore won't push a new snapshot if the poller execution that claimed this
    // request died mid-run -- the doc just sits at 'processing' forever. Re-checking
    // staleness on a timer (rather than only on snapshot updates) is what lets the
    // button notice and re-enable itself.
    useEffect(() => {
        if (!isInFlight) return;
        const interval = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, [isInFlight]);

    const isStale = isSyncRequestStale(request, now);

    const handleClick = useCallback(async () => {
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
                }
            } catch (err) {
                // The realtime subscription remains the primary completion path; a
                // transient read failure is not a failed sync request.
                console.warn('[GarminSyncNowButton] Failed to reconcile sync state:', err);
            }
        } catch (err) {
            console.error('Failed to request Garmin sync:', err);
            setLocalError('Could not request sync — try again.');
            awaitingRequestedAtRef.current = null;
        } finally {
            setTriggering(false);
        }
    }, [userId]);

    const isBusy = (triggering || isInFlight) && !isStale;
    const label = isStale
        ? '⚠️ Sync delayed — retry'
        : isBusy
        ? 'Syncing…'
        : request?.status === 'failed'
        ? '⚠️ Retry sync'
        : '🔄 Sync now';
    const title = isStale
        ? 'The last sync request is taking longer than expected — click to request it again'
        : isBusy
        ? 'Requesting the latest Garmin data — usually resolves within a few minutes'
        : 'Force an immediate Garmin sync instead of waiting for the next scheduled poll';

    return (
        <span className="garmin-sync-now">
            <button
                type="button"
                className="garmin-sync-now-btn"
                onClick={(e) => { e.stopPropagation(); handleClick(); }}
                disabled={isBusy}
                title={title}
            >
                {label}
            </button>
            {(localError || (request?.status === 'failed' && request.error)) && (
                <span className="garmin-sync-now-error">{localError || request?.error}</span>
            )}
        </span>
    );
}
