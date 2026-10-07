import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-manual-replacement-launch';
const DATE = '2026-10-07';
const NOW = '2026-10-07T06:00:00.000Z';
const OCCURRENCE_ID = 'occ-primary';
const EXECUTION_ID = 'exec-primary';
const executionPath = `users/${USER_ID}/session_executions/${EXECUTION_ID}`;
const lockPath = `users/${USER_ID}/session_execution_locks/occ_${DATE}_${OCCURRENCE_ID}`;

function queuedExecutionClaim(db: Firestore, occurrenceId: string | null = OCCURRENCE_ID) {
    const batch = writeBatch(db);
    batch.set(doc(db, executionPath), {
        userId: USER_ID, executionId: EXECUTION_ID, date: DATE,
        sessionSource: { kind: 'catalog', workoutId: 'w1', catalogVersion: '1' },
        ...(occurrenceId ? { occurrenceId } : {}),
        state: 'in_progress', startedAt: NOW, updatedAt: NOW, schemaVersion: 1,
    });
    batch.set(doc(db, occurrenceId ? lockPath : `users/${USER_ID}/session_execution_locks/rx_${DATE}_nohash`), {
        userId: USER_ID, executionId: EXECUTION_ID, date: DATE,
        ...(occurrenceId ? { occurrenceId } : {}),
        allowCompletedReplacement: false, updatedAt: NOW, schemaVersion: 1,
    });
    return batch.commit();
}

emulatorDescribe('Manual replacement stale primary launch', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-manual-replacement-launch',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
    });

    afterEach(async () => { await testEnvironment.clearFirestore(); });
    afterAll(async () => { await testEnvironment.cleanup(); });

    async function seedOccurrence(state: string): Promise<void> {
        await testEnvironment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`), {
                userId: USER_ID, occurrenceId: OCCURRENCE_ID, date: DATE, authority: 'external_plan',
                externalPlanRef: { planId: 'plan-1', revision: 1, sessionId: 'primary', contentHash: 'a'.repeat(64) },
                state, createdAt: NOW, updatedAt: NOW,
            });
        });
    }

    it.each(['scheduled', 'active', 'missing'])('allows the queued execution and lock batch for a %s occurrence', async state => {
        if (state !== 'missing') await seedOccurrence(state);
        await assertSucceeds(queuedExecutionClaim(db));
        expect((await getDoc(doc(db, executionPath))).data()?.state).toBe('in_progress');
        expect((await getDoc(doc(db, lockPath))).data()?.executionId).toBe(EXECUTION_ID);
    });

    it('atomically rejects a stale queued primary execution and lock after replacement supersedes the occurrence', async () => {
        await seedOccurrence('superseded');
        await assertFails(queuedExecutionClaim(db));
        expect((await getDoc(doc(db, executionPath))).exists()).toBe(false);
        expect((await getDoc(doc(db, lockPath))).exists()).toBe(false);
    });

    it('allows occurrence-less queued execution and lock batches', async () => {
        await assertSucceeds(queuedExecutionClaim(db, null));
        expect((await getDoc(doc(db, executionPath))).exists()).toBe(true);
    });

    it('keeps logging and completion updates available after an existing execution occurrence is superseded', async () => {
        await seedOccurrence('scheduled');
        await assertSucceeds(queuedExecutionClaim(db));
        await seedOccurrence('superseded');
        await assertSucceeds(updateDoc(doc(db, executionPath), { notes: 'Recorded work' }));
        await assertSucceeds(updateDoc(doc(db, executionPath), {
            state: 'completed', completedAt: '2026-10-07T07:00:00.000Z', updatedAt: '2026-10-07T07:00:00.000Z',
        }));
    });
});
