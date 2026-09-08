import { collection, doc, getDoc, getDocs, query, runTransaction, where, type DocumentData, type DocumentReference, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ScheduleWindow, ScheduleWindowManifest } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateScheduleWindow, validateScheduleWindowManifest } from '../engine/scheduleWindows';
import { getErrorCode } from '../utils/errors';

type ScheduleWindowWithId = ScheduleWindow & { id: string };
type NewScheduleWindowInput = Omit<ScheduleWindow, 'id' | 'userId' | 'revision' | 'createdAt' | 'updatedAt'>;
type ScheduleWindowUpdates = Partial<Omit<ScheduleWindow, 'id' | 'userId' | 'revision' | 'createdAt' | 'updatedAt'>>;

class InvalidScheduleWindowManifestError extends Error {}
class RetiredScheduleWindowRepresentationError extends Error {}

/**
 * Persists all of a Warsaw-local date's windows in one authoritative manifest at
 * `users/{userId}/schedule_window_manifests/{YYYY-MM-DD}`.
 *
 * Every mutation transacts that named document. Firestore retries a concurrent writer
 * after the first commit, at which point validation sees the current complete set and
 * refuses an overlap. Rules independently validate the bounded manifest and deny writes
 * to the retired `schedule_windows` sibling collection, so direct SDK writes cannot
 * bypass the invariant either.
 */
export class ScheduleWindowService {
    private readonly collectionPath = 'schedule_window_manifests';
    private readonly retiredCollectionPath = 'schedule_windows';
    private readonly db: Firestore;
    private readonly now: () => string;
    private readonly newId: () => string;

    constructor(db: Firestore = getDb(), now: () => string = () => new Date().toISOString(), newId: () => string = () => crypto.randomUUID()) {
        this.db = db;
        this.now = now;
        this.newId = newId;
    }

    private ref(userId: string, date: string): DocumentReference {
        return doc(this.db, 'users', userId, this.collectionPath, date);
    }

    private manifestFromSnapshot(userId: string, date: string, raw: DocumentData | undefined): ScheduleWindowManifest | null {
        if (!raw) return null;
        const result = validateScheduleWindowManifest(raw);
        if (!result.isValid || !result.data || result.data.userId !== userId || result.data.date !== date) {
            throw new InvalidScheduleWindowManifestError(`Schedule window manifest for ${date} is invalid`);
        }
        return result.data;
    }

    private buildManifest(userId: string, date: string, previous: ScheduleWindowManifest | null, windows: ScheduleWindow[]): ScheduleWindowManifest {
        const now = this.now();
        const manifest: ScheduleWindowManifest = {
            userId,
            date,
            revision: previous ? previous.revision + 1 : 1,
            windows,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
        };
        const validation = validateScheduleWindowManifest(manifest);
        if (!validation.isValid || !validation.data) {
            throw new Error(`Validation failed: ${validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')}`);
        }
        return validation.data;
    }

    /** Retired sibling documents are not silently reinterpreted as the valid legacy
     * no-window case. Their invariant was never authoritative, so an administrator must
     * migrate or remove them before this date can participate in placement. */
    private async assertNoRetiredWindows(userId: string, date: string): Promise<void> {
        const retired = await getDocs(query(
            collection(this.db, 'users', userId, this.retiredCollectionPath),
            where('date', '==', date),
        ));
        if (!retired.empty) {
            throw new RetiredScheduleWindowRepresentationError(`Retired schedule window documents exist for ${date}`);
        }
    }

