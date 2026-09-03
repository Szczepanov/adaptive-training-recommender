import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';

export interface GarminConnectionData {
    status?: string;
    linkedAt?: unknown;
}

export const garminConnectionService = {
    subscribeToGarminConnection(
        userId: string,
        callback: (connected: boolean) => void,
        onError?: (err: Error) => void,
    ): () => void {
        const ref = doc(getDb(), 'users', userId, 'connections', 'garmin');
        return onSnapshot(
            ref,
            (snap) => {
                const isConnected = snap.exists() && snap.data()?.status === 'active';
                callback(isConnected);
            },
            (err) => {
                if (onError) onError(err);
                else callback(false);
            },
        );
    },

    async isGarminConnected(userId: string): Promise<boolean> {
        try {
            const ref = doc(getDb(), 'users', userId, 'connections', 'garmin');
            const snap = await getDoc(ref);
            return snap.exists() && snap.data()?.status === 'active';
        } catch {
            return false;
        }
    },
};
