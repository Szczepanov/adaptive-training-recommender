import { useGarminSyncTrigger } from '../hooks/useGarminSyncTrigger';
import './GarminSyncNowButton.css';

export function ActivityDetailsFetchButton({ userId, activityId, hasLaps, onFetched }: {
    userId: string;
    activityId: string;
    hasLaps?: boolean;
    onFetched?: () => void;
}) {
    const { request, triggering, localError, isInFlight, isStale, triggerSync } =
        useGarminSyncTrigger(userId, onFetched, activityId);
    const ownRequest = request?.requestType === 'activity_details' && request.activityId === activityId;
    const busy = triggering || (isInFlight && !isStale);
    const message = localError || (ownRequest
        ? request.status === 'failed' ? request.error || 'Details unavailable. Try again.'
            : isStale ? 'Request delayed. You can retry.'
                : request.status === 'pending' ? 'Queued for the next Garmin sync check (up to 15 minutes).'
                    : request.status === 'processing' ? 'Fetching activity details…'
                        : !hasLaps ? 'No laps returned by Garmin.' : 'Activity details refreshed.'
        : null);
    return (
        <div className="garmin-sync-now">
            <button type="button" className="garmin-sync-now-btn" disabled={busy}
                onClick={() => { void triggerSync(); }}>
                {triggering || (ownRequest && busy) ? 'Fetching activity details…'
                    : hasLaps ? 'Refresh activity details' : 'Fetch activity details'}
            </button>
            {message && <span role="status">{message}</span>}
        </div>
    );
}
