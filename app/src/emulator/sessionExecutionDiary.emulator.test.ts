/**
 * WP0 harness for issue #895 — structured execution as the canonical lossless diary.
 *
 * Purpose: pin current `SessionExecutionService` behavior against the Firestore
 * emulator before any WP1–WP3 write-path change. Each test maps to a #895
 * acceptance criterion. Tests that document a gap assert the *current* thin
 * behavior (and name the WP that must change it) so the suite stays green while
 * WPs demonstrate delta.
 *
 * No behavior change in this file. No POLICY_VERSION impact. No recommendation
 * authority.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, type Firestore } from 'firebase/firestore';
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

    it('reuses the same entry id on retry so the write converges (acceptance: retry never duplicates)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-retry', 'occ-diary-retry');

        const payload = entry('entry-retry-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z');
        await service.logEntry(USER_ID, execution.executionId, payload);
        await service.logEntry(USER_ID, execution.executionId, payload);

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.filter(e => e.id === 'entry-retry-1').length).toBe(1);
    });

    it('documents the current hook gap: a retried intent with a fresh id duplicates (WP1 must assign id once)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-dup', 'occ-diary-dup');

        // `useSessionRunner` mints `entry-<ts>-<uuid>` per attempt today, so two
        // attempts at the same logical set land as two docs. Pinned here so WP1
        // (D2: entry identity is client-generated and retry-stable) shows a delta.
        await service.logEntry(USER_ID, execution.executionId, entry('entry-attempt-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.logEntry(USER_ID, execution.executionId, entry('entry-attempt-2', execution.executionId, 8, '2026-09-29T06:00:01.000Z'));

        const snap = await getDocs(collection(db, 'users', USER_ID, 'session_executions', execution.executionId, 'entries'));
        expect(snap.docs.length).toBe(2);
    });

    it('documents the current correction gap: correctEntry is a shallow merge with no audit (WP1 must add revision discipline)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-correct', 'occ-diary-correct');

        await service.logEntry(USER_ID, execution.executionId, entry('entry-corr-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.correctEntry(USER_ID, execution.executionId, 'entry-corr-1', {
            payload: { kind: 'repetition', setIndex: 1, reps: 10 },
        } as Partial<SessionEntry>);

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(1);
        expect(entries[0]?.payload).toMatchObject({ reps: 10 });
        // No prior-value preservation today: the 8-rep identity is unrecoverable.
        // WP1 D3 must make correction history auditable instead of silent.
        expect((entries[0] as unknown as Record<string, unknown>).priorValues).toBeUndefined();
        expect((entries[0] as unknown as Record<string, unknown>).revision).toBeUndefined();
    });

    it('documents the current delete gap: deleteEntry leaves no tombstone so undo cannot survive reload (WP1)', async () => {
        const service = new SessionExecutionService(db);
        const execution = await startInProgress(db, 'exec-diary-delete', 'occ-diary-delete');

        await service.logEntry(USER_ID, execution.executionId, entry('entry-del-1', execution.executionId, 8, '2026-09-29T06:00:00.000Z'));
        await service.deleteEntry(USER_ID, execution.executionId, 'entry-del-1');

        const entries = await service.getEntries(USER_ID, execution.executionId);
        expect(entries.length).toBe(0);
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
    });
});
