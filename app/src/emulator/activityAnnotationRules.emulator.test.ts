import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let environment: RulesTestEnvironment;
const activityPath = 'users/annotation-owner/activity_annotations/ride';
const lapPath = `${activityPath}/laps/1`;
const lap = { lapIndex: 1, averagePowerWatts: 220, rpe: 6.5, source: 'manual' };
const activity = { rpe: 6.5, equipmentLabel: 'Road bike', source: 'manual' };

emulatorDescribe('manual activity annotation rules', () => {
    beforeAll(async () => {
        environment = await initializeTestEnvironment({ projectId: 'demo-adaptive-training', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
    });
    afterEach(async () => { await environment.clearFirestore(); });
    afterAll(async () => { await environment.cleanup(); });
    it('allows owner CRUD, fractional RPE, independent lap fields and explicit empty activity', async () => {
        const db = environment.authenticatedContext('annotation-owner').firestore();
        await assertSucceeds(setDoc(doc(db, activityPath), activity));
        await assertSucceeds(getDoc(doc(db, activityPath)));
        await assertSucceeds(setDoc(doc(db, activityPath), { rpe: null, equipmentLabel: null, source: 'manual' }));
        await assertSucceeds(setDoc(doc(db, lapPath), lap));
        await assertSucceeds(getDoc(doc(db, lapPath)));
        await assertSucceeds(getDocs(collection(db, `${activityPath}/laps`)));
        await assertSucceeds(setDoc(doc(db, lapPath), { ...lap, averagePowerWatts: null, rpe: 1 }));
        await assertSucceeds(setDoc(doc(db, lapPath), { ...lap, averagePowerWatts: 10000, rpe: 10 }));
        await assertSucceeds(setDoc(doc(db, `${activityPath}/laps/0`), { ...lap, lapIndex: 0, averagePowerWatts: 0, rpe: null }));
        await assertSucceeds(deleteDoc(doc(db, activityPath)));
        await assertSucceeds(deleteDoc(doc(db, lapPath)));
        await assertFails(setDoc(doc(db, 'users/annotation-owner/activities/ride'), { rpe: 5 }));
    });
    it.each(['other-user', null])('denies nonowner access %s', async userId => {
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), activityPath), activity);
            await setDoc(doc(context.firestore(), lapPath), lap);
        });
        const db = (userId ? environment.authenticatedContext(userId) : environment.unauthenticatedContext()).firestore();
        for (const [path, data] of [[activityPath, activity], [lapPath, lap]] as const) {
            await assertFails(getDoc(doc(db, path)));
            await assertFails(setDoc(doc(db, path), data));
            await assertFails(deleteDoc(doc(db, path)));
        }
        await assertFails(getDocs(collection(db, `${activityPath}/laps`)));
    });
    it.each([
        {}, { ...lap, extra: true }, { ...lap, source: 'garmin' }, { ...lap, lapIndex: 2 },
        { ...lap, lapIndex: -1 }, { ...lap, lapIndex: 1.5 }, { ...lap, lapIndex: '1' },
        { ...lap, averagePowerWatts: -1 }, { ...lap, averagePowerWatts: 10001 },
        { ...lap, averagePowerWatts: NaN }, { ...lap, averagePowerWatts: Infinity },
        { ...lap, averagePowerWatts: '220' }, { ...lap, rpe: 0 }, { ...lap, rpe: 11 },
        { ...lap, rpe: NaN }, { ...lap, rpe: Infinity }, { ...lap, rpe: '5' },
        { ...lap, averagePowerWatts: null, rpe: null },
    ])('denies malformed lap create and update %#', async data => {
        const db = environment.authenticatedContext('annotation-owner').firestore();
        await assertFails(setDoc(doc(db, lapPath), data));
        await assertSucceeds(setDoc(doc(db, lapPath), lap));
        await assertFails(setDoc(doc(db, lapPath), data));
    });
    it.each([
        {}, { ...activity, extra: true }, { ...activity, source: 'garmin' },
        { ...activity, rpe: 0 }, { ...activity, rpe: 11 }, { ...activity, rpe: NaN },
        { ...activity, rpe: Infinity }, { ...activity, rpe: '5' },
        { ...activity, equipmentLabel: '' }, { ...activity, equipmentLabel: '   ' },
        { ...activity, equipmentLabel: ' padded ' }, { ...activity, equipmentLabel: 'x'.repeat(101) },
        { ...activity, equipmentLabel: 1 },
    ])('denies malformed activity create and update %#', async data => {
        const db = environment.authenticatedContext('annotation-owner').firestore();
        await assertFails(setDoc(doc(db, activityPath), data));
        await assertSucceeds(setDoc(doc(db, activityPath), activity));
        await assertFails(setDoc(doc(db, activityPath), data));
    });
    it('rejects noncanonical and unsafe lap IDs', async () => {
        const db = environment.authenticatedContext('annotation-owner').firestore();
        await assertFails(setDoc(doc(db, `${activityPath}/laps/01`), lap));
        await assertFails(setDoc(doc(db, `${activityPath}/laps/9007199254740992`), { ...lap, lapIndex: 9007199254740992 }));
    });
});
