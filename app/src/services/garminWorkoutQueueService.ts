import { doc, getDoc, setDoc, onSnapshot, collection } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

export interface GarminQueuedWorkout {
    userId: string;
    date: string;
    workoutTitle: string;
    modality: string;
    status: 'pending' | 'synced' | 'failed';
    queuedAt: string;
    syncedAt?: string | null;
    error?: string | null;
    payload: CanonicalWorkoutExport;
}

export class GarminWorkoutQueueService {
    async queueWorkout(userId: string, date: string, payload: CanonicalWorkoutExport): Promise<void> {
        const db = getDb();
        const ref = doc(db, `users/${userId}/garmin_workout_queue/${date}`);
        const data: GarminQueuedWorkout = {
            userId,
            date,
            workoutTitle: payload.title,
            modality: payload.modality,
            status: 'pending',
            queuedAt: new Date().toISOString(),
            syncedAt: null,
            error: null,
            payload,
        };
        await setDoc(ref, data);
    }

    async getQueueItem(userId: string, date: string): Promise<GarminQueuedWorkout | null> {
        const db = getDb();
        const ref = doc(db, `users/${userId}/garmin_workout_queue/${date}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        return snap.data() as GarminQueuedWorkout;
    }

    subscribeToQueueItem(
        userId: string,
        date: string,
        onUpdate: (item: GarminQueuedWorkout | null) => void,
        onError?: (err: Error) => void
    ): () => void {
        const db = getDb();
        const ref = doc(db, `users/${userId}/garmin_workout_queue/${date}`);
        return onSnapshot(
            ref,
            (snap) => {
                if (!snap.exists()) {
                    onUpdate(null);
                } else {
                    onUpdate(snap.data() as GarminQueuedWorkout);
                }
            },
            (error) => {
                if (onError) {
                    onError(error);
                } else {
                    console.error('[GarminWorkoutQueueService] Subscription error:', error);
                }
            }
        );
    }

    subscribeToUserQueue(
        userId: string,
        onUpdate: (items: GarminQueuedWorkout[]) => void,
        onError?: (err: Error) => void
    ): () => void {
        const db = getDb();
        const collRef = collection(db, `users/${userId}/garmin_workout_queue`);
        return onSnapshot(
            collRef,
            (querySnapshot) => {
                const items: GarminQueuedWorkout[] = [];
                querySnapshot.forEach((d) => {
                    if (d.exists()) {
                        items.push(d.data() as GarminQueuedWorkout);
                    }
                });
                onUpdate(items);
            },
            (error) => {
                if (onError) {
                    onError(error);
                } else {
                    console.error('[GarminWorkoutQueueService] User queue subscription error:', error);
                }
            }
        );
    }
}

export const garminWorkoutQueueService = new GarminWorkoutQueueService();

