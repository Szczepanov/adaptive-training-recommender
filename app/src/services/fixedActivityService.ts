import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, addDoc, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { FixedActivity } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateFixedActivity } from '../engine/validation';
import { getErrorCode } from '../utils/errors';

type FixedActivityWithId = FixedActivity & { id: string };

/** Builds a document payload containing only stored fields -- `id` is the document key,
 *  not a stored field, mirroring goalService's storedGoalPayload. */
function storedActivityPayload(activity: FixedActivity): DocumentData {
    const payload: DocumentData = { ...activity };
    delete payload.id;
    return payload;
}

/**
 * Persists `FixedActivity` at `users/{userId}/fixed_activities/{activityId}` (ADR-0002
 * user-owned path) -- see docs/plans/phase-5-sequence-planning.md 5.3. Every write is
 * validated client-side against the same shape firestore.rules enforces server-side, so a
 * malformed document is rejected before the round trip rather than only at the rule.
 */
export class FixedActivityService {
    private readonly collectionPath = 'fixed_activities';

    /** All fixed activities whose `date` falls within [startDate, endDate] inclusive
     *  (YYYY-MM-DD, Warsaw-local strings compare lexicographically). This is the read the
     *  planner's week-ahead pipeline uses -- see WeekAheadOptions.fixedActivities. */
    async getActivitiesInRangeState(userId: string, startDate: string, endDate: string): Promise<DataState<FixedActivityWithId[]>> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(collRef, where('date', '>=', startDate), where('date', '<=', endDate));
            const querySnapshot = await getDocs(q);
            const activities: FixedActivityWithId[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const activityDoc of querySnapshot.docs) {
                const validation = validateFixedActivity({ ...activityDoc.data(), id: activityDoc.id });
                if (!validation.isValid || !validation.data || validation.data.userId !== userId) {
                    issues.push({ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${activityDoc.id}` });
                    continue;
                }
                activities.push({ ...validation.data, id: activityDoc.id });
                if (typeof activityDoc.data().updatedAt === 'string') revisions.push(`${activityDoc.id}:${activityDoc.data().updatedAt}`);
            }
            if (issues.length > 0) return { status: 'INVALID', issues };
            return { status: 'AVAILABLE', data: activities, revision: revisions.sort().join('|') || null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read fixed activities', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    /** Convenience wrapper for callers that just want the plain list (e.g. UI forms) and
     *  are fine treating any read failure as "no activities" -- the planner path above
     *  uses the State-returning variant so it can distinguish absence from failure. */
    async getActivitiesInRange(userId: string, startDate: string, endDate: string): Promise<FixedActivityWithId[]> {
        const state = await this.getActivitiesInRangeState(userId, startDate, endDate);
        return state.status === 'AVAILABLE' ? state.data : [];
    }

    /** Malformed documents are dropped rather than thrown, same contract as
     *  `getActivitiesInRangeState` -- these are UI list callers, not the planner path, and
     *  a validation failure here shouldn't crash the caller. */
    async listAll(userId: string): Promise<FixedActivityWithId[]> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('userId', '==', userId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs
            .flatMap(d => {
                const validation = validateFixedActivity({ ...d.data(), id: d.id });
                return validation.isValid && validation.data ? [{ ...validation.data, id: d.id }] : [];
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    async getActivity(userId: string, activityId: string): Promise<FixedActivityWithId | null> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, activityId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const validation = validateFixedActivity({ ...docSnap.data(), id: docSnap.id });
        if (!validation.isValid || !validation.data) return null;
        return { ...validation.data, id: docSnap.id };
    }

    async createActivity(userId: string, activityData: Omit<FixedActivity, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<FixedActivity> {
        const rawData = { userId, ...activityData };
        const validation = validateFixedActivity(rawData);
        if (!validation.isValid) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = validation.data!;
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const docRef = await addDoc(collRef, storedActivityPayload(validated));
        return { ...validated, id: docRef.id };
    }

    async updateActivity(userId: string, activityId: string, updates: Partial<FixedActivity>): Promise<FixedActivity> {
        const existing = await this.getActivity(userId, activityId);
        if (!existing) {
            throw new Error('Fixed activity not found');
        }
        const updatedData = { ...existing, ...updates };
        const validation = validateFixedActivity(updatedData);
        if (!validation.isValid) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = validation.data!;
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, activityId);
        await setDoc(docRef, storedActivityPayload(validated), { merge: true });
        return validated;
    }

    async markCompleted(userId: string, activityId: string): Promise<FixedActivity> {
        return this.updateActivity(userId, activityId, { isCompleted: true });
    }

    async deleteActivity(userId: string, activityId: string): Promise<void> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, activityId);
        await deleteDoc(docRef);
    }
}

export const fixedActivityService = new FixedActivityService();
