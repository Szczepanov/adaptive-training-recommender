/**
 * #663 regression: two concurrent `startExecution` calls for the same (date, occurrenceId)
 * or (date, prescriptionHash) identity must produce exactly one `session_executions`
 * document, not two orphaned `in_progress` executions. The mocked unit tests in
 * `sessionExecutionService.test.ts` can only fake the transactional recheck's inputs; only a
 * real Firestore backend actually exercises the optimistic-concurrency retry
 * `SessionExecutionService.claimExecutionSlot` relies on to close the race, so this belongs
 * here rather than there.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, type Firestore } from 'firebase/firestore';
import { SessionExecutionService } from '../services/sessionExecutionService';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATE = '2026-09-18';
const USER_ID = 'athlete-execution-race';

emulatorDescribe('SessionExecutionService concurrent startExecution (#663)', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-663-session-execution-toctou',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        // `.firestore()` is declared as the legacy compat type for interop but returns the
        // modular SDK instance -- same bridge used by the launch-claim rollback suite.
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('never creates two in_progress executions for the same date+occurrence when two tabs race Start', async () => {
        const service = new SessionExecutionService(db);
        const occurrenceId = 'occ-race-1';

        const [a, b] = await Promise.all([
            service.startExecution(USER_ID, 'exec-tab-a', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                occurrenceId,
                date: DATE,
            }),
            service.startExecution(USER_ID, 'exec-tab-b', {
                sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
                occurrenceId,
                date: DATE,
            }),
        ]);

        expect(a.executionId).toBe(b.executionId);

        const snap = await getDocs(collection(db, 'users', USER_ID, 'session_executions'));
        expect(snap.docs.length).toBe(1);
        expect(snap.docs[0].data().state).toBe('in_progress');
    });

    it('keeps date in occurrence identity so a reused/rescheduled occurrence id does not resume another day', async () => {
        const service = new SessionExecutionService(db);
        const occurrenceId = 'occ-reused-across-days';

        const first = await service.startExecution(USER_ID, 'exec-day-1', {
            sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
            occurrenceId,
            date: DATE,
        });
        const second = await service.startExecution(USER_ID, 'exec-day-2', {
            sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
            occurrenceId,
            date: '2026-09-19',
        });

        expect(first.executionId).toBe('exec-day-1');
        expect(second.executionId).toBe('exec-day-2');

        const snap = await getDocs(collection(db, 'users', USER_ID, 'session_executions'));
        expect(snap.docs.length).toBe(2);
    });

    it('never creates two in_progress executions for the same date+hash-less catalog identity when two tabs race Start', async () => {
        const service = new SessionExecutionService(db);

        const [a, b] = await Promise.all([
            service.startExecution(USER_ID, 'exec-fixture-a', {
                sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fx-1' },
                date: DATE,
            }),
            service.startExecution(USER_ID, 'exec-fixture-b', {
                sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fx-1' },
                date: DATE,
            }),
        ]);

        expect(a.executionId).toBe(b.executionId);

        const snap = await getDocs(collection(db, 'users', USER_ID, 'session_executions'));
        expect(snap.docs.length).toBe(1);
    });
});
