import type { GarminSyncRequest } from '../services/garminSyncRequestService';

const IN_FLIGHT_STATUSES: ReadonlySet<GarminSyncRequest['status']> = new Set(['pending', 'processing']);

/** How long an outstanding request may sit in 'pending'/'processing' before it's
 * considered stale: GarminSyncNowButton gives up waiting and offers a retry, and
 * garminSyncRequestService.requestSync() treats an existing request past this age as
 * no longer blocking a fresh one. Generous relative to the garmin-manual-sync-poll's
 * 3-minute cadence, but bounded so a dead poller execution (deploy missing, crashed
 * mid-run) doesn't leave a request stuck forever. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Pure staleness check, shared by GarminSyncNowButton (so it's testable without a
 * render -- this repo has no interactive component-test harness, see
 * GarminSyncNowButton.test.tsx) and garminSyncRequestService (so a fresh "Sync Now"
 * click can't stomp a request that's still genuinely in flight). */
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
