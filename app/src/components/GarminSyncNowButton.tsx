import { useState, useEffect, useRef, useCallback } from 'react';
import { garminSyncRequestService, type GarminSyncRequest } from '../services/garminSyncRequestService';
import './GarminSyncNowButton.css';

export interface GarminSyncNowButtonProps {
    userId: string;
    /** Called once a request this button made finishes (successfully or not), so the
     * caller can reload whatever data the sync may have just refreshed. */
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
    const awaitingOwnRequest = useRef(false);

    useEffect(() => {
        if (!userId) return;
        const unsubscribe = garminSyncRequestService.subscribeToRequest(
            userId,
            (next) => {
                setRequest(next);
                if (awaitingOwnRequest.current && next && next.status !== 'pending') {
                    awaitingOwnRequest.current = false;
                    onSynced?.();
                }
            },
            (err) => console.error('[GarminSyncNowButton] Subscription error:', err)
        );
        return unsubscribe;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const handleClick = useCallback(async () => {
        setTriggering(true);
        setLocalError(null);
        awaitingOwnRequest.current = true;
        try {
            await garminSyncRequestService.requestSync(userId);
        } catch (err) {
            console.error('Failed to request Garmin sync:', err);
            setLocalError('Could not request sync — try again.');
            awaitingOwnRequest.current = false;
        } finally {
            setTriggering(false);
        }
    }, [userId]);

    const isPending = triggering || request?.status === 'pending';
    const label = isPending
        ? 'Syncing…'
        : request?.status === 'failed'
        ? '⚠️ Retry sync'
        : '🔄 Sync now';
    const title = isPending
        ? 'Requesting the latest Garmin data — usually resolves within a few minutes'
        : 'Force an immediate Garmin sync instead of waiting for the next scheduled poll';

    return (
        <span className="garmin-sync-now">
            <button
                type="button"
                className="garmin-sync-now-btn"
                onClick={(e) => { e.stopPropagation(); handleClick(); }}
                disabled={isPending}
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
