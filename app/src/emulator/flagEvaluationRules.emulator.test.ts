import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let env: RulesTestEnvironment;
const id = 'flag-' + 'a'.repeat(64);
const path = 'users/alice/flag_evaluations/' + id;
const payload = () => ({
    schemaVersion: 1, userId: 'alice', revisionId: id, idempotencyKey: id,
    id: 'illness_risk_symptom', observedOn: '2026-10-28', evaluatedAt: '2026-10-28T09:00:00.000Z',
    definitionVersion: 'illness_risk_symptom-v1', active: false, state: 'measured', reasonCode: 'no_illness',
    threshold: 'Reported illness symptoms', inputs: [],
});
suite('immutable per-date flag evaluation rules', () => {
    beforeAll(async () => { env = await initializeTestEnvironment({
        projectId: 'demo-atr-flag-evaluations', firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    }); });
    afterEach(async () => env.clearFirestore());
    afterAll(async () => env.cleanup());
    it('allows owner create/read but forbids mutation and deletion', async () => {
        const ref = doc(env.authenticatedContext('alice').firestore(), path);
        await assertSucceeds(setDoc(ref, payload()));
        await assertSucceeds(getDoc(ref));
        await assertFails(updateDoc(ref, { active: true }));
        await assertFails(deleteDoc(ref));
    });
    it('rejects cross-account and anonymous access', async () => {
        const owner = doc(env.authenticatedContext('alice').firestore(), path);
        await assertSucceeds(setDoc(owner, payload()));
        for (const db of [env.authenticatedContext('bob').firestore(), env.unauthenticatedContext().firestore()]) {
            const ref = doc(db, path);
            await assertFails(getDoc(ref));
            await assertFails(setDoc(ref, payload()));
        }
        await assertFails(setDoc(doc(env.authenticatedContext('bob').firestore(), 'users/bob/flag_evaluations/' + id), payload()));
    });
    it('rejects invalid identities, dates, states, flag ids and oversized evidence', async () => {
        const db = env.authenticatedContext('alice').firestore();
        for (const change of [
            { observedOn: '2026-02-30' }, { evaluatedAt: 'not-a-timestamp' }, { revisionId: 'wrong' },
            { id: 'custom_flag' }, { state: 'made_up' }, { active: true, state: 'missing' },
            { inputs: Array.from({ length: 17 }, () => ({ name: 'x', value: {} })) },
            { secret: 'not-an-allowed-key' }, { threshold: 'x'.repeat(8193) },
        ]) await assertFails(setDoc(doc(db, path), { ...payload(), ...change }));
    });
});
