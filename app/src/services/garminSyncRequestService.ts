import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';

export interface GarminSyncRequest {
    userId: string;
    status: 'pending' | 'completed' | 'failed';
    requestedAt: string;
    completedAt?: string | null;
    error?: string | null;
}

/**
 * Manual "Sync Now" trigger for the Garmin recovery poll (D-GARMINSYNC): writes a
 * single fixed-id doc the garmin_sync Cloud Run Job's poll_manual_sync_requests polls
 * frequently (every few minutes, all day -- see docs/ops/cloud-run-deployment.md),
 * running an immediate forced sync when it sees `status: 'pending'`. Mirrors
 * garminWorkoutQueueService's queue-and-poll shape, just with a single fixed doc
 * instead of one per date -- only one manual sync can usefully be in flight at a time.
 */
export class GarminSyncRequestService {
    private requestRef(userId: string) {
        return doc(getDb(), `users/${userId}/garmin_sync_requests/latest`);
    }

    async requestSync(userId: string): Promise<void> {
        const data: GarminSyncRequest = {
            userId,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
        };
        await setDoc(this.requestRef(userId), data);
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
