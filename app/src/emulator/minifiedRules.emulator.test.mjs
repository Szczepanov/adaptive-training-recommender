import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { minifyRules } from '../../scripts/minify-firestore-rules.mjs';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('minified deployment rules', () => {
    let environment;
    beforeAll(async () => {
        environment = await initializeTestEnvironment({
            projectId: 'demo-minified-deployment-rules',
            firestore: { rules: minifyRules(readFileSync('firestore.rules', 'utf8')) },
        });
    });
    afterAll(async () => { await environment?.cleanup(); });

    it('compiles the upload source and preserves ownership, required fields and immutable prescriptions', async () => {
        const owner = environment.authenticatedContext('owner').firestore();
        const foreign = environment.authenticatedContext('foreign').firestore();
        const anonymous = environment.unauthenticatedContext().firestore();
        const prescription = {
            userId: 'owner', schemaVersion: 1, prescriptionHash: 'rx-1',
            sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
            definitionHash: 'definition-1', blocks: [], createdAt: '2026-10-09T10:00:00Z',
        };
        const path = 'users/owner/execution_prescriptions/rx-1';
        await assertFails(setDoc(doc(foreign, path), prescription));
        await assertFails(setDoc(doc(anonymous, path), prescription));
        await assertFails(setDoc(doc(owner, path), { ...prescription, sessionSource: { kind: 'unplanned_fixture' } }));
        await assertSucceeds(setDoc(doc(owner, path), prescription));
        await assertFails(updateDoc(doc(owner, path), { definitionHash: 'changed' }));
        await assertFails(deleteDoc(doc(owner, path)));
    });

    it('preserves interpolated transaction paths and launch-lock exclusivity', async () => {
        const db = environment.authenticatedContext('owner').firestore();
        const execution = {
            userId: 'owner', executionId: 'exec-1', date: '2026-10-09',
            sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
            prescriptionHash: 'rx-1', state: 'in_progress', schemaVersion: 1,
            startedAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T10:00:00Z',
        };
        const lock = {
            userId: 'owner', executionId: 'exec-1', date: execution.date,
            prescriptionHash: 'rx-1', allowCompletedReplacement: false,
            schemaVersion: 1, updatedAt: execution.updatedAt,
        };
        const batch = writeBatch(db);
        batch.set(doc(db, 'users/owner/session_executions/exec-1'), execution);
        batch.set(doc(db, 'users/owner/session_execution_locks/slot-1'), lock);
        await assertSucceeds(batch.commit());
        await assertFails(updateDoc(doc(db, 'users/owner/session_execution_locks/slot-1'), { executionId: 'exec-2' }));
    });
});
