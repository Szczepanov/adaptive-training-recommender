import type { GarminSyncRequest } from '../services/garminSyncRequestService';

const IN_FLIGHT_STATUSES: ReadonlySet<GarminSyncRequest['status']> = new Set(['pending', 'processing']);

/** How long an outstanding request may sit in 'pending'/'processing' before
 * GarminSyncNowButton gives up waiting and offers a retry -- generous relative to the
 * garmin-manual-sync-poll's 3-minute cadence, but bounded so a dead poller execution
 * (deploy missing, crashed mid-run) doesn't leave the button stuck on "Syncing…"
 * forever. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Pure staleness check, factored out of GarminSyncNowButton so it's testable
 * without a render (this repo has no interactive component-test harness -- see
 * GarminSyncNowButton.test.tsx). */
export function isSyncRequestStale(
    request: GarminSyncRequest | null,
    nowMs: number,
    staleAfterMs: number = STALE_AFTER_MS
): boolean {
    if (!request || !IN_FLIGHT_STATUSES.has(request.status)) return false;
    const requestedAtMs = Date.parse(request.requestedAt);
    if (Number.isNaN(requestedAtMs)) return false;
    return nowMs - requestedAtMs > staleAfterMs;
}

export function isSyncRequestInFlight(request: GarminSyncRequest | null): boolean {
    return !!request && IN_FLIGHT_STATUSES.has(request.status);
}
