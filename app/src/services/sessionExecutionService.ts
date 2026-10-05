import {
    doc,
    getDoc,
    setDoc,
    getDocFromCache,
    onSnapshot,
    waitForPendingWrites,
    collection,
    getDocs,
    query,
    where,
    orderBy,
    runTransaction,
    writeBatch,
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
    FitWorkoutFingerprintKind,
} from '../sessions/models';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import {
    parseSessionExecutionDocument,
    parseSessionEntryDocument,
    parseSessionRestEventDocument,
} from '../persistence/parsers/sessionExecution';
import { commitDiaryWrite, type DiaryWriteOptions } from './sessionDiaryWrite';
import { readDiaryReceipts, removeDiaryReceipt, saveDiaryReceipt } from './sessionDiaryReceipts';
import { canonicalizeJson } from '../utils/canonicalJson';

export interface SessionDiaryMutation {
    id: string;
    executionId: string;
    targetId: string;
    targetKind: 'entry' | 'rest';
    kind: 'log' | 'correct' | 'delete' | 'restore' | 'rest';
    at: string;
    before: SessionEntry | null;
    after: SessionEntry | SessionRestEvent;
}

const ALREADY_COMPLETED_MESSAGE = 'A completed execution already exists for this session today.';

/**
 * Thrown from inside `claimExecutionSlot`'s transaction when a concurrent caller already
 * won the slot. Distinguished from a genuine Firestore write failure (permission-denied,
 * network) so `startExecution`'s H4 rollback catch does not treat ordinary two-tab
 * contention as a failed launch that needs an occurrence/ledger rollback.
 */
class ExecutionSlotConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExecutionSlotConflictError';
    }
}

/** Returns true for the Firestore connectivity failure that makes client transactions unusable offline. */
function isFirestoreUnavailable(error: unknown): boolean {
    return (error as { code?: string })?.code === 'unavailable';
}

/**
 * `session_execution_locks/{lockId}` -- a small pointer document, one per (date,
 * occurrenceId) or (date, prescriptionHash) identity, that makes `startExecution`'s
 * existing-execution check transactable. Firestore transactions can only do atomic reads
 * on documents whose reference is already known, and `findExistingExecution` is a
 * `where('date', '==', ...)` query, so the check-then-create in `startExecution` used to be
 * two independent round-trips with an unguarded window between them (#663). Keying a
 * transaction on this deterministic doc instead closes that window: two concurrent callers
 * reading the same lock ref race through Firestore's normal transaction-conflict retry,
 * and the loser re-reads the winner's pointer instead of creating a second execution.
 */
interface SessionExecutionLock {
    userId: string;
    executionId: string;
    date: string;
    occurrenceId?: string;
    prescriptionHash?: string;
    allowCompletedReplacement: boolean;
    updatedAt: string;
    schemaVersion: 1;
}

export interface StartExecutionParams {
    sessionSource: SessionSourceRef;
    occurrenceId?: string;
    prescriptionHash?: string;
    fitWorkoutFingerprint?: string;
    fitWorkoutFingerprintKind?: FitWorkoutFingerprintKind;
    date: string;
    allowDuplicateCompleted?: boolean;
}

export class SessionExecutionService {
    private readonly db: Firestore;
    private readonly entryWrites = new Map<string, Promise<void>>();

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

    /** Returns the deterministic owner-scoped pointer used to serialize one execution identity. */
    private lockRef(userId: string, lockId: string) {
        return doc(this.db, 'users', userId, 'session_execution_locks', lockId);
    }

    /**
     * Same identity `findExistingExecution` matches on. The date is part of both branches:
     * that method first queries `where('date', '==', params.date)`, then matches either the
     * occurrence id or (for occurrence-less executions) the prescription hash. Keeping the
     * date in the deterministic key is therefore correctness, not namespacing: an occurrence
     * id reused or rescheduled onto another day must not resume the earlier day's execution.
     */
    private executionSlotKey(params: { date: string; occurrenceId?: string; prescriptionHash?: string }): string {
        return params.occurrenceId
            ? `occ_${params.date}_${encodeURIComponent(params.occurrenceId)}`
            : params.prescriptionHash
                ? `rx_${params.date}_hash:${encodeURIComponent(params.prescriptionHash)}`
                : `rx_${params.date}_nohash`;
    }

