import { doc, getDoc, setDoc, deleteDoc, deleteField, collection, query, where, getDocs, addDoc, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { FixedActivity } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateFixedActivity } from '../engine/validation';
import { resolveFixedActivityIdentity } from '../engine/fixedActivityIdentity';
import { getErrorCode } from '../utils/errors';

type FixedActivityWithId = FixedActivity & { id: string };
type FixedActivityUpdates = Omit<Partial<FixedActivity>, 'templateId' | 'workoutId'> & {
    templateId?: string | null;
    workoutId?: string | null;
};
type ParsedActivity = { activity: FixedActivity; identityValid: boolean };

/** Builds a document payload containing only stored fields -- `id` is the document key,
 *  not a stored field, mirroring goalService's storedGoalPayload. */
function storedActivityPayload(activity: FixedActivity): DocumentData {
    const payload: DocumentData = { ...activity };
    delete payload.id;
    return payload;
}

/** Attach and validate the optional exact catalog identity after the legacy shape parser.
 * Unknown/mismatched identities fail closed: expectedCost/time can still be persisted on
 * an activity with no identity, but a supplied identity must resolve to one real authored
 * prescription before it is trusted or round-tripped. */
function attachExactIdentity(activity: FixedActivity, raw: DocumentData): FixedActivity | null {
    const templateId = raw.templateId;
    const workoutId = raw.workoutId;
    if (templateId === undefined && workoutId === undefined) return activity;
    if ((templateId !== undefined && (typeof templateId !== 'string' || templateId.length === 0 || templateId.length > 120))
        || (workoutId !== undefined && (typeof workoutId !== 'string' || workoutId.length === 0 || workoutId.length > 120))) {
        return null;
    }
    const candidate: FixedActivity = {
        ...activity,
        ...(templateId !== undefined ? { templateId } : {}),
        ...(workoutId !== undefined ? { workoutId } : {}),
    };
    return resolveFixedActivityIdentity(candidate) ? candidate : null;
}

function parseActivity(raw: DocumentData): ParsedActivity | null {
    const validation = validateFixedActivity(raw);
    if (!validation.isValid || !validation.data) return null;
    const withIdentity = attachExactIdentity(validation.data, raw);
    return withIdentity
        ? { activity: withIdentity, identityValid: true }
        : { activity: validation.data, identityValid: false };
}

/**
 * Persists `FixedActivity` at `users/{userId}/fixed_activities/{activityId}` (ADR-0002
 * user-owned path) -- see docs/plans/phase-5-sequence-planning.md 5.3. Every write is
 * validated client-side against the same base shape firestore.rules enforces server-side;
 * Phase 6.2c additionally validates optional template/workout identity against the live
 * catalog before it can earn objective/coverage credit.
 */
export class FixedActivityService {
    private readonly collectionPath = 'fixed_activities';

    async getActivitiesInRangeState(userId: string, startDate: string, endDate: string): Promise<DataState<FixedActivityWithId[]>> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(collRef, where('date', '>=', startDate), where('date', '<=', endDate));
            const querySnapshot = await getDocs(q);
            const activities: FixedActivityWithId[] = [];
            const schemaIssues: DataIssue[] = [];
            const identityIssues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const activityDoc of querySnapshot.docs) {
                const raw = { ...activityDoc.data(), id: activityDoc.id };
                const parsed = parseActivity(raw);
                if (!parsed || parsed.activity.userId !== userId) {
                    schemaIssues.push({ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${activityDoc.id}` });
                    continue;
                }
                activities.push({ ...parsed.activity, id: activityDoc.id });
                if (!parsed.identityValid) {
                    identityIssues.push({ code: 'catalog-identity-unresolved', field: 'templateId/workoutId', documentPath: `users/${userId}/${this.collectionPath}/${activityDoc.id}` });
                }
                if (typeof activityDoc.data().updatedAt === 'string') revisions.push(`${activityDoc.id}:${activityDoc.data().updatedAt}`);
            }
            if (schemaIssues.length > 0) return { status: 'INVALID', issues: schemaIssues };
            return { status: 'AVAILABLE', data: activities, revision: revisions.sort().join('|') || null, ...(identityIssues.length > 0 ? { issues: identityIssues } : {}) };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read fixed activities', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getActivitiesInRange(userId: string, startDate: string, endDate: string): Promise<FixedActivityWithId[]> {
        const state = await this.getActivitiesInRangeState(userId, startDate, endDate);
        return state.status === 'AVAILABLE' ? state.data : [];
    }

    async listAll(userId: string): Promise<FixedActivityWithId[]> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('userId', '==', userId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs
            .flatMap(d => {
                const parsed = parseActivity({ ...d.data(), id: d.id });
                return parsed ? [{ ...parsed.activity, id: d.id }] : [];
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    async getActivity(userId: string, activityId: string): Promise<FixedActivityWithId | null> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, activityId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const parsed = parseActivity({ ...docSnap.data(), id: docSnap.id });
        if (!parsed || parsed.activity.userId !== userId) return null;
        return { ...parsed.activity, id: docSnap.id };
    }

    async createActivity(userId: string, activityData: Omit<FixedActivity, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<FixedActivity> {
        const rawData: DocumentData = { userId, ...activityData };
        const validation = validateFixedActivity(rawData);
        if (!validation.isValid || !validation.data) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = attachExactIdentity(validation.data, rawData);
        if (!validated) throw new Error('Validation failed: templateId/workoutId must identify one matching active catalog workout');
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const docRef = await addDoc(collRef, storedActivityPayload(validated));
        return { ...validated, id: docRef.id };
    }

    async updateActivity(userId: string, activityId: string, updates: FixedActivityUpdates): Promise<FixedActivity> {
        const existing = await this.getActivity(userId, activityId);
        if (!existing) throw new Error('Fixed activity not found');
        const updatedData: DocumentData = { ...existing, ...updates };
        if (updates.templateId === null) delete updatedData.templateId;
        if (updates.workoutId === null) delete updatedData.workoutId;
        const validation = validateFixedActivity(updatedData);
        if (!validation.isValid || !validation.data) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = attachExactIdentity(validation.data, updatedData);
        if (!validated) throw new Error('Validation failed: templateId/workoutId must identify one matching active catalog workout');
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, activityId);
        const payload = storedActivityPayload(validated);
        if (updates.templateId === null) payload.templateId = deleteField();
        if (updates.workoutId === null) payload.workoutId = deleteField();
        await setDoc(docRef, payload, { merge: true });
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
