import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let environment: RulesTestEnvironment;
const userId = 'detail-owner';
const queuePath = `users/${userId}/garmin_sync_requests/latest`;
const activityPath = `users/${userId}/activities/ride`;
const pending = { userId, status: 'pending', requestedAt: '2026-10-16T08:00:00Z', completedAt: null, error: null };
const request = { ...pending, requestType: 'activity_details', activityId: 'ride' };

emulatorDescribe('activity detail request rules', () => {
    beforeAll(async () => {
        environment = await initializeTestEnvironment({ projectId: 'demo-adaptive-training', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
    });
    afterEach(async () => { await environment.clearFirestore(); });
    afterAll(async () => { await environment.cleanup(); });
    async function seedActivity(path = activityPath) {
        await environment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), path), { activityId: 'ride', date: '2026-10-12' }); });
    }

    it('allows owner requests for an existing activity and permits safe requeue after server outcome', async () => {
        await seedActivity();
        const db = environment.authenticatedContext(userId).firestore();
        await assertSucceeds(setDoc(doc(db, queuePath), request));
        await assertSucceeds(getDoc(doc(db, queuePath)));
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), queuePath), { ...request, status: 'completed', completedAt: '2026-10-16T08:01:00Z', claimId: 'server-claim' });
        });
        expect((await getDoc(doc(db, queuePath))).data()?.status).toBe('completed');
        await assertSucceeds(setDoc(doc(db, queuePath), request));
    });
    it.each(['other-user', null])('denies nonowner requests and reads %s', async uid => {
        await seedActivity();
        const db = (uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()).firestore();
        await assertFails(setDoc(doc(db, queuePath), request));
        await assertFails(getDoc(doc(db, queuePath)));
    });
    it('rejects missing and exclusively foreign activity targets', async () => {
        const db = environment.authenticatedContext(userId).firestore();
        await assertFails(setDoc(doc(db, queuePath), request));
        await seedActivity('users/other-user/activities/ride');
        await assertFails(setDoc(doc(db, queuePath), request));
    });
    it.each([undefined, null, '', '   ', '.', '..', 'nested/id', 'x'.repeat(129), 123])('rejects malformed activity ID %#', async activityId => {
        await seedActivity();
        if (typeof activityId === 'string' && activityId && !activityId.includes('/') && !['.', '..'].includes(activityId)) {
            await seedActivity(`users/${userId}/activities/${activityId}`);
        }
        const db = environment.authenticatedContext(userId).firestore();
        const value: Record<string, unknown> = { ...request, activityId };
        if (activityId === undefined) delete value.activityId;
        await assertFails(setDoc(doc(db, queuePath), value));
    });
    it('accepts the maximum identifier length for an existing same-user activity', async () => {
        const activityId = 'x'.repeat(128);
        await seedActivity(`users/${userId}/activities/${activityId}`);
        const db = environment.authenticatedContext(userId).firestore();
        await assertSucceeds(setDoc(doc(db, queuePath), { ...request, activityId }));
    });
    it('rejects nonlatest request documents', async () => {
        await seedActivity();
        const db = environment.authenticatedContext(userId).firestore();
        await assertFails(setDoc(doc(db, `users/${userId}/garmin_sync_requests/other`), request));
    });
    it.each(['processing', 'completed', 'failed'])('denies client-supplied server status %s', async status => {
        await seedActivity();
        const db = environment.authenticatedContext(userId).firestore();
        await assertFails(setDoc(doc(db, queuePath), { ...request, status }));
    });
    it.each([{ error: 'claimed failure' }, { completedAt: '2026-10-16T08:01:00Z' }, { claimId: 'forged' }, { userId: 'other-user' }])('rejects forged outcomes and ownership %#', async fields => {
        await seedActivity();
        const db = environment.authenticatedContext(userId).firestore();
        await assertFails(setDoc(doc(db, queuePath), { ...request, ...fields }));
    });
    it.each([undefined, 'sync', 'backfill', 'initial_backfill'])('preserves regular request compatibility %s without activityId', async requestType => {
        await seedActivity();
        const db = environment.authenticatedContext(userId).firestore();
        const value = requestType ? { ...pending, requestType, days: 56 } : pending;
        await assertSucceeds(setDoc(doc(db, queuePath), value));
        await assertFails(setDoc(doc(db, queuePath), { ...value, activityId: 'ride' }));
    });
});