    /** Applies the same date/occurrence/hash identity semantics used by findExistingExecution. */
    private executionMatchesSlot(
        execution: SessionExecution,
        params: { date: string; occurrenceId?: string; prescriptionHash?: string },
    ): boolean {
        if (execution.date !== params.date) return false;
        if (params.occurrenceId) return execution.occurrenceId === params.occurrenceId;
        if (execution.occurrenceId) return false;
        return params.prescriptionHash
            ? execution.prescriptionHash === params.prescriptionHash
            : !execution.prescriptionHash;
    }

    async startExecution(
        userId: string,
        executionId: string,
        params: StartExecutionParams,
    ): Promise<SessionExecution> {
        if (Boolean(params.fitWorkoutFingerprint) !== Boolean(params.fitWorkoutFingerprintKind)) {
            throw new Error('fitWorkoutFingerprint and fitWorkoutFingerprintKind must be provided together');
        }

        // Fast path: catches the common case (and legacy executions written before this
        // lock scheme existed) without opening a transaction. This alone is still racy --
        // two concurrent callers can both pass it -- so it is not the guard; see
        // `claimExecutionSlot` below for the part that actually closes #663.
        const existing = await this.findExistingExecution(userId, {
            date: params.date,
            occurrenceId: params.occurrenceId,
            prescriptionHash: params.prescriptionHash,
        });

        if (existing) {
            if (existing.state === 'in_progress') {
                return existing;
            }
            if (existing.state === 'completed' && !params.allowDuplicateCompleted) {
                throw new Error(ALREADY_COMPLETED_MESSAGE);
            }
        }

        let claimed: SessionExecution;
        try {
            claimed = await this.claimExecutionSlot(userId, executionId, params);
        } catch (error) {
            if (error instanceof ExecutionSlotConflictError) throw error;
            // H4 (#434) PR 3 Phase 4: an additional bundle member is claimed before
            // SessionRunner reaches this write. A failure here used to escape back through
            // useSessionRunner after Home had already unmounted, so Home's rollback catch
            // could never run and the occurrence/ledger stayed active/in_progress all day.
            //
            // Only external-plan executions can arrive through that claim path today. Use a
            // dynamic import to avoid a static service cycle: intradayLaunchClaim depends on
            // SessionExecutionService for its "does an execution already reference this
            // occurrence?" rollback guard. Passing this.db keeps emulator/injected Firestore
            // instances on the same database rather than falling back to the app singleton.
            if (params.occurrenceId && params.sessionSource.kind === 'external_plan') {
                try {
                    const { releaseIntradayMemberClaim } = await import('./intradayLaunchClaim');
                    const release = await releaseIntradayMemberClaim({
                        userId,
                        date: params.date,
                        occurrenceId: params.occurrenceId,
                        db: this.db,
                    });
                    if (!release.released) {
                        console.error(
                            `Could not release failed launch claim on ${params.occurrenceId}: ${release.reason}`,
                        );
                    }
                } catch (rollbackError) {
                    // Preserve the execution-start failure as the caller-visible error. A
                    // rollback failure is still logged because it may leave a visible active
                    // occurrence that needs the dashboard's reconciliation path.
                    console.error(
                        `Failed to roll back occurrence ${params.occurrenceId} after execution start failed:`,
                        rollbackError,
                    );
                }
            }
            throw error;
        }
        // Transaction reads/writes do not populate the latency-compensated cache.
        // Seed the complete parent before diary batches merge an updatedAt touch;
        // otherwise offline reload can see only that partial patch, not identity.
        // This read is outside launch rollback: the execution was already committed.
        await getDoc(this.executionRef(userId, claimed.executionId));
        return claimed;
    }

