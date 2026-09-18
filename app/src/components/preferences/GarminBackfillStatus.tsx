import { useGarminBackfillStatus } from '../../hooks/useGarminBackfillStatus';

export interface GarminBackfillStatusProps {
    userId: string;
}

/**
 * Shown under the Garmin connection card so a failed or stuck automatic historical
 * backfill (queued on first Garmin link, or by the daily sync's cold-start check --
 * see docs/ops/data-backfill-and-rebuild.md) isn't silently invisible to the athlete.
 * Renders nothing once the backfill has completed or when none was ever queued.
 */
export function GarminBackfillStatus({ userId }: GarminBackfillStatusProps) {
    const { status, request, retrying, localError, retryBackfill } = useGarminBackfillStatus(userId);

    if (status === 'in_progress') {
        return (
            <p className="preference-desc">
                Loading historical data (up to 56 days) to build recovery baselines…
            </p>
        );
    }

    if (status !== 'failed' && status !== 'stale') {
        return null;
    }

    const reason =
        localError || request?.error || (status === 'stale' ? 'It is taking longer than expected.' : null);

    return (
        <>
            <p className="error-message">
                Historical backfill didn't finish.{reason ? ` ${reason}` : ''}
            </p>
            <button
                type="button"
                className="auth-secondary-btn"
                onClick={() => void retryBackfill()}
                disabled={retrying}
            >
                {retrying ? 'Requesting…' : 'Retry loading history'}
            </button>
        </>
    );
}
