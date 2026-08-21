import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import { isSyncRequestInFlight, isSyncRequestStale } from '../utils/garminSyncStaleness';

export interface GarminSyncRequest {
    userId: string;
    /** 'processing'/'completed'/'failed' and claimId/claimedAt are Admin-SDK-only
     * transitions written by poll_manual_sync_requests's atomic claim -- the browser
     * (and Firestore rules) may only ever write 'pending'. */
    status: 'pending' | 'processing' | 'completed' | 'failed';
    requestedAt: string;
    claimId?: string;
    claimedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
}

/**
 * Manual "Sync Now" trigger for the Garmin recovery poll (D-GARMINSYNC): writes a
 * single fixed-id doc the garmin_sync Cloud Run Job's poll_manual_sync_requests polls
 * frequently (every few minutes, all day -- see docs/ops/cloud-run-deployment.md),
 * atomically claiming it and running an immediate forced sync when it sees
 * `status: 'pending'`. Mirrors garminWorkoutQueueService's queue-and-poll shape, just
 * with a single fixed doc instead of one per date -- only one manual sync can usefully
 * be in flight at a time.
 */
export class GarminSyncRequestService {
    private requestRef(userId: string) {
        return doc(getDb(), `users/${userId}/garmin_sync_requests/latest`);
    }

    /**
     * Queues a fresh sync request -- unless one is already live. A plain `setDoc`
     * here would unconditionally overwrite whatever's there, including a
     * currently-claimed 'processing' request: that erases its claimId, and the next
     * poller tick would see a fresh 'pending' doc and claim it too, running a second
     * concurrent Garmin sync for what's really the same ask (e.g. a second browser
     * tab/device, or a click racing the first onSnapshot update). Reading the
     * existing doc inside a transaction and only writing when it's absent, terminal,
     * or stale closes that gap: a genuinely still-in-flight request is left alone,
     * and this call resolves as a no-op (the caller's own subscription already
     * reflects that in-flight state).
     */
    async requestSync(userId: string): Promise<void> {
        const ref = this.requestRef(userId);
        const now = Date.now();
        await runTransaction(getDb(), async (transaction) => {
            const snap = await transaction.get(ref);
            const existing = snap.exists() ? (snap.data() as GarminSyncRequest) : null;
            if (existing && isSyncRequestInFlight(existing) && !isSyncRequestStale(existing, now)) {
                return;
            }
            const data: GarminSyncRequest = {
                userId,
                status: 'pending',
                requestedAt: new Date(now).toISOString(),
                completedAt: null,
                error: null,
            };
            transaction.set(ref, data);
        });
    }

    async getRequest(userId: string): Promise<GarminSyncRequest | null> {
        const snap = await getDoc(this.requestRef(userId));
        if (!snap.exists()) return null;
        return snap.data() as GarminSyncRequest;
    }

    subscribeToRequest(
        userId: string,
        onUpdate: (request: GarminSyncRequest | null) => void,
        onError?: (err: Error) => void
    ): () => void {
        return onSnapshot(
            this.requestRef(userId),
            (snap) => {
                onUpdate(snap.exists() ? (snap.data() as GarminSyncRequest) : null);
            },
            (error) => {
                if (onError) {
                    onError(error);
                } else {
                    console.error('[GarminSyncRequestService] Subscription error:', error);
                }
            }
        );
    }
}

export const garminSyncRequestService = new GarminSyncRequestService();