    /** Builds the execution document and the rule-bound lock payload that must move with it atomically. */
    private buildExecutionClaim(
        userId: string,
        executionId: string,
        params: StartExecutionParams,
    ): { execution: SessionExecution; lock: SessionExecutionLock } {
        const now = new Date().toISOString();
        const execution: SessionExecution = {
            userId,
            executionId,
            sessionSource: params.sessionSource,
            ...(params.occurrenceId ? { occurrenceId: params.occurrenceId } : {}),
            ...(params.prescriptionHash ? { prescriptionHash: params.prescriptionHash } : {}),
            ...(params.fitWorkoutFingerprint ? { fitWorkoutFingerprint: params.fitWorkoutFingerprint } : {}),
            ...(params.fitWorkoutFingerprintKind ? { fitWorkoutFingerprintKind: params.fitWorkoutFingerprintKind } : {}),
            date: params.date,
            startedAt: now,
            updatedAt: now,
            state: 'in_progress',
            schemaVersion: 1,
        };
        const lock: SessionExecutionLock = {
            userId,
            executionId,
            date: params.date,
            ...(params.occurrenceId
                ? { occurrenceId: params.occurrenceId }
                : params.prescriptionHash
                    ? { prescriptionHash: params.prescriptionHash }
                    : {}),
            allowCompletedReplacement: params.allowDuplicateCompleted === true,
            updatedAt: now,
            schemaVersion: 1,
        };
        return { execution, lock };
    }

    /**
     * Transactions remain the online authority for #663, but this repository also has an
     * explicit persistent-cache durability contract for gym-floor/offline logging
     * (`firebase.ts`). Firestore client transactions fail while offline, whereas ordinary
     * writes are queued by the SDK. An atomic write batch preserves that durability without
     * reopening the race because the lock rules arbitrate the claim when the batch reaches
     * the server.
     *
     * If an offline claim later loses that server-side race, resolve the winner exactly like
     * the transaction path rather than reporting a launch failure (which would incorrectly
     * trigger H4 occurrence/ledger rollback).
     */
    private async queueOfflineExecutionClaim(
        userId: string,
        executionId: string,
        params: StartExecutionParams,
    ): Promise<SessionExecution> {
        const lockDocRef = this.lockRef(userId, this.executionSlotKey(params));
        const { execution, lock } = this.buildExecutionClaim(userId, executionId, params);
        const batch = writeBatch(this.db);
        batch.set(this.executionRef(userId, executionId), execution);
        batch.set(lockDocRef, lock);

        try {
            await batch.commit();
            return execution;
        } catch (error) {
            if ((error as { code?: string })?.code === 'permission-denied') {
                const existing = await this.findExistingExecution(userId, {
                    date: params.date,
                    occurrenceId: params.occurrenceId,
                    prescriptionHash: params.prescriptionHash,
                });
                if (existing?.state === 'in_progress') return existing;
                if (existing?.state === 'completed' && !params.allowDuplicateCompleted) {
                    throw new ExecutionSlotConflictError(ALREADY_COMPLETED_MESSAGE);
                }
            }
            throw error;
        }
    }

