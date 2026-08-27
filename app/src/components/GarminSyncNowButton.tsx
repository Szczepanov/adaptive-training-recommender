import { useGarminSyncTrigger } from '../hooks/useGarminSyncTrigger';
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
    const { request, triggering, localError, isInFlight, isStale, triggerSync } =
        useGarminSyncTrigger(userId, onSynced);

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
                onClick={(e) => { e.stopPropagation(); void triggerSync(); }}
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
