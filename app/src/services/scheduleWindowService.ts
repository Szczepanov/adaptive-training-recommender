import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, addDoc, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ScheduleWindow } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateScheduleWindow, validateScheduleWindowSet } from '../engine/scheduleWindows';
import { getErrorCode } from '../utils/errors';

type ScheduleWindowWithId = ScheduleWindow & { id: string };
type NewScheduleWindowInput = Omit<ScheduleWindow, 'id' | 'userId' | 'revision' | 'createdAt' | 'updatedAt'>;
type ScheduleWindowUpdates = Partial<Omit<ScheduleWindow, 'id' | 'userId' | 'createdAt'>>;

/** Builds a document payload containing only stored fields -- `id` is the document key,
 *  not a stored field, mirroring `fixedActivityService.ts`'s `storedActivityPayload`. */
function storedWindowPayload(window: ScheduleWindow): DocumentData {
    const payload: DocumentData = { ...window };
    delete payload.id;
    return payload;
}

function parseWindow(raw: DocumentData): ScheduleWindow | null {
    const validation = validateScheduleWindow(raw);
    return validation.isValid && validation.data ? validation.data : null;
}

/**
 * Persists `ScheduleWindow` at `users/{userId}/schedule_windows/{windowId}` (ADR-0002
 * user-owned path). ADR-0036 D-WINDOW: this is the sole owner of actual same-date
 * training availability -- a plan's `intraday` request never creates or broadens it.
 * Every write is validated client-side against the same base shape firestore.rules
 * enforces server-side, plus the cross-window non-overlap invariant firestore.rules
 * cannot check across sibling documents.
 */
export class ScheduleWindowService {
    private readonly collectionPath = 'schedule_windows';

    async getWindowsForDateState(userId: string, date: string): Promise<DataState<ScheduleWindowWithId[]>> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(collRef, where('date', '==', date));
            const querySnapshot = await getDocs(q);
            const windows: ScheduleWindowWithId[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const windowDoc of querySnapshot.docs) {
                const raw = { ...windowDoc.data(), id: windowDoc.id };
                const parsed = parseWindow(raw);
                if (!parsed || parsed.userId !== userId) {
                    issues.push({ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${windowDoc.id}` });
                    continue;
                }
                windows.push({ ...parsed, id: windowDoc.id });
                revisions.push(`${windowDoc.id}:${parsed.revision}`);
            }
            if (issues.length > 0) return { status: 'INVALID', issues };
            const overlapErrors = validateScheduleWindowSet(windows);
            if (overlapErrors.length > 0) {
                return {
                    status: 'INVALID',
                    issues: overlapErrors.map(error => ({ code: 'schedule-window-overlap', field: error.field, documentPath: `users/${userId}/${this.collectionPath}` })),
                };
            }
            return { status: 'AVAILABLE', data: windows, revision: revisions.sort().join('|') || null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read schedule windows', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getWindowsForDate(userId: string, date: string): Promise<ScheduleWindowWithId[]> {
        const state = await this.getWindowsForDateState(userId, date);
        return state.status === 'AVAILABLE' ? state.data : [];
    }

    async listAll(userId: string): Promise<ScheduleWindowWithId[]> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('userId', '==', userId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs
            .flatMap(d => {
                const parsed = parseWindow({ ...d.data(), id: d.id });
                return parsed ? [{ ...parsed, id: d.id }] : [];
            })
            .sort((a, b) => a.date.localeCompare(b.date) || a.startLocal.localeCompare(b.startLocal));
    }

    async getWindow(userId: string, windowId: string): Promise<ScheduleWindowWithId | null> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, windowId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const parsed = parseWindow({ ...docSnap.data(), id: docSnap.id });
        if (!parsed || parsed.userId !== userId) return null;
        return { ...parsed, id: docSnap.id };
    }

    /** Creates a window, rejecting it up front if it would overlap an existing same-date
     * window -- the cross-document invariant firestore.rules cannot itself enforce. */
    async createWindow(userId: string, input: NewScheduleWindowInput): Promise<ScheduleWindow> {
        const now = new Date().toISOString();
        const rawData: DocumentData = { userId, revision: 1, createdAt: now, updatedAt: now, ...input };
        const validation = validateScheduleWindow(rawData);
        if (!validation.isValid || !validation.data) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const existing = await this.getWindowsForDate(userId, validation.data.date);
        const overlapErrors = validateScheduleWindowSet([...existing, { ...validation.data, id: '__new__' }]);
        if (overlapErrors.length > 0) {
            throw new Error(`Validation failed: window overlaps an existing schedule window on ${validation.data.date}`);
        }
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const docRef = await addDoc(collRef, storedWindowPayload(validation.data));
        return { ...validation.data, id: docRef.id };
    }

    async updateWindow(userId: string, windowId: string, updates: ScheduleWindowUpdates): Promise<ScheduleWindow> {
        const existing = await this.getWindow(userId, windowId);
        if (!existing) throw new Error('Schedule window not found');
        const updatedData: DocumentData = {
            ...existing,
            ...updates,
            revision: existing.revision + 1,
            updatedAt: new Date().toISOString(),
        };
        const validation = validateScheduleWindow(updatedData);
        if (!validation.isValid || !validation.data) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const siblings = (await this.getWindowsForDate(userId, validation.data.date)).filter(w => w.id !== windowId);
        const overlapErrors = validateScheduleWindowSet([...siblings, { ...validation.data, id: windowId }]);
        if (overlapErrors.length > 0) {
            throw new Error(`Validation failed: window overlaps an existing schedule window on ${validation.data.date}`);
        }
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, windowId);
        await setDoc(docRef, storedWindowPayload(validation.data), { merge: true });
        return validation.data;
    }

    async deleteWindow(userId: string, windowId: string): Promise<void> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, windowId);
        await deleteDoc(docRef);
    }
}

export const scheduleWindowService = new ScheduleWindowService();
