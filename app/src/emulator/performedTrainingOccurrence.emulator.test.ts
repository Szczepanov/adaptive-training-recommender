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

const ownerId = 'athlete-training-occurrence';
const otherUserId = 'other-athlete';
const occurrenceId = 'pto-1';
const sourceLinkId = 'structured_execution%3Aexec-1';
const occurrencePath = `users/${ownerId}/performedTrainingOccurrences/${occurrenceId}`;
const sourceLinkPath = `users/${ownerId}/performedOccurrenceSourceLinks/${sourceLinkId}`;

function validOccurrence() {
    return {
        schemaVersion: 1,
        performedOccurrenceId: occurrenceId,
        userId: ownerId,
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T07:32:00.000Z',
        updatedAt: '2026-08-26T07:32:00.000Z',
    };
}

function validSourceLink() {
    return {
        schemaVersion: 1,
        sourceKey: 'structured_execution:exec-1',
        sourceKind: 'structured_execution',
        userId: ownerId,
        performedOccurrenceId: occurrenceId,
        createdAt: '2026-08-26T07:32:00.000Z',
        updatedAt: '2026-08-26T07:32:00.000Z',
    };
}

emulatorDescribe('Performed training occurrence rules (ADR-0034)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-training-occurrence',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows the owner to create, read and update a valid occurrence, but never to delete it', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, occurrencePath);

        await assertSucceeds(setDoc(ref, validOccurrence()));
        await assertSucceeds(getDoc(ref));
        await assertSucceeds(updateDoc(ref, {
            status: 'active',
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
            reconciliation: { state: 'matched', matcherVersion: 'matcher-v1', policyVersion: 'policy-v1', confidence: 0.9 },
            updatedAt: '2026-08-26T07:40:00.000Z',
        }));
        await assertFails(deleteDoc(ref));
    });

    it('denies another authenticated user from reading or mutating the occurrence', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, occurrencePath), validOccurrence()));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const otherRef = doc(otherDb, occurrencePath);
        await assertFails(getDoc(otherRef));
        await assertFails(updateDoc(otherRef, { updatedAt: '2026-08-26T09:00:00.000Z' }));
        await assertFails(deleteDoc(otherRef));
        // Cross-user source claim: another user cannot even attempt to write a
        // performed occurrence into their own tree claiming a source that isn't theirs
        // -- the write is scoped by path, so this simply exercises hasOwnedUserId.
        await assertFails(setDoc(doc(otherDb, `users/${otherUserId}/performedTrainingOccurrences/${occurrenceId}`), {
            ...validOccurrence(),
            userId: ownerId,
        }));
    });

    it('rejects malformed occurrence documents', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, occurrencePath);

        await assertFails(setDoc(ref, { ...validOccurrence(), userId: otherUserId }));
        await assertFails(setDoc(ref, { ...validOccurrence(), performedOccurrenceId: 'different-id' }));
        await assertFails(setDoc(ref, { ...validOccurrence(), status: 'deleted' }));
        await assertFails(setDoc(ref, { ...validOccurrence(), sourceRefs: [] }));
        await assertFails(setDoc(ref, { ...validOccurrence(), sourceRefs: [{ kind: 'unknown_kind' }] }));
        await assertFails(setDoc(ref, { ...validOccurrence(), reconciliation: { state: 'not_a_real_state' } }));
        await assertFails(setDoc(ref, { ...validOccurrence(), schemaVersion: 2 }));
    });

    it('keeps performedOccurrenceId, createdAt and schemaVersion immutable on update', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, occurrencePath);
        await assertSucceeds(setDoc(ref, validOccurrence()));

        await assertFails(updateDoc(ref, { performedOccurrenceId: 'changed' }));
        await assertFails(updateDoc(ref, { createdAt: '2026-08-26T09:00:00.000Z' }));
        await assertFails(updateDoc(ref, { schemaVersion: 2 }));
    });

    it('allows the owner to create and update a source link (re-pointing performedOccurrenceId), but never delete it', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, sourceLinkPath);

        await assertSucceeds(setDoc(ref, validSourceLink()));
        await assertSucceeds(getDoc(ref));
        await assertSucceeds(updateDoc(ref, { performedOccurrenceId: 'pto-2', updatedAt: '2026-08-26T08:00:00.000Z' }));
        await assertFails(deleteDoc(ref));
    });

    it('denies another authenticated user from reading or mutating a source link', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, sourceLinkPath), validSourceLink()));

        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        const otherRef = doc(otherDb, sourceLinkPath);
        await assertFails(getDoc(otherRef));
        await assertFails(updateDoc(otherRef, { performedOccurrenceId: 'stolen' }));
        await assertFails(deleteDoc(otherRef));
    });

    it('keeps sourceKey, sourceKind and createdAt immutable on a source-link update', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, sourceLinkPath);
        await assertSucceeds(setDoc(ref, validSourceLink()));

        await assertFails(updateDoc(ref, { sourceKey: 'provider_activity:garmin:act-1' }));
        await assertFails(updateDoc(ref, { sourceKind: 'provider_activity' }));
        await assertFails(updateDoc(ref, { createdAt: '2026-08-26T09:00:00.000Z' }));
    });
});
