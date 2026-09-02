import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    where,
    orderBy,
    type Firestore,
    type WriteBatch,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type {
    SessionExecution,
    SessionEntry,
    SessionRestEvent,
    SessionSourceRef,
    SessionExecutionState,
} from '../sessions/models';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import {
    parseSessionExecutionDocument,
    parseSessionEntryDocument,
    parseSessionRestEventDocument,
} from '../persistence/parsers/sessionExecution';

export class SessionExecutionService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private executionRef(userId: string, executionId: string) {
        return doc(this.db, 'users', userId, 'session_executions', executionId);
    }

    private entryRef(userId: string, executionId: string, entryId: string) {
        return doc(
            this.db,
            'users',
            userId,
            'session_executions',
            executionId,
            'entries',
            entryId,
        );
    }

    private entriesColl(userId: string, executionId: string) {
        return collection(
            this.db,
            'users',
            userId,
            'session_executions',
            executionId,
            'entries',
        );
    }

    private restEventRef(userId: string, executionId: string, restEventId: string) {
        return doc(
            this.db,
            'users',
            userId,
            'session_executions',
            executionId,
            'restEvents',
            restEventId,
        );
    }

    private restEventsColl(userId: string, executionId: string) {
        return collection(
            this.db,
            'users',
            userId,
            'session_executions',
            executionId,
            'restEvents',
        );
    }

    async startExecution(
        userId: string,
        executionId: string,
        params: {
            sessionSource: SessionSourceRef;
            occurrenceId?: string;
            prescriptionHash?: string;
            date: string;
        },
    ): Promise<SessionExecution> {
        const now = new Date().toISOString();
        const execution: SessionExecution = {
            userId,
            executionId,
            sessionSource: params.sessionSource,
            ...(params.occurrenceId ? { occurrenceId: params.occurrenceId } : {}),
            ...(params.prescriptionHash ? { prescriptionHash: params.prescriptionHash } : {}),
            date: params.date,
            startedAt: now,
            updatedAt: now,
            state: 'in_progress',
            schemaVersion: 1,
        };

        await setDoc(this.executionRef(userId, executionId), execution);
        return execution;
    }

    async getExecution(userId: string, executionId: string): Promise<DataState<SessionExecution>> {
        const path = `users/${userId}/session_executions/${executionId}`;
        try {
            const snap = await getDoc(this.executionRef(userId, executionId));
            return parseSessionExecutionDocument(snap.exists() ? snap.data() : undefined, path);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getExecution', retryable: true };
        }
    }

    async logEntry(userId: string, executionId: string, entry: SessionEntry): Promise<void> {
        const now = new Date().toISOString();
        const docPayload: SessionEntry = {
            ...entry,
            executionId,
            createdAt: entry.createdAt || now,
            updatedAt: now,
        };
        await setDoc(this.entryRef(userId, executionId, entry.id), docPayload);
        await setDoc(this.executionRef(userId, executionId), { updatedAt: now }, { merge: true });
    }

    async correctEntry(
        userId: string,
        executionId: string,
        entryId: string,
        updatedEntry: Partial<SessionEntry>,
    ): Promise<void> {
        const now = new Date().toISOString();
        await setDoc(
            this.entryRef(userId, executionId, entryId),
            { ...updatedEntry, updatedAt: now },
            { merge: true },
        );
        await setDoc(this.executionRef(userId, executionId), { updatedAt: now }, { merge: true });
    }

    async deleteEntry(userId: string, executionId: string, entryId: string): Promise<void> {
        const now = new Date().toISOString();
        await deleteDoc(this.entryRef(userId, executionId, entryId));
        await setDoc(this.executionRef(userId, executionId), { updatedAt: now }, { merge: true });
    }

    async getEntries(userId: string, executionId: string): Promise<SessionEntry[]> {
        return (await this.readEntries(userId, executionId)).entries;
    }

    /** PR 3 (training-occurrence plan): persists one durable performed-rest record. Uses
     * the caller-supplied `restEventId` (not an auto-generated one) so a duplicate client
     * call for the same rest instance -- e.g. a retried write after a transient failure --
     * overwrites the same document instead of creating a second rest event
     * (`sessions/restEventTiming.ts` itself is a pure function with no id of its own; the
     * caller in `useSessionRunner.ts` mints one id per closed rest and reuses it on retry). */
    async logRestEvent(userId: string, executionId: string, restEvent: SessionRestEvent): Promise<void> {
        const now = new Date().toISOString();
        const docPayload: SessionRestEvent = {
            ...restEvent,
            executionId,
            createdAt: restEvent.createdAt || now,
            updatedAt: now,
        };
        await setDoc(this.restEventRef(userId, executionId, restEvent.id), docPayload);
    }

    async getRestEvents(userId: string, executionId: string): Promise<SessionRestEvent[]> {
        const snap = await getDocs(this.restEventsColl(userId, executionId));
        const restEvents: SessionRestEvent[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionRestEventDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.executionId === executionId) {
                restEvents.push(parsed.data);
            }
        }
        return restEvents.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }

    /**
     * Same read as `getEntries`, but also reports how many entry documents under this
     * execution failed to parse or belong to another execution -- `getEntries` alone drops
     * them silently, which let a malformed or cross-linked entry set disappear from range
     * reads without incrementing `invalidRecords`.
     */
    private async readEntries(userId: string, executionId: string): Promise<{ entries: SessionEntry[]; invalidRecords: number }> {
        const snap = await getDocs(this.entriesColl(userId, executionId));
        const entries: SessionEntry[] = [];
        let invalidRecords = 0;
        for (const docSnap of snap.docs) {
            const parsed = parseSessionEntryDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.executionId === executionId) {
                entries.push(parsed.data);
            } else if (parsed.status === 'INVALID' || parsed.status === 'AVAILABLE') {
                invalidRecords += 1;
            }
        }
        return { entries: entries.sort((a, b) => a.completedAt.localeCompare(b.completedAt)), invalidRecords };
    }

    /**
     * M2 only starts fixture-backed, unplanned executions.  The small bounded query is
     * intentionally a resume seam, not a history API: a runner must not create a second
     * execution merely because the app was backgrounded or reloaded.
     */
    async findInProgressExecution(userId: string): Promise<SessionExecution | null> {
        const snap = await getDocs(collection(this.db, 'users', userId, 'session_executions'));
        const candidates: SessionExecution[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionExecutionDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.state === 'in_progress') {
                candidates.push(parsed.data);
            }
        }
        return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    }

    /** OV3 recovery seam: an AssessmentAttempt stores the occurrence identity before the
     * runner creates its execution, allowing a completed test to return to metric capture after
     * a browser reload without keeping execution state only in React memory. */
    async findExecutionByOccurrenceId(userId: string, occurrenceId: string): Promise<SessionExecution | null> {
        const snap = await getDocs(collection(this.db, 'users', userId, 'session_executions'));
        const candidates: SessionExecution[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionExecutionDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.occurrenceId === occurrenceId) {
                candidates.push(parsed.data);
            }
        }
        return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    }

    /**
     * Transitions an execution's state. Pass `batch` (e.g. shared with a preferences
     * writeback) to queue this write into a caller-owned `WriteBatch` instead of committing
     * it alone -- the caller commits once both writes are queued, so a completion and any
     * derived data it depends on land atomically rather than as two independent writes that
     * could leave the execution `in_progress` after the derived data was already persisted.
     */
    async transitionExecution(
        userId: string,
        executionId: string,
        targetState: SessionExecutionState,
        data?: { sessionRpe?: number; notes?: string },
        batch?: WriteBatch,
    ): Promise<void> {
        const now = new Date().toISOString();
        const patch: Partial<SessionExecution> = {
            state: targetState,
            updatedAt: now,
            ...(targetState === 'completed' ? { completedAt: now } : {}),
            ...(data?.sessionRpe !== undefined ? { sessionRpe: data.sessionRpe } : {}),
            ...(data?.notes !== undefined ? { notes: data.notes } : {}),
        };
        if (batch) {
            batch.set(this.executionRef(userId, executionId), patch, { merge: true });
            return;
        }
        await setDoc(this.executionRef(userId, executionId), patch, { merge: true });
    }

    async getExecutionsInRange(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<{ executions: NormalizedExecutionRecord[]; invalidRecords: number }> {
        const collRef = collection(this.db, 'users', userId, 'session_executions');
        const q = query(
            collRef,
            where('date', '>=', startDateInclusive),
            where('date', '<', throughDateExclusive),
            orderBy('date', 'asc'),
        );
        const snap = await getDocs(q);
        const executions: NormalizedExecutionRecord[] = [];
        let invalidRecords = 0;

        for (const docSnap of snap.docs) {
            const parsed = parseSessionExecutionDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.executionId === docSnap.id) {
                const entryRead = await this.readEntries(userId, parsed.data.executionId);
                invalidRecords += entryRead.invalidRecords;
                executions.push({
                    execution: parsed.data,
                    entries: entryRead.entries,
                });
            } else if (parsed.status === 'INVALID' || parsed.status === 'AVAILABLE') {
                invalidRecords += 1;
            }
        }

        return { executions, invalidRecords };
    }
}

export const sessionExecutionService = new SessionExecutionService();
