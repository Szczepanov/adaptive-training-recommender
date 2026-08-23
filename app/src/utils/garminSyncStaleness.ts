import type { GarminSyncRequest } from '../services/garminSyncRequestService';
import type { DailyRecoverySnapshot } from '../engine/models';

const IN_FLIGHT_STATUSES: ReadonlySet<GarminSyncRequest['status']> = new Set(['pending', 'processing']);

/** How long an outstanding request may sit in 'pending'/'processing' before it's
 * considered stale: GarminSyncNowButton gives up waiting and offers a retry, and
 * garminSyncRequestService.requestSync() treats an existing request past this age as
 * no longer blocking a fresh one. Generous relative to the garmin-manual-sync-poll's
 * 3-minute cadence, but bounded so a dead poller execution (deploy missing, crashed
 * mid-run) doesn't leave a request stuck forever. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Staleness threshold for a complete recovery snapshot (60 minutes). If an athlete
 * logs in and the snapshot was synced > 60 minutes ago, fresh metrics are fetched. */
export const SNAPSHOT_STALE_AFTER_MS = 60 * 60 * 1000;

/** Staleness threshold for an incomplete recovery snapshot (5 minutes). If a snapshot
 * is missing key recovery metrics (e.g. sleep/HRV/RHR still being finalized by Garmin),
 * a sync is retried sooner once 5 minutes have elapsed. */
export const INCOMPLETE_SNAPSHOT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Pure staleness check, shared by GarminSyncNowButton (so it's testable without a
 * render -- this repo has no interactive component-test harness, see
 * GarminSyncNowButton.test.tsx) and garminSyncRequestService (so a fresh "Sync Now"
 * click can't stomp a request that's still genuinely in flight).
 *
 * Measures from `claimedAt` once a request is 'processing', not `requestedAt`:
 * garmin-manual-sync-poll only ticks every 3 minutes, so a request can sit
 * 'pending' for a couple of those minutes before a worker ever claims it. Measuring
 * a 'processing' request's staleness from `requestedAt` would eat into that same
 * budget twice -- shrinking the actual in-flight margin to as little as
 * STALE_AFTER_MS minus the poll interval before a client retry is allowed to treat a
 * genuinely still-running worker as dead. `claimedAt` is when that worker actually
 * started, so it's the correct clock for "how long has this claim been running."
 */
export function isSyncRequestStale(
    request: GarminSyncRequest | null,
    nowMs: number,
    staleAfterMs: number = STALE_AFTER_MS
): boolean {
    if (!request || !IN_FLIGHT_STATUSES.has(request.status)) return false;
    const referenceTime = request.status === 'processing' && request.claimedAt ? request.claimedAt : request.requestedAt;
    const referenceMs = Date.parse(referenceTime);
    if (Number.isNaN(referenceMs)) return false;
    return nowMs - referenceMs > staleAfterMs;
}

export function isSyncRequestInFlight(request: GarminSyncRequest | null): boolean {
    return !!request && IN_FLIGHT_STATUSES.has(request.status);
}

/**
 * Determines whether a user's recovery snapshot for targetDate requires a fresh sync.
 * Returns true if:
 * 1. No snapshot exists or snapshot is from a different calendar date.
 * 2. Snapshot has missing/unfinalized core biomarkers and is older than incompleteStalenessMs (5m).
 * 3. Snapshot was synced longer than stalenessMs (60m) ago.
 */
export function isRecoverySnapshotStale(
    snapshot: DailyRecoverySnapshot | null | undefined,
    targetDate: string,
    nowMs: number = Date.now(),
    stalenessMs: number = SNAPSHOT_STALE_AFTER_MS,
    incompleteStalenessMs: number = INCOMPLETE_SNAPSHOT_STALE_AFTER_MS
): boolean {
    if (!snapshot || snapshot.date !== targetDate) {
        return true;
    }

    const syncedAt = snapshot.source?.garminSyncedAt;
    if (!syncedAt) {
        return true;
    }

    const syncedMs = Date.parse(syncedAt);
    if (Number.isNaN(syncedMs)) {
        return true;
    }

    const ageMs = nowMs - syncedMs;
    const isComplete =
        Boolean(snapshot.dataQuality?.sleepScoreAvailable) &&
        Boolean(snapshot.dataQuality?.restingHrAvailable) &&
        Boolean(snapshot.dataQuality?.hrvAvailable) &&
        snapshot.raw?.sleepScore != null &&
        snapshot.raw?.restingHr != null &&
        snapshot.raw?.hrvOvernightAvg != null;

    if (!isComplete) {
        return ageMs >= incompleteStalenessMs;
    }

    return ageMs >= stalenessMs;
}