    /** Reads a complete same-date set. A missing manifest is the intentional legacy
     * no-window case; malformed, mixed-representation, or unavailable persisted state is
     * never collapsed into it. */
    async getWindowsForDateState(userId: string, date: string): Promise<DataState<ScheduleWindowWithId[]>> {
        try {
            // Check even when a manifest exists. Coexisting authoritative and retired
            // representations are ambiguous (for example during a partial admin
            // migration) and must fail closed rather than silently preferring one.
            await this.assertNoRetiredWindows(userId, date);
            const snapshot = await getDoc(this.ref(userId, date));
            if (!snapshot.exists()) return { status: 'AVAILABLE', data: [], revision: null };
            const manifest = this.manifestFromSnapshot(userId, date, snapshot.data());
            if (!manifest) return { status: 'AVAILABLE', data: [], revision: null };
            return { status: 'AVAILABLE', data: manifest.windows, revision: `manifest:${manifest.revision}` };
        } catch (error: unknown) {
            if (error instanceof RetiredScheduleWindowRepresentationError) {
                return { status: 'INVALID', issues: [{ code: 'retired-schedule-window-representation', documentPath: `users/${userId}/${this.retiredCollectionPath}` }] };
            }
            if (error instanceof InvalidScheduleWindowManifestError) {
                const issues: DataIssue[] = [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${date}` }];
                return { status: 'INVALID', issues };
            }
            return { status: 'UNAVAILABLE', operation: 'read schedule window manifest', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getWindowsForDate(userId: string, date: string): Promise<ScheduleWindowWithId[]> {
        const state = await this.getWindowsForDateState(userId, date);
        if (state.status === 'AVAILABLE') return state.data;
        if (state.status === 'INVALID') throw new Error(`Cannot read schedule windows for ${date}: persisted data is invalid`);
        throw new Error(`Cannot read schedule windows for ${date}: data is unavailable`);
    }

    /** Lists every valid manifest's windows, sorted by date then local time. */
    async listAll(userId: string): Promise<ScheduleWindowWithId[]> {
        const retired = await getDocs(collection(this.db, 'users', userId, this.retiredCollectionPath));
        if (!retired.empty) throw new Error('Cannot list schedule windows while retired sibling documents exist');
        const snapshots = await getDocs(collection(this.db, 'users', userId, this.collectionPath));
        const windows: ScheduleWindowWithId[] = [];
        for (const snapshot of snapshots.docs) {
            const manifest = this.manifestFromSnapshot(userId, snapshot.id, snapshot.data());
            if (manifest) windows.push(...manifest.windows);
        }
        return windows.sort((left, right) => left.date.localeCompare(right.date) || left.startLocal.localeCompare(right.startLocal));
    }

    async getWindow(userId: string, date: string, windowId: string): Promise<ScheduleWindowWithId | null> {
        const windows = await this.getWindowsForDate(userId, date);
        return windows.find(window => window.id === windowId) ?? null;
    }

    async createWindow(userId: string, input: NewScheduleWindowInput): Promise<ScheduleWindow> {
        const now = this.now();
        const candidate: ScheduleWindow = { ...input, id: this.newId(), userId, revision: 1, createdAt: now, updatedAt: now };
        const validation = validateScheduleWindow(candidate);
        if (!validation.isValid || !validation.data) {
            throw new Error(`Validation failed: ${validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')}`);
        }
        await this.assertNoRetiredWindows(userId, candidate.date);
        const ref = this.ref(userId, candidate.date);
        await runTransaction(this.db, async transaction => {
            const snapshot = await transaction.get(ref);
            const current = this.manifestFromSnapshot(userId, candidate.date, snapshot.exists() ? snapshot.data() : undefined);
            transaction.set(ref, this.buildManifest(userId, candidate.date, current, [...(current?.windows ?? []), candidate]));
        });
        return candidate;
    }

    /**
     * Updates one window by stable id. `currentDate` is required because the window now
     * lives inside a per-date document; a date move atomically reads and writes both
     * affected manifests rather than relying on a query inside a transaction.
     */
    async updateWindow(userId: string, currentDate: string, windowId: string, updates: ScheduleWindowUpdates): Promise<ScheduleWindow> {
        await this.assertNoRetiredWindows(userId, currentDate);
        if (updates.date && updates.date !== currentDate) await this.assertNoRetiredWindows(userId, updates.date);
        const sourceRef = this.ref(userId, currentDate);
        let updated: ScheduleWindow | undefined;
        await runTransaction(this.db, async transaction => {
            const sourceSnapshot = await transaction.get(sourceRef);
            const source = this.manifestFromSnapshot(userId, currentDate, sourceSnapshot.exists() ? sourceSnapshot.data() : undefined);
            const existing = source?.windows.find(window => window.id === windowId);
            if (!source || !existing) throw new Error('Schedule window not found');
            const candidate: ScheduleWindow = {
                ...existing, ...updates, id: existing.id, userId, revision: existing.revision + 1,
                createdAt: existing.createdAt, updatedAt: this.now(),
            };
            const validation = validateScheduleWindow(candidate);
            if (!validation.isValid || !validation.data) {
                throw new Error(`Validation failed: ${validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')}`);
            }
            const targetDate = validation.data.date;
            if (targetDate === currentDate) {
                transaction.set(sourceRef, this.buildManifest(userId, currentDate, source, source.windows.map(window => window.id === windowId ? validation.data! : window)));
            } else {
                const targetRef = this.ref(userId, targetDate);
                const targetSnapshot = await transaction.get(targetRef);
                const target = this.manifestFromSnapshot(userId, targetDate, targetSnapshot.exists() ? targetSnapshot.data() : undefined);
                transaction.set(sourceRef, this.buildManifest(userId, currentDate, source, source.windows.filter(window => window.id !== windowId)));
                transaction.set(targetRef, this.buildManifest(userId, targetDate, target, [...(target?.windows ?? []), validation.data]));
            }
            updated = validation.data;
        });
        if (!updated) throw new Error('Schedule window update did not complete');
        return updated;
    }

    /** Deletes one window while retaining its date manifest and monotonic revision. */
    async deleteWindow(userId: string, date: string, windowId: string): Promise<void> {
        await this.assertNoRetiredWindows(userId, date);
        const ref = this.ref(userId, date);
        await runTransaction(this.db, async transaction => {
            const snapshot = await transaction.get(ref);
            const current = this.manifestFromSnapshot(userId, date, snapshot.exists() ? snapshot.data() : undefined);
            if (!current || !current.windows.some(window => window.id === windowId)) throw new Error('Schedule window not found');
            transaction.set(ref, this.buildManifest(userId, date, current, current.windows.filter(window => window.id !== windowId)));
        });
    }
}

export const scheduleWindowService = new ScheduleWindowService();