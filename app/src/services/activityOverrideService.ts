import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ActivityOverride } from '../engine/models';

export class ActivityOverrideService {
    private readonly collectionName = 'activity_overrides';

    private getDocRef(userId: string, activityId: string) {
        return doc(getDb(), 'users', userId, this.collectionName, activityId);
    }

    private getCollectionRef(userId: string) {
        return collection(getDb(), 'users', userId, this.collectionName);
    }

    async getOverride(userId: string, activityId: string): Promise<ActivityOverride | null> {
        try {
            const snap = await getDoc(this.getDocRef(userId, activityId));
            if (!snap.exists()) return null;
            return snap.data() as ActivityOverride;
        } catch (error) {
            console.warn(`Failed to read activity override for ${activityId}:`, error);
            return null;
        }
    }

    async getAllOverrides(userId: string): Promise<Record<string, ActivityOverride>> {
        try {
            const snap = await getDocs(this.getCollectionRef(userId));
            const overrides: Record<string, ActivityOverride> = {};
            snap.forEach((docSnap) => {
                const data = docSnap.data() as ActivityOverride;
                if (data && data.activityId) {
                    overrides[data.activityId] = data;
                }
            });
            return overrides;
        } catch (error) {
            console.warn('Failed to read all activity overrides:', error);
            return {};
        }
    }

    async saveOverride(userId: string, override: ActivityOverride): Promise<boolean> {
        try {
            await setDoc(this.getDocRef(userId, override.activityId), override);
            return true;
        } catch (error) {
            console.error(`Failed to save activity override for ${override.activityId}:`, error);
            return false;
        }
    }

    async deleteOverride(userId: string, activityId: string): Promise<boolean> {
        try {
            await deleteDoc(this.getDocRef(userId, activityId));
            return true;
        } catch (error) {
            console.error(`Failed to delete activity override for ${activityId}:`, error);
            return false;
        }
    }
}

export const activityOverrideService = new ActivityOverrideService();
