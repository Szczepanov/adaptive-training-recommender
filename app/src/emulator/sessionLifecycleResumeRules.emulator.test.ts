import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-lifecycle-rules';
const executionPath = (id: string) => `users/${ownerId}/session_executions/${id}`;
const source = { kind: 'unplanned_fixture', fixtureId: 'fixture-1' };
const start = '2026-10-05T10:00:00.000Z';

function inProgressExecution(id: string) {
    return {
        userId: ownerId,
        executionId: id,
        sessionSource: source,
        prescriptionHash: `rx-${id}`,
        date: '2026-10-05',
        startedAt: start,
        updatedAt: start,
        state: 'in_progress',
        schemaVersion: 1,
    };
}

async function seedExecution(id: string) {
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), executionPath(id)), inProgressExecution(id));
    });
}

emulatorDescribe('Firestore rules — session lifecycle + replay snapshots (#895 WP2/WP3)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-lifecycle-rules',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows one in_progress -> completed transition with canonical evidence and then makes it final', async () => {
        await seedExecution('exec-complete');
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(ownerDb, executionPath('exec-complete'));
        const terminalAt = '2026-10-05T11:00:00.000Z';

        await assertSucceeds(updateDoc(ref, {
            state: 'completed',
            updatedAt: terminalAt,
            completedAt: terminalAt,
            sessionRpe: 8,
            completionEvidence: {
                submittedAt: terminalAt,
                sessionRpe: 8,
                completedFraction: 1,
                unexpectedFatigue: false,
                note: 'finished',
            },
        }));

        await assertFails(updateDoc(ref, { notes: 'late mutation', updatedAt: '2026-10-05T11:01:00.000Z' }));
        await assertFails(updateDoc(ref, { state: 'abandoned', updatedAt: '2026-10-05T11:02:00.000Z' }));
    });

    it('allows one in_progress -> abandoned transition and rejects a later completion', async () => {
        await seedExecution('exec-abandon');
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(ownerDb, executionPath('exec-abandon'));
        await assertSucceeds(updateDoc(ref, {
            state: 'abandoned',
            updatedAt: '2026-10-05T10:30:00.000Z',
            notes: 'stopped',
        }));
        await assertFails(updateDoc(ref, {
            state: 'completed',
            updatedAt: '2026-10-05T10:31:00.000Z',
            completedAt: '2026-10-05T10:31:00.000Z',
        }));
    });

    it('rejects completion evidence on an abandoned winner', async () => {
        await seedExecution('exec-invalid-abandon');
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(updateDoc(doc(ownerDb, executionPath('exec-invalid-abandon')), {
            state: 'abandoned',
            updatedAt: '2026-10-05T10:30:00.000Z',
            completionEvidence: { submittedAt: '2026-10-05T10:30:00.000Z', sessionRpe: 8 },
        }));
    });

    it('accepts a self-contained prescription snapshot and rejects malformed snapshot storage', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const valid = {
            userId: ownerId,
            schemaVersion: 1,
            prescriptionHash: 'rx-snapshot',
            sessionSource: source,
            definitionHash: 'definition-hash',
            blocks: [],
            definitionSnapshot: {
                schemaVersion: 1,
                title: 'Pinned workout',
                intent: 'training',
                modalities: ['Strength'],
                blocks: [],
            },
            createdAt: start,
        };
        await assertSucceeds(setDoc(doc(ownerDb, `users/${ownerId}/execution_prescriptions/rx-snapshot`), valid));

        await assertFails(setDoc(doc(ownerDb, `users/${ownerId}/execution_prescriptions/rx-bad-snapshot`), {
            ...valid,
            prescriptionHash: 'rx-bad-snapshot',
            definitionSnapshot: { schemaVersion: 1, intent: 'training', blocks: [] },
        }));
    });

    it('keeps the existing updatedAt-only parent touch available for live diary batches', async () => {
        await seedExecution('exec-parent-touch');
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(updateDoc(doc(ownerDb, executionPath('exec-parent-touch')), {
            updatedAt: '2026-10-05T10:01:00.000Z',
        }));
    });

    it('rejects arbitrary non-terminal field mutations while an execution is in progress', async () => {
        await seedExecution('exec-progress');
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await expect(assertFails(updateDoc(doc(ownerDb, executionPath('exec-progress')), {
            notes: 'not terminal',
            updatedAt: '2026-10-05T10:01:00.000Z',
        }))).resolves.toBeUndefined();
    });
});
