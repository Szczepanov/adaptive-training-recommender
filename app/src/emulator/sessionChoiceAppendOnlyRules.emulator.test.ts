import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let env: RulesTestEnvironment;
const userId = 'choice-owner'; const executionId = 'exec-choice';
const executionPath = `users/${userId}/session_executions/${executionId}`; const entriesPath = `${executionPath}/entries`; const at = '2026-10-05T08:00:00Z';
function choice(id: string, choiceId = 'c1', optionId = 'o1', extra: Record<string, unknown> = {}) { return { id, executionId, stepId: 's1', selectedOptionId: optionId, completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'choice', choiceId, optionId }, ...extra }; }
function performed(id: string, reps = 5, extra: Record<string, unknown> = {}) { return { id, executionId, stepId: 's1', completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'repetition', setIndex: 1, reps }, ...extra }; }

emulatorDescribe('Firestore rules — append-only session choices (#994)', () => {
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-choice-append-only', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
    afterEach(async () => { await env.clearFirestore(); });
    afterAll(async () => { await env.cleanup(); });
    async function seedExecution() { await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), executionPath), { state: 'in_progress' }); }); }

    it('rejects edit, tombstone/restore, and physical delete of persisted choices', async () => {
        await seedExecution(); const db = env.authenticatedContext(userId).firestore(); const ref = doc(db, entriesPath, 'choice-1'); const original = choice('choice-1');
        await assertSucceeds(setDoc(ref, original));
        await assertFails(setDoc(ref, { ...original, updatedAt: '2026-10-05T08:01:00Z', payload: { kind: 'choice', choiceId: 'c1', optionId: 'o2' } }));
        await assertFails(setDoc(ref, { ...original, updatedAt: '2026-10-05T08:01:00Z', deletedAt: '2026-10-05T08:01:00Z' }));
        await assertFails(deleteDoc(ref));
        await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), entriesPath, 'legacy-deleted'), choice('legacy-deleted', 'c2', 'o1', { deletedAt: at })); });
        const deletedRef = doc(db, entriesPath, 'legacy-deleted');
        await assertFails(setDoc(deletedRef, { ...choice('legacy-deleted', 'c2'), deletedAt: null }));
        await assertSucceeds(getDoc(deletedRef));
    });

    it('accepts explicit same-choice supersession and rejects invalid targets', async () => {
        await seedExecution(); const db = env.authenticatedContext(userId).firestore();
        await assertSucceeds(setDoc(doc(db, entriesPath, 'choice-1'), choice('choice-1')));
        await assertSucceeds(setDoc(doc(db, entriesPath, 'choice-2'), choice('choice-2', 'c1', 'o2', { supersedesChoiceEntryId: 'choice-1' })));
        await assertFails(setDoc(doc(db, entriesPath, 'wrong-choice'), choice('wrong-choice', 'c2', 'o2', { supersedesChoiceEntryId: 'choice-1' })));
        await assertFails(setDoc(doc(db, entriesPath, 'self'), choice('self', 'c1', 'o2', { supersedesChoiceEntryId: 'self' })));
        await assertSucceeds(setDoc(doc(db, entriesPath, 'set-1'), performed('set-1')));
        await assertFails(setDoc(doc(db, entriesPath, 'wrong-kind'), choice('wrong-kind', 'c1', 'o2', { supersedesChoiceEntryId: 'set-1' })));
    });

    it('keeps performed correction and validates governing choice provenance', async () => {
        await seedExecution(); const db = env.authenticatedContext(userId).firestore();
        await assertSucceeds(setDoc(doc(db, entriesPath, 'choice-1'), choice('choice-1')));
        const ref = doc(db, entriesPath, 'set-1'); const original = performed('set-1', 5, { governingChoiceEntryId: 'choice-1', selectedOptionId: 'o1' });
        await assertSucceeds(setDoc(ref, original));
        await assertSucceeds(setDoc(ref, { ...original, updatedAt: '2026-10-05T08:01:00Z', payload: { kind: 'repetition', setIndex: 1, reps: 6 } }));
        await assertFails(setDoc(doc(db, entriesPath, 'bad-governor'), performed('bad-governor', 5, { governingChoiceEntryId: 'set-1' })));
        await assertFails(setDoc(doc(db, entriesPath, 'wrong-option'), performed('wrong-option', 5, { governingChoiceEntryId: 'choice-1', selectedOptionId: 'o2' })));
        await assertSucceeds(deleteDoc(ref));
    });
});
