import type { GarminSyncRequest } from '../services/garminSyncRequestService';
import { isSyncRequestStale } from './garminSyncStaleness';

export type GarminBackfillStatus = 'none' | 'in_progress' | 'stale' | 'failed';

const BACKFILL_REQUEST_TYPES: ReadonlySet<NonNullable<GarminSyncRequest['requestType']>> = new Set([
    'initial_backfill',
    'backfill',
]);

export function isGarminBackfillRequest(request: GarminSyncRequest | null): boolean {
    return !!request?.requestType && BACKFILL_REQUEST_TYPES.has(request.requestType);
}

/**
 * Classifies the shared users/{uid}/garmin_sync_requests/latest doc for request-backed
 * historical backfills (account_link.py queues the initial request; later retries use
 * the same document). GarminSyncService.sync_daily's scheduled cold-start safeguard
 * runs directly and is intentionally outside this request-status surface. See
 * docs/ops/data-backfill-and-rebuild.md. A UI can therefore decide whether to show progress
 * or offer a retry without duplicating the requestType/staleness rules already
 * established for the "Sync Now" button (garminSyncStaleness.ts).
 *
 * Returns 'none' both when the doc holds an unrelated request (e.g. a plain manual
 * "Sync Now" sitting on the same doc) and once a backfill has completed -- neither
 * case has anything for the athlete to act on.
 */
export function getGarminBackfillStatus(
    request: GarminSyncRequest | null,
    nowMs: number
): GarminBackfillStatus {
    if (!isGarminBackfillRequest(request)) return 'none';
    if (request!.status === 'failed') return 'failed';
    if (isSyncRequestStale(request, nowMs)) return 'stale';
    if (request!.status === 'pending' || request!.status === 'processing') return 'in_progress';
    return 'none';
}
