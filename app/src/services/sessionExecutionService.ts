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
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type {
    SessionExecution,
    SessionEntry,
    SessionSourceRef,
    SessionExecutionState,
} from '../sessions/models';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import {
    parseSessionExecutionDocument,
    parseSessionEntryDocument,
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
        const snap = await getDocs(this.entriesColl(userId, executionId));
        const entries: SessionEntry[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionEntryDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE') {
                entries.push(parsed.data);
            }
        }
        return entries.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
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
        // A future authority milestone defines multiple concurrent session semantics.
        // Until then, resume the latest start rather than guessing between records.
        return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    }

    async transitionExecution(
        userId: string,
        executionId: string,
        targetState: SessionExecutionState,
        data?: { sessionRpe?: number; notes?: string },
    ): Promise<void> {
        const now = new Date().toISOString();
        const patch: Partial<SessionExecution> = {
            state: targetState,
            updatedAt: now,
            ...(targetState === 'completed' ? { completedAt: now } : {}),
            ...(data?.sessionRpe !== undefined ? { sessionRpe: data.sessionRpe } : {}),
            ...(data?.notes !== undefined ? { notes: data.notes } : {}),
        };
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
            if (parsed.status === 'AVAILABLE') {
                const entries = await this.getEntries(userId, parsed.data.executionId);
                executions.push({
                    execution: parsed.data,
                    entries,
                });
            } else if (parsed.status === 'INVALID') {
                invalidRecords += 1;
            }
        }

        return { executions, invalidRecords };
    }
}

export const sessionExecutionService = new SessionExecutionService();
