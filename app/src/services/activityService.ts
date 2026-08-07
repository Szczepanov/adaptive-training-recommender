import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { DataIssue, DataState } from '../engine/dataState';
import type { NormalizedGarminActivity } from '../engine/models';
import { parseNormalizedGarminActivity } from '../persistence/parsers/trainingHistory';
import { isPermissionDeniedError } from '../utils/errors';

export class ActivityService {
    private readonly collectionPath = 'activities';

    /** Retrieves a bounded Warsaw-date activity window in one query. A single corrupt
     * document invalidates the source; callers must never mistake that for zero load. */
    async getActivitiesInRange(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<DataState<NormalizedGarminActivity[]>> {
        try {
            const ref = collection(db, 'users', userId, this.collectionPath);
            const activityQuery = query(
                ref,
                where('date', '>=', startDateInclusive),
                where('date', '<', throughDateExclusive),
                orderBy('date', 'asc'),
            );
            const snapshot = await getDocs(activityQuery);
            const activities: NormalizedGarminActivity[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const activityDocument of snapshot.docs) {
                const path = `users/${userId}/${this.collectionPath}/${activityDocument.id}`;
                const parsed = parseNormalizedGarminActivity(activityDocument.data(), path, activityDocument.id);
                if (parsed.status === 'AVAILABLE') {
                    activities.push(parsed.data);
                    if (parsed.revision) revisions.push(`${activityDocument.id}:${parsed.revision}`);
                } else if (parsed.status === 'INVALID') {
                    issues.push(...parsed.issues);
                }
            }
            if (issues.length > 0) return { status: 'INVALID', issues };
            return { status: 'AVAILABLE', data: activities, revision: revisions.sort().join('|') || null };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read activities history',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }
}

export const activityService = new ActivityService();
