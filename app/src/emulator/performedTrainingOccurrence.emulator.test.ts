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

function withoutKey(document: Record<string, unknown>, key: string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(document).filter(([name]) => name !== key));
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

    it('rejects occurrence documents that break ownership, id binding, key allow-lists or bounds', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, occurrencePath);

        await assertFails(setDoc(ref, { ...validOccurrence(), userId: otherUserId }));
        await assertFails(setDoc(ref, { ...validOccurrence(), performedOccurrenceId: 'different-id' }));
        await assertFails(setDoc(ref, { ...validOccurrence(), sourceRefs: [] }));
        await assertFails(setDoc(ref, {
            ...validOccurrence(),
            sourceRefs: Array.from({ length: 5 }, (_, index) => ({ kind: 'provider_activity', provider: 'garmin', activityId: `act-${index}` })),
        }));
        await assertFails(setDoc(ref, { ...validOccurrence(), sourceRefs: ['structured_execution:exec-1'] }));
        await assertFails(setDoc(ref, { ...validOccurrence(), sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', extra: true }] }));
        await assertFails(setDoc(ref, {
            ...validOccurrence(),
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-2' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-3', extra: true },
            ],
        }));
        await assertFails(setDoc(ref, { ...validOccurrence(), reconciliation: 'single_source' }));
        await assertFails(setDoc(ref, {
            ...validOccurrence(),
            reconciliation: { state: 'matched', excludedSourceKeys: Array.from({ length: 17 }, (_, index) => `k${index}`) },
        }));
        await assertFails(setDoc(ref, { ...validOccurrence(), unexpected: true }));
        await assertFails(setDoc(ref, withoutKey(validOccurrence(), 'status')));
        await assertFails(setDoc(ref, { ...validOccurrence(), createdAt: 1 }));
    });

    it('accepts nested values now owned by validatePerformedTrainingOccurrenceWrite (#1202, ADR-0053)', async () => {
        // These values are rejected by `training-occurrence/validation.ts`
        // `validatePerformedTrainingOccurrenceWrite`, which `repository.ts` runs before every
        // write; the rules no longer duplicate the checks.
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        // Each case is a fresh create on its own document, so the update pins
        // (schemaVersion, createdAt) are not what is being exercised.
        const cases: Array<Record<string, unknown>> = [
            { status: 'deleted' },
            { sourceRefs: [{ kind: 'unknown_kind' }] },
            { reconciliation: { state: 'not_a_real_state' } },
            { reconciliation: { state: 'matched', confidence: 1.5 } },
            { localDate: '2026-02-30' },
            { schemaVersion: 2 },
        ];
        for (const [index, overrides] of cases.entries()) {
            const id = `pto-moved-${index}`;
            await assertSucceeds(setDoc(doc(db, `users/${ownerId}/performedTrainingOccurrences/${id}`), {
                ...validOccurrence(),
                performedOccurrenceId: id,
                ...overrides,
            }));
        }
    });

    it('accepts sourceRef FIT fingerprint values now owned by validatePerformedTrainingOccurrenceWrite (#1202, ADR-0053)', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, occurrencePath);
        const validFp = 'fit-workout-v2:0123456789abcdef0123456789abcdef';

        // Valid creation with fingerprint
        await assertSucceeds(setDoc(ref, {
            ...validOccurrence(),
            sourceRefs: [
                {
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: validFp,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                },
            ],
        }));

        // Valid update with provider_activity fingerprint
        await assertSucceeds(updateDoc(ref, {
            sourceRefs: [
                {
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: validFp,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                },
                {
                    kind: 'provider_activity',
                    provider: 'garmin',
                    activityId: 'act-1',
                    fitWorkoutFingerprint: validFp,
                    fitWorkoutFingerprintKind: 'index_fallback',
                },
            ],
            updatedAt: '2026-08-26T07:45:00.000Z',
        }));

        // Malformed fingerprint format: rejected by the TS validator, accepted here
        await assertSucceeds(updateDoc(ref, {
            sourceRefs: [
                {
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: 'invalid-fingerprint',
                    fitWorkoutFingerprintKind: 'semantic_definition',
                },
            ],
        }));

        // Invalid fingerprint kind: rejected by the TS validator, accepted here
        await assertSucceeds(updateDoc(ref, {
            sourceRefs: [
                {
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: validFp,
                    fitWorkoutFingerprintKind: 'unsupported_kind',
                },
            ],
        }));

        // Fingerprint/kind pairing: enforced by the TS validator, accepted here
        await assertSucceeds(updateDoc(ref, {
            sourceRefs: [
                {
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: validFp,
                },
            ],
        }));
        await assertSucceeds(updateDoc(ref, {
            sourceRefs: [
                {
                    kind: 'provider_activity',
                    provider: 'garmin',
                    activityId: 'act-1',
                    fitWorkoutFingerprintKind: 'semantic_definition',
                },
            ],
        }));
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

    it('keeps sourceKey, sourceKind, schemaVersion and createdAt immutable on a source-link update', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, sourceLinkPath);
        await assertSucceeds(setDoc(ref, validSourceLink()));

        await assertFails(updateDoc(ref, { schemaVersion: 2 }));
        await assertFails(updateDoc(ref, { sourceKey: 'provider_activity:garmin:act-1' }));
        await assertFails(updateDoc(ref, { sourceKind: 'provider_activity' }));
        await assertFails(updateDoc(ref, { createdAt: '2026-08-26T09:00:00.000Z' }));
    });

    it('rejects source links that break ownership, key allow-lists or the sourceKey bound', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const ref = doc(db, sourceLinkPath);

        await assertFails(setDoc(ref, { ...validSourceLink(), userId: otherUserId }));
        await assertFails(setDoc(ref, { ...validSourceLink(), sourceKey: '' }));
        await assertFails(setDoc(ref, { ...validSourceLink(), unexpected: true }));
        await assertFails(setDoc(ref, withoutKey(validSourceLink(), 'performedOccurrenceId')));
        await assertFails(setDoc(ref, { ...validSourceLink(), updatedAt: 1 }));
    });

    it('accepts source-link values now owned by validatePerformedOccurrenceSourceLinkWrite (#1202, ADR-0053)', async () => {
        // `training-occurrence/validation.ts` `validatePerformedOccurrenceSourceLinkWrite`
        // rejects these; `repository.ts` runs it before every create and re-pointing update.
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const cases: Array<Record<string, unknown>> = [
            { schemaVersion: 2 },
            { sourceKind: 'manual' },
            { performedOccurrenceId: '' },
        ];
        for (const [index, overrides] of cases.entries()) {
            await assertSucceeds(setDoc(doc(db, `users/${ownerId}/performedOccurrenceSourceLinks/moved-${index}`), {
                ...validSourceLink(),
                ...overrides,
            }));
        }
    });
});
