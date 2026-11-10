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

    it('rejects path/owner mismatches', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, overridePath);

        await assertFails(setDoc(ref, { ...validOverride(), userId: otherUserId }));
        await assertFails(setDoc(ref, { ...validOverride(), activityId: 'different-activity' }));
    });

    // Issue #1202 (ADR-0053): validateActivityOverride (assertValidActivityOverride in
    // ActivityOverrideService saveOverride) owns these values; the rules no longer check them.
    it.each([
        ['an unsupported modality', { overriddenModality: 'Underwater Basket Weaving' }],
        ['an unknown intensity', { overriddenIntensity: 'maximal' }],
        ['an out-of-range rpe', { rpe: 11 }],
        ['an unknown stimulusFocus', { stimulusFocus: 'madeUpAxis' }],
        ['a malformed date', { date: '2026-02-30' }],
    ])('accepts a correction with %s at the rules boundary (validateActivityOverride owns it)', async (_label, override) => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, overridePath), { ...validOverride(), ...override }));
    });

    it.each([
        ['an extra field', { surprise: true }],
        ['an originalType over 128 characters', { originalType: 'x'.repeat(129) }],
        ['an originalIntensityTag over 64 characters', { originalIntensityTag: 'x'.repeat(65) }],
        ['notes over 2000 characters', { notes: 'x'.repeat(2001) }],
        ['an empty createdAt', { createdAt: '' }],
        ['an empty updatedAt', { updatedAt: '' }],
    ])('rejects a correction with %s', async (_label, override) => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, overridePath);
        await assertFails(setDoc(ref, { ...validOverride(), ...override }));
        await assertSucceeds(setDoc(ref, validOverride()));
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