    /**
     * The authoritative, race-safe half of `startExecution` (#663). Online, everything
     * runs inside one `runTransaction`, keyed on the deterministic
     * `session_execution_locks` doc `executionSlotKey` derives. Firestore retries a
     * transaction when a concurrently-read document changes, so two callers racing the same
     * slot cannot both create an execution.
     *
     * The pre-check can be stale by the time this transaction runs, so the decision is
     * re-derived from the pointed execution. A malformed/dangling/mismatched pointer is
     * repairable and falls through to a new claim. If the transaction cannot run because
     * Firestore is offline, `queueOfflineExecutionClaim` preserves persistent local writes
     * and lets security rules arbitrate the claim when connectivity returns.
     */
    private async claimExecutionSlot(
        userId: string,
        executionId: string,
        params: StartExecutionParams,
    ): Promise<SessionExecution> {
        const lockDocRef = this.lockRef(userId, this.executionSlotKey(params));

        try {
            return await runTransaction(this.db, async transaction => {
                const lockSnap = await transaction.get(lockDocRef);
                let conflicting: SessionExecution | null = null;
                if (lockSnap.exists()) {
                    const lockedExecutionId = (lockSnap.data() as Partial<SessionExecutionLock>).executionId;
                    if (typeof lockedExecutionId === 'string') {
                        const execSnap = await transaction.get(this.executionRef(userId, lockedExecutionId));
                        if (execSnap.exists()) {
                            const parsed = parseSessionExecutionDocument(execSnap.data(), execSnap.ref.path);
                            if (
                                parsed.status === 'AVAILABLE'
                                && parsed.data.executionId === lockedExecutionId
                                && this.executionMatchesSlot(parsed.data, params)
                            ) {
                                conflicting = parsed.data;
                            }
                        }
                    }
                }

                if (conflicting) {
                    if (conflicting.state === 'in_progress') {
                        return conflicting;
                    }
                    if (conflicting.state === 'completed' && !params.allowDuplicateCompleted) {
                        throw new ExecutionSlotConflictError(ALREADY_COMPLETED_MESSAGE);
                    }
                    // completed && allowDuplicateCompleted (redo), or abandoned: fall through
                    // and create a new execution doc, moving the lock pointer forward. The old
                    // doc remains as history, matching the pre-#663 behavior.
                }

                const { execution, lock } = this.buildExecutionClaim(userId, executionId, params);
                transaction.set(this.executionRef(userId, executionId), execution);
                transaction.set(lockDocRef, lock);
                return execution;
            });
        } catch (error) {
            if (error instanceof ExecutionSlotConflictError) throw error;
            if (!isFirestoreUnavailable(error)) throw error;
            return this.queueOfflineExecutionClaim(userId, executionId, params);
        }
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

    private diaryRef(userId: string, executionId: string, mutationId: string) {
        return doc(this.db, 'users', userId, 'session_executions', executionId, 'diaryMutations', mutationId);
    }

    private writeDiaryMutation(userId: string, mutation: SessionDiaryMutation, options?: DiaryWriteOptions): Promise<void> {
        const marker = this.diaryRef(userId, mutation.executionId, mutation.id);
        const validated = mutation.targetKind === 'entry'
            ? parseSessionEntryDocument(mutation.after, marker.path)
            : parseSessionRestEventDocument(mutation.after, marker.path);
        if (validated.status !== 'AVAILABLE') throw new Error('Cannot queue an invalid diary mutation.');
        const batch = writeBatch(this.db);
        const target = mutation.targetKind === 'entry'
            ? this.entryRef(userId, mutation.executionId, mutation.targetId)
            : this.restEventRef(userId, mutation.executionId, mutation.targetId);
        batch.set(target, mutation.after);
        batch.set(marker, mutation);
        batch.set(this.executionRef(userId, mutation.executionId), { updatedAt: mutation.at }, { merge: true });
        return commitDiaryWrite(batch, marker, {
            ...options,
            onLocallyAccepted: () => { saveDiaryReceipt(userId, { mutation, state: 'queued' }); },
            onAcknowledged: () => {
                removeDiaryReceipt(userId, mutation.executionId, mutation.id);
                options?.onAcknowledged?.();
            },
            onFailed: error => {
                if (options?.acknowledgeLocally) saveDiaryReceipt(userId, { mutation, state: 'failed' });
                options?.onFailed?.(error);
            },
        });
    }

    /** SDK retries the same atomic batch, including its immutable mutation marker. */
    logEntry(userId: string, executionId: string, entry: SessionEntry, options?: DiaryWriteOptions): Promise<void> {
        return this.serializeEntryWrite(userId, executionId, entry.id, () => this.writeEntry(userId, executionId, entry, options));
    }

    /** Serialize read -> queue -> local acceptance, including a rapid delete/undo. */
    private serializeEntryWrite(userId: string, executionId: string, entryId: string, action: () => Promise<void>): Promise<void> {
        const key = JSON.stringify([userId, executionId, entryId]);
        const previous = this.entryWrites.get(key) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(action);
        this.entryWrites.set(key, result);
        void result.finally(() => {
            if (this.entryWrites.get(key) === result) this.entryWrites.delete(key);
        }).catch(() => undefined);
        return result;
    }

    private async writeEntry(userId: string, executionId: string, entry: SessionEntry, options?: DiaryWriteOptions): Promise<void> {
        const cached = await getDocFromCache(this.entryRef(userId, executionId, entry.id)).catch(() => null);
        if (cached?.exists() && cached.data().diaryMutationId) {
            // Replaying the original log after correction must never roll back the diary.
            const acknowledged = waitForPendingWrites(this.db).then(options?.onAcknowledged, error => {
                options?.onFailed?.(error);
                throw error;
            });
            if (options?.acknowledgeLocally) {
                void acknowledged.catch(() => undefined);
                return;
            }
            await acknowledged;
            return;
        }
        const now = entry.updatedAt || entry.createdAt || new Date().toISOString();
        const mutationId = `log-${entry.id}`;
        const docPayload: SessionEntry = {
            ...entry,
            executionId,
            createdAt: entry.createdAt || now,
            updatedAt: now,
            diaryMutationId: mutationId,
            deletedAt: null,
        };
        await this.writeDiaryMutation(userId, {
            id: mutationId, executionId, targetId: entry.id, targetKind: 'entry',
            kind: 'log', at: now, before: null, after: docPayload,
        }, options);
    }

    /** Read locally first: a just-queued entry must be correctable without a round trip. */
    private async readEntryForMutation(userId: string, executionId: string, entryId: string): Promise<SessionEntry> {
        const ref = this.entryRef(userId, executionId, entryId);
        const snap = await getDocFromCache(ref).catch(() => getDoc(ref));
        const parsed = parseSessionEntryDocument(snap.exists() ? snap.data() : undefined, ref.path);
        if (parsed.status !== 'AVAILABLE' || parsed.data.id !== entryId || parsed.data.executionId !== executionId) {
            throw new Error('Cannot change an unavailable or invalid diary entry.');
        }
        return parsed.data;
    }

    correctEntry(
        userId: string,
        executionId: string,
        entryId: string,
        updatedEntry: Partial<SessionEntry>,
        options?: DiaryWriteOptions,
    ): Promise<void> {
        return this.serializeEntryWrite(userId, executionId, entryId,
            () => this.writeCorrection(userId, executionId, entryId, updatedEntry, options));
    }

    private async writeCorrection(userId: string, executionId: string, entryId: string, updatedEntry: Partial<SessionEntry>, options?: DiaryWriteOptions): Promise<void> {
        const before = await this.readEntryForMutation(userId, executionId, entryId);
        if (before.deletedAt) throw new Error('Restore the deleted diary entry before correcting it.');
        // A correction may change performed semantics, never the stable record identity.
        if (updatedEntry.id !== undefined && updatedEntry.id !== entryId
            || updatedEntry.executionId !== undefined && updatedEntry.executionId !== executionId
            || updatedEntry.createdAt !== undefined && updatedEntry.createdAt !== before.createdAt
            || updatedEntry.diaryMutationId !== undefined || updatedEntry.deletedAt !== undefined) {
            throw new Error('A correction cannot replace diary identity or deletion state.');
        }
        const now = new Date().toISOString();
        const mutationId = `correct-${crypto.randomUUID()}`;
        await this.writeDiaryMutation(userId, {
            id: mutationId, executionId, targetId: entryId, targetKind: 'entry',
            kind: 'correct', at: now, before,
            after: { ...before, ...updatedEntry, updatedAt: now, diaryMutationId: mutationId },
        }, options);
    }

    deleteEntry(userId: string, executionId: string, entryId: string, options?: DiaryWriteOptions): Promise<void> {
        return this.serializeEntryWrite(userId, executionId, entryId, () => this.writeDeletion(userId, executionId, entryId, options));
    }

    private async writeDeletion(userId: string, executionId: string, entryId: string, options?: DiaryWriteOptions): Promise<void> {
        const before = await this.readEntryForMutation(userId, executionId, entryId);
        if (before.deletedAt) return;
        const now = new Date().toISOString();
        const mutationId = `delete-${crypto.randomUUID()}`;
        await this.writeDiaryMutation(userId, {
            id: mutationId, executionId, targetId: entryId, targetKind: 'entry',
            kind: 'delete', at: now, before,
            after: { ...before, updatedAt: now, diaryMutationId: mutationId, deletedAt: now },
        }, options);
    }

    restoreEntry(userId: string, executionId: string, entryId: string, options?: DiaryWriteOptions): Promise<void> {
        return this.serializeEntryWrite(userId, executionId, entryId, () => this.writeRestoration(userId, executionId, entryId, options));
    }

    private async writeRestoration(userId: string, executionId: string, entryId: string, options?: DiaryWriteOptions): Promise<void> {
        const before = await this.readEntryForMutation(userId, executionId, entryId);
        if (!before.deletedAt) return;
        const now = new Date().toISOString();
        const mutationId = `restore-${crypto.randomUUID()}`;
        await this.writeDiaryMutation(userId, {
            id: mutationId, executionId, targetId: entryId, targetKind: 'entry',
            kind: 'restore', at: now, before,
            after: { ...before, updatedAt: now, diaryMutationId: mutationId, deletedAt: null },
        }, options);
    }

    async getLastDeletedEntry(userId: string, executionId: string): Promise<SessionEntry | null> {
        const snap = await getDocs(this.entriesColl(userId, executionId));
        const deleted = snap.docs.flatMap(item => {
            const parsed = parseSessionEntryDocument(item.data(), item.ref.path);
            return parsed.status === 'AVAILABLE' && parsed.data.executionId === executionId && parsed.data.deletedAt
                ? [parsed.data] : [];
        });
        return deleted.sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))[0] ?? null;
    }

    /** Metadata includes queued writes restored from a previous browser session. */
    watchDiarySync(userId: string, executionId: string, next: (pending: boolean) => void, failed: (error: unknown) => void): () => void {
        let active = true;
        let processing = Promise.resolve();
        const stop = onSnapshot(collection(this.db, 'users', userId, 'session_executions', executionId, 'diaryMutations'),
            { includeMetadataChanges: true }, snapshot => {
                processing = processing.then(async () => {
                    if (!active) return;
                    try {
                        const receipts = readDiaryReceipts(userId, executionId);
                        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
                            const persisted = new Map(snapshot.docs.map(item => [item.id, JSON.stringify(canonicalizeJson(item.data()))]));
                            for (const receipt of receipts) {
                                if (persisted.get(receipt.mutation.id) === JSON.stringify(canonicalizeJson(receipt.mutation))) removeDiaryReceipt(userId, executionId, receipt.mutation.id);
                                else {
                                    // Receipt storage is shared across tabs. This query snapshot
                                    // may predate another tab's acceptance; inspect the current
                                    // cache before calling a missing server marker a rejection.
                                    const current = await getDocFromCache(this.diaryRef(userId, executionId, receipt.mutation.id)).catch(() => null);
                                    if (!active) return;
                                    if (current?.metadata.hasPendingWrites) continue;
                                    if (current?.exists() && JSON.stringify(canonicalizeJson(current.data())) === JSON.stringify(canonicalizeJson(receipt.mutation))) {
                                        removeDiaryReceipt(userId, executionId, receipt.mutation.id);
                                    } else saveDiaryReceipt(userId, { ...receipt, state: 'failed' });
                                }
                            }
                        }
                        const remaining = readDiaryReceipts(userId, executionId);
                        if (remaining.some(receipt => receipt.state === 'failed')) failed(new Error('A locally accepted diary write was rejected. Its receipt is retained.'));
                        else next(snapshot.metadata.hasPendingWrites || remaining.length > 0);
                    } catch (error) { failed(error); }
                });
            }, failed);
        return () => { active = false; stop(); };
    }

    getDiaryReceipts(userId: string, executionId: string) {
        return readDiaryReceipts(userId, executionId);
    }

    watchEntries(userId: string, executionId: string, next: (entries: SessionEntry[], deleted: SessionEntry | null) => void, failed: (error: unknown) => void): () => void {
        return onSnapshot(this.entriesColl(userId, executionId), snapshot => {
            const all = snapshot.docs.flatMap(item => {
                const parsed = parseSessionEntryDocument(item.data(), item.ref.path);
                return parsed.status === 'AVAILABLE' && parsed.data.executionId === executionId ? [parsed.data] : [];
            });
            const entries = all.filter(entry => !entry.deletedAt).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
            const deleted = all.filter(entry => entry.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))[0] ?? null;
            next(entries, deleted);
        }, failed);
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
    async logRestEvent(userId: string, executionId: string, restEvent: SessionRestEvent, options?: DiaryWriteOptions): Promise<void> {
        const now = restEvent.updatedAt || restEvent.createdAt || new Date().toISOString();
        const docPayload: SessionRestEvent = {
            ...restEvent,
            executionId,
            createdAt: restEvent.createdAt || now,
            updatedAt: now,
        };
        await this.writeDiaryMutation(userId, {
            id: `rest-${restEvent.id}`, executionId, targetId: restEvent.id, targetKind: 'rest',
            kind: 'rest', at: now, before: null, after: docPayload,
        }, options);
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
                if (!parsed.data.deletedAt) entries.push(parsed.data);
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
        const q = query(
            collection(this.db, 'users', userId, 'session_executions'),
            where('state', '==', 'in_progress'),
        );
        const snap = await getDocs(q);
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
        const collRef = collection(this.db, 'users', userId, 'session_executions');
        const q = query(collRef, where('occurrenceId', '==', occurrenceId));
        const snap = await getDocs(q);
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
     * Looks up an existing execution for a given date and optional occurrence or prescription.
     * Prioritizes in-progress executions (there is active work to resume), then completed
     * ones, sorted by most recent startedAt.
     */
    async findExistingExecution(
        userId: string,
        params: {
            date: string;
            occurrenceId?: string;
            prescriptionHash?: string;
        },
    ): Promise<SessionExecution | null> {
        const collRef = collection(this.db, 'users', userId, 'session_executions');
        const q = query(collRef, where('date', '==', params.date));
        const snap = await getDocs(q);
        const candidates: SessionExecution[] = [];

        for (const docSnap of snap.docs) {
            const parsed = parseSessionExecutionDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status !== 'AVAILABLE' || parsed.data.executionId !== docSnap.id) continue;
            const execution = parsed.data;

            if (params.occurrenceId) {
                if (execution.occurrenceId === params.occurrenceId) {
                    candidates.push(execution);
                }
            } else {
                // If no occurrenceId was requested (e.g. today's primary catalog recommendation),
                // only match executions that are not bound to a different occurrence AND whose
                // prescriptionHash agrees with the request -- an execution missing a hash only
                // matches a hash-less request, so an unrelated catalog session from earlier the
                // same day is never mistaken for the one being checked.
                if (execution.occurrenceId) continue;
                const hashesMatch = params.prescriptionHash
                    ? execution.prescriptionHash === params.prescriptionHash
                    : !execution.prescriptionHash;
                if (hashesMatch) {
                    candidates.push(execution);
                }
            }
        }

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            // An active execution always outranks a finished one: a stale completed record
            // must never hide a redo that is still in progress (that would let the caller
            // re-run startExecution and orphan the in-progress doc under a fresh id).
            const stateRank = (s: SessionExecutionState) => (s === 'in_progress' ? 2 : s === 'completed' ? 1 : 0);
            const rankDiff = stateRank(b.state) - stateRank(a.state);
            if (rankDiff !== 0) return rankDiff;
            return b.startedAt.localeCompare(a.startedAt);
        });

        return candidates[0] ?? null;
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
