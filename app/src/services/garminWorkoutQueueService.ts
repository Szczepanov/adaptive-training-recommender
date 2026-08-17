import { doc, getDoc, setDoc } from 'firebase/firestore';
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
}

export const garminWorkoutQueueService = new GarminWorkoutQueueService();
