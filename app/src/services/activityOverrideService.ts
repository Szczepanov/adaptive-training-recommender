import { collection, doc, getDoc, query, setDoc, deleteDoc, where } from 'firebase/firestore';
import { getDocsRetained } from './firestoreReadRetention';
import { getDb } from '../firebase';
import type { ActivityOverride } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { assertValidActivityOverride, validateActivityOverride } from '../ledger/activityOverrideValidation';

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
            const data = snap.data();
            const issues = validateActivityOverride(data);
            if (issues.length > 0) {
                console.warn(`Skipping unreadable activity override ${activityId}: ${issues.map(issue => issue.path).join(', ')}`);
                return null;
            }
            return data as ActivityOverride;
        } catch (error) {
            console.warn(`Failed to read activity override for ${activityId}:`, error);
            return null;
        }
    }

    async getAllOverrides(userId: string): Promise<Record<string, ActivityOverride>> {
        try {
            const snap = await getDocsRetained(this.getCollectionRef(userId));
            const overrides: Record<string, ActivityOverride> = {};
            snap.forEach((docSnap) => {
                const data = docSnap.data() as ActivityOverride;
                if (!data || !data.activityId) return;
                const issues = validateActivityOverride(data);
                if (issues.length > 0) {
                    console.warn(`Skipping unreadable activity override ${data.activityId}: ${issues.map(issue => issue.path).join(', ')}`);
                    return;
                }
                overrides[data.activityId] = data;
            });
            return overrides;
        } catch (error) {
            console.warn('Failed to read all activity overrides:', error);
            return {};
        }
    }

    /** Overrides for activities dated on/after `fromDate` (Warsaw calendar date). Unlike
     * `getAllOverrides`, a failed read is reported as UNAVAILABLE instead of being collapsed
     * into "no overrides", so read-only exports can say the source is unknown. */
    async getOverridesSinceState(userId: string, fromDate: string): Promise<DataState<Record<string, ActivityOverride>>> {
        try {
            const snap = await getDocsRetained(query(this.getCollectionRef(userId), where('date', '>=', fromDate)));
            const overrides: Record<string, ActivityOverride> = {};
            const skipped: DataIssue[] = [];
            snap.forEach((docSnap) => {
                const data = docSnap.data() as ActivityOverride;
                if (!data || !data.activityId) return;
                const issues = validateActivityOverride(data);
                if (issues.length > 0) {
                    // Skip and report, as the strength-session range read does: the invalid
                    // document is not presented as a correction, and the caller can see it.
                    skipped.push(...issues.map(issue => ({
                        code: 'invalid-activity-override',
                        field: issue.path || undefined,
                        documentPath: `users/${userId}/${this.collectionName}/${docSnap.id ?? data.activityId}`,
                    })));
                    return;
                }
                overrides[data.activityId] = data;
            });
            return { status: 'AVAILABLE', data: overrides, revision: null, ...(skipped.length > 0 ? { issues: skipped } : {}) };
        } catch (error) {
            console.warn('Failed to read activity overrides:', error);
            return { status: 'UNAVAILABLE', operation: 'read activity overrides', retryable: true };
        }
    }

    async saveOverride(userId: string, override: ActivityOverride): Promise<boolean> {
        try {
            // Issue #1202 (ADR-0053): the rules no longer check these values.
            assertValidActivityOverride(override);
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
