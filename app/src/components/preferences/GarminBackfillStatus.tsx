import { useGarminBackfillStatus } from '../../hooks/useGarminBackfillStatus';

export interface GarminBackfillStatusProps {
    userId: string;
}

/**
 * Shown under the Garmin connection card for request-backed historical backfills:
 * the automatic initial request queued on account link and any later manual retry.
 * The scheduled sync_daily cold-start safeguard executes its backfill directly and
 * does not publish through this request document; see docs/ops/data-backfill-and-rebuild.md.
 * Renders nothing once the queued request has completed or when none was ever queued.
 */
export function GarminBackfillStatus({ userId }: GarminBackfillStatusProps) {
    const { status, retrying, localError, retryBackfill } = useGarminBackfillStatus(userId);

    if (localError && status !== 'failed' && status !== 'stale') {
        return (
            <p className="error-message" role="alert">
                {localError}
            </p>
        );
    }

    if (status === 'in_progress') {
        return (
            <p className="preference-desc" role="status" aria-live="polite">
                Loading historical data (up to 56 days) to build recovery baselines…
            </p>
        );
    }

    if (status !== 'failed' && status !== 'stale') {
        return null;
    }

    // Backend failures may contain provider/library exception text intended for
    // operational logs, not end-user copy. Keep the UI actionable without echoing
    // those implementation details.
    const reason =
        localError || (status === 'stale' ? 'It is taking longer than expected.' : 'Try loading history again.');

    return (
        <>
            <p className="error-message" role="alert">
                Historical Garmin data didn't finish loading. {reason}
            </p>
            <button
                type="button"
                className="auth-secondary-btn"
                onClick={() => void retryBackfill()}
                disabled={retrying}
                aria-busy={retrying}
            >
                {retrying ? 'Requesting…' : 'Retry loading history'}
            </button>
        </>
    );
}
