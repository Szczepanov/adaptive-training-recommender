import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-activity-override';
const otherUserId = 'other-athlete';
const activityId = 'garmin-123';
const overridePath = `users/${ownerId}/activity_overrides/${activityId}`;

function validOverride() {
    return {
        activityId,
        userId: ownerId,
        date: '2026-08-26',
        originalType: 'cycling',
        originalIntensityTag: 'moderate',
        overriddenModality: 'Cycling',
        overriddenIntensity: 'hard',
        rpe: 8,
        stimulusFocus: 'thresholdPower',
        notes: 'Garmin classified an interval session too conservatively.',
        createdAt: '2026-08-26T08:00:00.000Z',
        updatedAt: '2026-08-26T08:00:00.000Z',
    };
}

emulatorDescribe('Activity override rules', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-activity-overrides',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows the owner to create, read, update and delete a valid correction', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, overridePath);

        await assertSucceeds(setDoc(ref, validOverride()));
        await assertSucceeds(getDoc(ref));
        await assertSucceeds(updateDoc(ref, {
            overriddenIntensity: 'moderate',
            rpe: 6,
            updatedAt: '2026-08-26T08:05:00.000Z',
        }));
        await assertSucceeds(deleteDoc(ref));
    });

    it('denies another authenticated user from reading or mutating the correction', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, overridePath), validOverride()));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const otherRef = doc(otherDb, overridePath);
        await assertFails(getDoc(otherRef));
        await assertFails(updateDoc(otherRef, { updatedAt: '2026-08-26T09:00:00.000Z' }));
        await assertFails(deleteDoc(otherRef));
    });

    it('rejects path/owner mismatches and malformed correction fields', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, overridePath);

        await assertFails(setDoc(ref, { ...validOverride(), userId: otherUserId }));
        await assertFails(setDoc(ref, { ...validOverride(), activityId: 'different-activity' }));
        // Swimming became a valid modality for triathlon/multisport support; 'Underwater
        // Basket Weaving' keeps this assertion testing a genuinely unsupported modality.
        await assertFails(setDoc(ref, { ...validOverride(), overriddenModality: 'Underwater Basket Weaving' }));
        await assertFails(setDoc(ref, { ...validOverride(), overriddenIntensity: 'maximal' }));
        await assertFails(setDoc(ref, { ...validOverride(), rpe: 11 }));
        await assertFails(setDoc(ref, { ...validOverride(), stimulusFocus: 'madeUpAxis' }));
    });

    it('keeps identity, date, and createdAt immutable on update', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, overridePath);
        await assertSucceeds(setDoc(ref, validOverride()));

        await assertFails(updateDoc(ref, { activityId: 'changed' }));
        await assertFails(updateDoc(ref, { date: '2026-08-25' }));
        await assertFails(updateDoc(ref, { createdAt: '2026-08-26T09:00:00.000Z' }));
    });
});
