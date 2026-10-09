/**
 * WP0 harness for issue #895 — structured execution as the canonical lossless diary.
 *
 * WP1 closes the queued-entry, correction and deletion gaps in the original WP0
 * harness. Lifecycle tests retain the current WP2 boundary. Browser tests prove
 * actual IndexedDB reload; a new service instance here only proves the read seam.
 * No POLICY_VERSION impact or recommendation authority.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, disableNetwork, doc, enableNetwork, getDoc, getDocs, setDoc, waitForPendingWrites, writeBatch, type Firestore } from 'firebase/firestore';
import { SessionExecutionService } from '../services/sessionExecutionService';
import type { SessionEntry } from '../sessions/models';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATE = '2026-09-29';
const USER_ID = 'athlete-895-diary-harness';

function entry(id: string, executionId: string, reps: number, completedAt: string): SessionEntry {
    return {
        id,
        executionId,
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
        payload: { kind: 'repetition', setIndex: 1, reps },
    };
}

async function startInProgress(db: Firestore, executionId: string, occurrenceId: string) {
    const service = new SessionExecutionService(db);
    return service.startExecution(USER_ID, executionId, {
        sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
        occurrenceId,
        date: DATE,
    });
}

emulatorDescribe('SessionExecutionService diary harness (#895 WP0)', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-895-session-execution-diary',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('logs N sets and reads them back (acceptance: reload restores entries)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-1', 'occ-diary-1');

        await service.logEntry(USER_ID, execution.executionId, entry('entry-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.logEntry(USER_ID, execution.executionId, entry('entry-2', execution.executionId, 8, '2026-09-29T06:05:00.000Z'));

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.map(e => e.id).sort()).toEqual(['entry-1', 'entry-2']);
    });

    it('persists sets carrying movement composition patterns and degraded composition', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-comp', 'occ-diary-comp');

        const entryWithComposition: SessionEntry = {
            ...entry('entry-comp-1', execution.executionId, 5, '2026-09-29T06:00:00.000Z'),
            stepId: 'squat-step-1',
            exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
            compositionPatterns: ['knee_dominant_bilateral'],
            degradedComposition: {
                pattern: 'unilateral_lower_body',
                reason: 'Pain-free substitute chosen',
            },
        };

        await service.logEntry(USER_ID, execution.executionId, entryWithComposition);

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(1);
        expect(entries[0]?.compositionPatterns).toEqual(['knee_dominant_bilateral']);
        expect(entries[0]?.degradedComposition).toEqual({
            pattern: 'unilateral_lower_body',
            reason: 'Pain-free substitute chosen',
        });

        // Malformed composition structures fail closed at rules
        const badCompositionDoc = doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'entries', 'entry-bad-comp');
        await assertFails(setDoc(badCompositionDoc, {
            ...entry('entry-bad-comp', execution.executionId, 5, '2026-09-29T06:05:00.000Z'),
            compositionPatterns: 'not-a-list',
        }));

        const badDegradedDoc = doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'entries', 'entry-bad-deg');
        await assertFails(setDoc(badDegradedDoc, {
            ...entry('entry-bad-deg', execution.executionId, 5, '2026-09-29T06:10:00.000Z'),
            degradedComposition: {
                pattern: '',
                reason: '',
            },
        }));
    });

    it('reuses the same entry id on retry so the write converges (acceptance: retry never duplicates)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-retry', 'occ-diary-retry');

        const payload = entry('entry-retry-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z');
        await service.logEntry(USER_ID, execution.executionId, payload);
        await service.logEntry(USER_ID, execution.executionId, payload);

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.filter(e => e.id === 'entry-retry-1').length).toBe(1);
    });

    it('retains distinct entry ids as distinct sets rather than deduplicating by similar content', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-dup', 'occ-diary-dup');

        // Idempotency belongs to the caller's stable intent id. Similar payloads
        // cannot identify duplicate work: an athlete can legitimately log both.
        await service.logEntry(USER_ID, execution.executionId, entry('entry-attempt-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.logEntry(USER_ID, execution.executionId, entry('entry-attempt-2', execution.executionId, 8, '2026-09-29T06:00:01.000Z'));

        const snap = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'entries'));
        expect(snap.docs.length).toBe(2);
    });

    it('preserves correction history and never replays an original log over a correction', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-correct', 'occ-diary-correct');

        await service.logEntry(USER_ID, execution.executionId, entry('entry-corr-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.correctEntry(USER_ID, execution.executionId, 'entry-corr-1', {
            payload: { kind: 'repetition', setIndex: 1, reps: 10 },
        } as Partial<SessionEntry>);

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(1);
        expect(entries[0]?.payload).toMatchObject({ reps: 10 });
        const audit = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations'));
        const correction = audit.docs.find(item => item.data().kind === 'correct')?.data();
        expect(correction?.before.payload.reps).toBe(8);
        expect(correction?.after.payload.reps).toBe(10);
        await service.logEntry(USER_ID, execution.executionId, entry('entry-corr-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        expect((await service.getEntries(USER_ID, execution.executionId))[0]?.payload).toMatchObject({ reps: 10 });
    });

    it('retains deletion evidence and restores the corrected entry after reload', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-delete', 'occ-diary-delete');

        await service.logEntry(USER_ID, execution.executionId, entry('entry-del-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.deleteEntry(USER_ID, execution.executionId, 'entry-del-1');

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(0);
        const reloaded = new SessionExecutionService(db);
        expect((await reloaded.getLastDeletedEntry(USER_ID, execution.executionId))?.id).toBe('entry-del-1');
        await reloaded.restoreEntry(USER_ID, execution.executionId, 'entry-del-1');
        expect((await reloaded.getEntries(USER_ID, execution.executionId)).map(item => item.id)).toEqual(['entry-del-1']);
        expect(await reloaded.getLastDeletedEntry(USER_ID, execution.executionId)).toBeNull();
        const audit = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations'));
        expect(audit.docs.map(item => item.data().kind).sort()).toEqual(['delete', 'log', 'restore']);
    });

    it('queues several sets, a correction, tombstone and rest offline and replays each once', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-offline', 'occ-offline');
        const local = { acknowledgeLocally: true };
        await disableNetwork(db);
        try {
            for (let index = 1; index <= 3; index++) {
                await service.logEntry(USER_ID, execution.executionId, entry(`offline-${index}`, execution.executionId, 8, `2026-09-29T06:0${index}:00.000Z`), local);
            }
            await service.correctEntry(USER_ID, execution.executionId, 'offline-1', { payload: { kind: 'repetition', setIndex: 1, reps: 10 } }, local);
            await service.deleteEntry(USER_ID, execution.executionId, 'offline-2', local);
            await service.logRestEvent(USER_ID, execution.executionId, {
                id: 'offline-rest', executionId: execution.executionId, afterEntryId: 'offline-1',
                startedAt: '2026-09-29T06:01:00.000Z', endedAt: '2026-09-29T06:02:00.000Z',
                actualSeconds: 60, endReason: 'skipped', createdAt: '2026-09-29T06:02:00.000Z', updatedAt: '2026-09-29T06:02:00.000Z',
            }, local);
            const reloadedService = new SessionExecutionService(db);
            expect((await reloadedService.getEntries(USER_ID, execution.executionId)).map(item => item.id)).toEqual(['offline-1', 'offline-3']);
            expect((await reloadedService.getLastDeletedEntry(USER_ID, execution.executionId))?.id).toBe('offline-2');
            await reloadedService.restoreEntry(USER_ID, execution.executionId, 'offline-2', local);
            await reloadedService.logEntry(USER_ID, execution.executionId, entry('offline-1', execution.executionId, 8, '2026-09-29T06:01:00.000Z'), local);
        } finally {
            await enableNetwork(db);
        }
        await waitForPendingWrites(db);
        const persisted = await service.getEntries(USER_ID, execution.executionId);
        expect(persisted).toHaveLength(3);
        expect(persisted.find(item => item.id === 'offline-1')?.payload).toMatchObject({ reps: 10 });
        expect(await service.getRestEvents(USER_ID, execution.executionId)).toHaveLength(1);
        const audit = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations'));
        expect(audit.size).toBe(7);
    });

    it('denies cross-user reads, audit replacement, unaudited rewrites and physical deletion', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-audit-rules', 'occ-audit-rules');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-audit', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        const path = ['users', USER_ID, 'session_executions', execution.executionId] as const;
        const marker = doc(db, ...path, 'diaryMutations', 'log-entry-audit');
        const target = doc(db, ...path, 'entries', 'entry-audit');
        const other = testEnvironment.authenticatedContext('other-athlete').firestore() as unknown as Firestore;
        await assertFails(getDoc(doc(other, ...path, 'diaryMutations', 'log-entry-audit')));
        await assertFails(setDoc(marker, { at: 'tampered' }, { merge: true }));
        await assertFails(deleteDoc(marker));
        await assertFails(setDoc(target, { payload: { kind: 'repetition', setIndex: 1, reps: 20 } }, { merge: true }));
        await assertFails(deleteDoc(target));
    });

    it('rejects a stale concurrent correction without erasing the first correction', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-conflict', 'occ-conflict');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-conflict', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        const target = doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'entries', 'entry-conflict');
        const before = (await getDoc(target)).data()!;
        await service.correctEntry(USER_ID, execution.executionId, 'entry-conflict', { payload: { kind: 'repetition', setIndex: 1, reps: 10 } });
        const id = 'stale-correction';
        const at = '2026-09-29T06:10:00.000Z';
        const after = { ...before, diaryMutationId: id, updatedAt: at, payload: { kind: 'repetition', setIndex: 1, reps: 12 } };
        const batch = writeBatch(db);
        batch.set(target, after);
        batch.set(doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations', id), {
            id, executionId: execution.executionId, targetId: 'entry-conflict', targetKind: 'entry', kind: 'correct', at, before, after,
        });
        await assertFails(batch.commit());
        expect((await service.getEntries(USER_ID, execution.executionId))[0]?.payload).toMatchObject({ reps: 10 });
    });

    it('serializes overlapping offline deletion and undo through local acceptance', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-fast-undo', 'occ-fast-undo');
        await service.logEntry(USER_ID, execution.executionId, entry('fast-undo', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await disableNetwork(db);
        try {
            const deletion = service.deleteEntry(USER_ID, execution.executionId, 'fast-undo', { acknowledgeLocally: true });
            const restoration = service.restoreEntry(USER_ID, execution.executionId, 'fast-undo', { acknowledgeLocally: true });
            await Promise.all([deletion, restoration]);
            expect((await service.getEntries(USER_ID, execution.executionId)).map(item => item.id)).toEqual(['fast-undo']);
        } finally { await enableNetwork(db); }
        await waitForPendingWrites(db);
        const audit = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations'));
        expect(audit.docs.map(item => item.data().kind).sort()).toEqual(['delete', 'log', 'restore']);
    });

    it('double complete fails closed at rules: the second write is rejected, state stays completed (WP2 must make it a client no-op)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-complete', 'occ-diary-complete');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-dc-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));

        await service.transitionExecution(USER_ID, execution.executionId, 'completed');
        // Rules only allow updates while the stored state is `in_progress`, so a
        // forced second write fails closed instead of creating a second completed
        // execution. WP2 keeps this guarantee and turns the client path into an
        // explicit already-completed no-op rather than a generic error.
        await expect(service.transitionExecution(USER_ID, execution.executionId, 'completed')).rejects.toBeDefined();

        const current = await service.getExecution(USER_ID, execution.executionId);
        expect(current.status).toBe('AVAILABLE');
        if (current.status === 'AVAILABLE') {
            expect(current.data.state).toBe('completed');
        }
    });

    it('abandonment retains prior sets (acceptance: abandoned keeps partial evidence)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-abandon', 'occ-diary-abandon');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-ab-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));

        await service.transitionExecution(USER_ID, execution.executionId, 'abandoned');

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(1);
    });

    it('reload restores execution identity plus entries and never fabricates rest (acceptance: resume)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-reload', 'occ-diary-reload');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-rl-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));

        // Reload seam: a fresh service instance rehydrates via the same reads the
        // runner restore effect uses (`findInProgressExecution` + `getEntries`).
        const reloaded = new SessionExecutionService(db);
        const resumed = await reloaded.findInProgressExecution(USER_ID);
        expect(resumed?.executionId).toBe(execution.executionId);
        const entries = await reloaded.getEntries(USER_ID, execution.executionId);
        expect(entries.map(e => e.id)).toEqual(['entry-rl-1']);

        // #911 contract: no in-flight rest is reconstructed from timestamps.
        // Nothing was durably closed here, so no rest history exists to restore.
        const rests = await reloaded.getRestEvents(USER_ID, execution.executionId);
        expect(rests.length).toBe(0);
    });

    it('keeps a durably closed rest as history across reload (acceptance: truthful rest only)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-rest', 'occ-diary-rest');
        await service.logEntry(USER_ID, execution.executionId, entry('entry-rest-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.logRestEvent(USER_ID, execution.executionId, {
            id: 'rest-2026-09-29T06:01:00.000Z-entry-rest-1',
            executionId: execution.executionId,
            afterEntryId: 'entry-rest-1',
            startedAt: '2026-09-29T06:01:00.000Z',
            endedAt: '2026-09-29T06:02:30.000Z',
            actualSeconds: 90,
            endReason: 'timer_elapsed',
            createdAt: '2026-09-29T06:02:30.000Z',
            updatedAt: '2026-09-29T06:02:30.000Z',
        });

        const reloaded = new SessionExecutionService(db);
        const rests = await reloaded.getRestEvents(USER_ID, execution.executionId);
        expect(rests.map(r => r.id)).toEqual(['rest-2026-09-29T06:01:00.000Z-entry-rest-1']);
        const restRef = doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'restEvents', rests[0].id);
        await assertFails(setDoc(restRef, { actualSeconds: 999 }, { merge: true }));
        await service.logRestEvent(USER_ID, execution.executionId, rests[0]);
        expect((await service.getRestEvents(USER_ID, execution.executionId))[0]?.actualSeconds).toBe(90);
        const noncanonical = { ...rests[0], id: 'noncanonical-rest' };
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'restEvents', noncanonical.id), noncanonical);
        batch.set(doc(db, 'users', USER_ID, 'session_executions', execution.executionId, 'diaryMutations', 'custom-marker'), {
            id: 'custom-marker', executionId: execution.executionId, targetId: noncanonical.id,
            targetKind: 'rest', kind: 'rest', at: noncanonical.updatedAt, before: null, after: noncanonical,
        });
        await assertFails(batch.commit());
    });
});
