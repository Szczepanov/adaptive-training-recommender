import type { GarminSyncRequest } from '../services/garminSyncRequestService';

export type AwaitedSyncOutcome = 'completed' | 'failed' | null;

/** Classify a shared fixed-id request snapshot only when it belongs to the exact
 * request timestamp returned by requestSync(). */
export function getAwaitedSyncOutcome(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): AwaitedSyncOutcome {
    if (!awaitingRequestedAt || !request || request.requestedAt !== awaitingRequestedAt) {
        return null;
    }
    if (request.status === 'completed' || request.status === 'failed') {
        return request.status;
    }
    return null;
}

export function isAwaitedSyncComplete(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): boolean {
    return getAwaitedSyncOutcome(request, awaitingRequestedAt) === 'completed';
}

export function isAwaitedSyncTerminal(
    request: GarminSyncRequest | null,
    awaitingRequestedAt: string | null
): boolean {
    return getAwaitedSyncOutcome(request, awaitingRequestedAt) !== null;
}
