import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, where, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ScheduleOverlay } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateScheduleOverlay } from '../engine/validation';
import { getErrorCode } from '../utils/errors';

export type ScheduleOverlayWithId = ScheduleOverlay & { id: string };

function storedScheduleOverlayPayload(overlay: ScheduleOverlay): DocumentData {
    const payload: DocumentData = { ...overlay };
    delete payload.id;
    return payload;
}

/** Firestore requires whole minutes for this field. Reject fractional values before
 * attempting a write so client validation and persistence cannot disagree. */
function assertWholeMinuteAvailability(value: number): void {
    if (!Number.isInteger(value)) {
        throw new Error('Validation failed: dailyAvailabilityMinutes must be a whole number of minutes');
    }
}

/** User-scoped persistence for ScheduleOverlays (planned absences, active sport trips,
 * sedentary holidays, high-step walking tours).
 */
export class ScheduleOverlayService {
    private readonly collectionPath = 'schedule_overlays';

    async getOverlaysInRangeState(
        userId: string,
        startDate: string,
        endDate: string,
    ): Promise<DataState<ScheduleOverlayWithId[]>> {
        try {
            const ref = collection(getDb(), 'users', userId, this.collectionPath);
            // Overlays that start on or before the queried range end
            const snapshot = await getDocs(query(ref, where('startDate', '<=', endDate)));
            const overlays: ScheduleOverlayWithId[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];

            for (const item of snapshot.docs) {
                const parsed = validateScheduleOverlay({ ...item.data(), id: item.id });
                if (!parsed.isValid || !parsed.data || parsed.data.userId !== userId) {
                    issues.push({
                        code: 'schema-validation-failed',
                        documentPath: `users/${userId}/${this.collectionPath}/${item.id}`,
                    });
                    continue;
                }
                // Check if the overlay extends into or past the queried range start
                if (parsed.data.endDate >= startDate) {
                    overlays.push({ ...parsed.data, id: item.id });
                }
                const updatedAt = item.data().updatedAt;
                if (typeof updatedAt === 'string') revisions.push(`${item.id}:${updatedAt}`);
            }

            if (issues.length > 0) return { status: 'INVALID', issues };
            return {
                status: 'AVAILABLE',
                data: overlays.sort((a, b) => a.startDate.localeCompare(b.startDate)),
                revision: revisions.sort().join('|') || null,
            };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read schedule overlays',
                retryable: getErrorCode(error) !== 'permission-denied',
            };
        }
    }

    /** Lists overlays for the management UI. Unlike the engine-facing DataState read,
     * failures are deliberately propagated so the card can distinguish "read failed"
     * from a genuine empty collection and offer a retry instead of silently hiding data. */
    async listOverlays(userId: string): Promise<ScheduleOverlayWithId[]> {
        const ref = collection(getDb(), 'users', userId, this.collectionPath);
        const snapshot = await getDocs(ref);
        const overlays: ScheduleOverlayWithId[] = [];
        for (const item of snapshot.docs) {
            const parsed = validateScheduleOverlay({ ...item.data(), id: item.id });
            if (parsed.isValid && parsed.data && parsed.data.userId === userId) {
                overlays.push({ ...parsed.data, id: item.id });
            }
        }
        return overlays.sort((a, b) => a.startDate.localeCompare(b.startDate));
    }

    async create(
        userId: string,
        input: Omit<ScheduleOverlay, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
    ): Promise<ScheduleOverlayWithId> {
        assertWholeMinuteAvailability(input.dailyAvailabilityMinutes);
        const parsed = validateScheduleOverlay({ ...input, userId });
        if (!parsed.isValid || !parsed.data) {
            throw new Error(`Validation failed: ${parsed.errors.map(error => error.message).join('; ')}`);
        }
        const ref = await addDoc(
            collection(getDb(), 'users', userId, this.collectionPath),
            storedScheduleOverlayPayload(parsed.data),
        );
        return { ...parsed.data, id: ref.id };
    }

    async update(
        userId: string,
        id: string,
        input: Omit<ScheduleOverlay, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { createdAt: string },
    ): Promise<ScheduleOverlayWithId> {
        assertWholeMinuteAvailability(input.dailyAvailabilityMinutes);
        const parsed = validateScheduleOverlay({ ...input, id, userId });
        if (!parsed.isValid || !parsed.data) {
            throw new Error(`Validation failed: ${parsed.errors.map(error => error.message).join('; ')}`);
        }
        // Full replacement is deliberate: optional fields the athlete clears (sport,
        // equipment, environment, notes) must be removed instead of surviving via merge.
        await setDoc(
            doc(getDb(), 'users', userId, this.collectionPath, id),
            storedScheduleOverlayPayload(parsed.data),
        );
        return { ...parsed.data, id };
    }

    async delete(userId: string, id: string): Promise<void> {
        await deleteDoc(doc(getDb(), 'users', userId, this.collectionPath, id));
    }
}

export const scheduleOverlayService = new ScheduleOverlayService();
