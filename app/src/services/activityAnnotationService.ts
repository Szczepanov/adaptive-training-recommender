import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';

export interface LapAnnotation {
    averagePowerWatts: number | null;
    rpe: number | null;
    source: 'manual';
}

export interface ActivityAnnotation {
    rpe: number | null;
    equipmentLabel: string | null;
    source: 'manual';
}

function validatePath(userId: string, activityId: string): void {
    if ([userId, activityId].some(id => !id || id.includes('/') || id === '.' || id === '..')) {
        throw new Error('User and activity IDs must be nonempty path segments');
    }
}

function validLapIndex(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableNumber(value: unknown, min: number, max: number): value is number | null {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

function validLap(value: Record<string, unknown>): boolean {
    return nullableNumber(value.averagePowerWatts, 0, 10000) && nullableNumber(value.rpe, 1, 10);
}

function validActivity(value: Record<string, unknown>): boolean {
    return nullableNumber(value.rpe, 1, 10) && (value.equipmentLabel === null
        || (typeof value.equipmentLabel === 'string' && value.equipmentLabel.length >= 1
            && value.equipmentLabel.length <= 100 && value.equipmentLabel.trim() === value.equipmentLabel));
}

export const activityAnnotationService = {
    async getLapAnnotations(userId: string, activityId: string): Promise<Record<string, LapAnnotation>> {
        validatePath(userId, activityId);
        const snapshot = await getDocs(collection(getDb(), 'users', userId, 'activity_annotations', activityId, 'laps'));
        const annotations: Record<string, LapAnnotation> = {};
        for (const document of snapshot.docs) {
            const data = document.data();
            if (!data || Object.keys(data).length !== 4 || data.source !== 'manual'
                || !validLapIndex(data.lapIndex) || String(data.lapIndex) !== document.id
                || !validLap(data) || (data.averagePowerWatts === null && data.rpe === null)) {
                throw new Error('Invalid manual lap annotation');
            }
            annotations[document.id] = { averagePowerWatts: data.averagePowerWatts, rpe: data.rpe, source: 'manual' };
        }
        return annotations;
    },

    async saveLapAnnotation(userId: string, activityId: string, lapIndex: number, annotation: Omit<LapAnnotation, 'source'>): Promise<void> {
        validatePath(userId, activityId);
        if (!validLapIndex(lapIndex) || !validLap(annotation)) throw new Error('Invalid lap annotation');
        const ref = doc(getDb(), 'users', userId, 'activity_annotations', activityId, 'laps', String(lapIndex));
        if (annotation.averagePowerWatts === null && annotation.rpe === null) {
            await deleteDoc(ref);
        } else {
            await setDoc(ref, { lapIndex, averagePowerWatts: annotation.averagePowerWatts, rpe: annotation.rpe, source: 'manual' });
        }
    },

    async getActivityAnnotation(userId: string, activityId: string): Promise<ActivityAnnotation | null> {
        validatePath(userId, activityId);
        const snapshot = await getDoc(doc(getDb(), 'users', userId, 'activity_annotations', activityId));
        if (!snapshot.exists()) return null;
        const data = snapshot.data();
        if (!data || Object.keys(data).length !== 3 || data.source !== 'manual' || !validActivity(data)) {
            throw new Error('Invalid manual activity annotation');
        }
        return { rpe: data.rpe, equipmentLabel: data.equipmentLabel, source: 'manual' };
    },

    async saveActivityAnnotation(userId: string, activityId: string, annotation: Omit<ActivityAnnotation, 'source'>): Promise<void> {
        validatePath(userId, activityId);
        const equipmentLabel = annotation.equipmentLabel === null ? null : annotation.equipmentLabel.trim() || null;
        const data = { rpe: annotation.rpe, equipmentLabel, source: 'manual' as const };
        if (!validActivity(data)) throw new Error('Invalid activity annotation');
        // Explicit nulls suppress legacy effort instead of restoring it on the next read.
        await setDoc(doc(getDb(), 'users', userId, 'activity_annotations', activityId), data);
    },
};
