import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';
import { garminAuthService } from './garminAuthService';

export type GarminConnectionState = 'connected' | 'disconnected' | 'unknown';

export interface GarminConnectionResult {
    state: GarminConnectionState;
    linkedAt?: unknown;
    error?: Error;
}

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error('Could not verify Garmin connection status.');
}

async function reconcileWithCanonicalStatus(): Promise<GarminConnectionResult> {
    try {
        const status = await garminAuthService.getConnectionStatus();
        return status.status === 'active'
            ? { state: 'connected', linkedAt: status.linkedAt }
            : { state: 'disconnected' };
    } catch (error: unknown) {
        return { state: 'unknown', error: asError(error) };
    }
}

/**
 * Reads the non-secret Firestore mirror first and falls back to the authenticated
 * canonical status endpoint whenever the mirror is absent or unreadable (ADR-0029).
 * A failed reconciliation stays `unknown`; it must never be presented as disconnected.
 */
export const garminConnectionService = {
    async getConnectionState(userId: string): Promise<GarminConnectionResult> {
        try {
            const ref = doc(getDb(), 'users', userId, 'connections', 'garmin');
            const snap = await getDoc(ref);
            if (snap.exists() && snap.data()?.status === 'active') {
                return { state: 'connected', linkedAt: snap.data()?.linkedAt };
            }
        } catch {
            // The canonical authenticated endpoint remains authoritative when the mirror
            // cannot be read, so reconcile there before declaring the status unknown.
        }
        return reconcileWithCanonicalStatus();
    },

    subscribeToGarminConnection(
        userId: string,
        callback: (result: GarminConnectionResult) => void,
    ): () => void {
        let cancelled = false;
        let observationRevision = 0;
        const ref = doc(getDb(), 'users', userId, 'connections', 'garmin');

        const reconcile = async (revision: number) => {
            const result = await reconcileWithCanonicalStatus();
            if (!cancelled && revision === observationRevision) callback(result);
        };

        const unsubscribe = onSnapshot(
            ref,
            (snap) => {
                const revision = ++observationRevision;
                if (snap.exists() && snap.data()?.status === 'active') {
                    callback({ state: 'connected', linkedAt: snap.data()?.linkedAt });
                    return;
                }
                // Older links may not have a mirror. The status endpoint transactionally
                // repairs it, so future loads return through the direct path.
                void reconcile(revision);
            },
            () => {
                // A Firestore outage is not proof that Garmin is disconnected.
                const revision = ++observationRevision;
                void reconcile(revision);
            },
        );

        return () => {
            cancelled = true;
            observationRevision += 1;
            unsubscribe();
        };
    },
};
