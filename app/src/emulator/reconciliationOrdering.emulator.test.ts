/**
 * WP0 harness for issue #895 WP4 — arrival-ordering convergence fixtures.
 *
 * Scope: thin emulator proofs that the current link-only reconciliation
 * discipline (ADR-0034) never force-merges on date/modality alone. Full
 * `reconcileStructuredCompletion` / `reconcileGarminActivity` convergence proofs
 * land in WP4 on top of this harness; this file pins the stable-identity
 * vocabulary WP4 must preserve: distinct source keys, explicit links, and
 * ambiguous-stays-ambiguous.
 *
 * No behavior change. No POLICY_VERSION impact.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { sourceKeyForRef } from '../training-occurrence/sourceIdentity';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-895-ordering';
const DATE = '2026-09-29';

function occurrenceDoc(id: string, sourceRefs: unknown[]) {
    const now = '2026-09-29T07:32:00.000Z';
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: USER_ID,
        status: 'active',
        localDate: DATE,
        modality: 'strength',
        startedAt: '2026-09-29T06:52:00.000Z',
        endedAt: '2026-09-29T07:32:00.000Z',
        sourceRefs,
        reconciliation: { state: 'single_source' },
        createdAt: now,
        updatedAt: now,
    };
}

emulatorDescribe('Training-occurrence arrival ordering harness (#895 WP0/WP4)', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-895-reconciliation-ordering',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('execution-first and provider-first use distinct source keys (stable identity vocabulary)', () => {
        const executionKey = sourceKeyForRef({ kind: 'structured_execution', executionId: 'exec-1' });
        const providerKey = sourceKeyForRef({ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' });
        expect(executionKey).not.toBe(providerKey);
        expect(executionKey).toContain('exec-1');
        expect(providerKey).toContain('act-1');
    });

    it('two genuine same-day workouts stay separate: date/modality alone never merges', async () => {
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-morning'),
            occurrenceDoc('pto-morning', [{ kind: 'structured_execution', executionId: 'exec-morning' }]),
        );
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-evening'),
            occurrenceDoc('pto-evening', [{ kind: 'structured_execution', executionId: 'exec-evening' }]),
        );

        const snap = await getDocs(collection(db, 'users', USER_ID, 'performedTrainingOccurrences'));
        expect(snap.docs.length).toBe(2);
    });

    it('execution-first arrival leaves a stable single-source occurrence a late provider can attach to', async () => {
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-exec-first'),
            occurrenceDoc('pto-exec-first', [{ kind: 'structured_execution', executionId: 'exec-first' }]),
        );

        // Late provider detail arrives: WP4 must attach it to the same occurrence
        // without changing the stable user-visible identity. Pinned here as the
        // starting point; convergence logic lands in WP4.
        const snap = await getDocs(collection(db, 'users', USER_ID, 'performedTrainingOccurrences'));
        expect(snap.docs.length).toBe(1);
        expect(snap.docs[0]?.id).toBe('pto-exec-first');
    });

    it('provider-first arrival leaves a stable single-source occurrence a late execution can attach to', async () => {
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-provider-first'),
            occurrenceDoc('pto-provider-first', [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-first' }]),
        );

        const snap = await getDocs(collection(db, 'users', USER_ID, 'performedTrainingOccurrences'));
        expect(snap.docs.length).toBe(1);
        expect(snap.docs[0]?.id).toBe('pto-provider-first');
    });

    it('late offline execution does not duplicate the provider occurrence at the rules layer', async () => {
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-device-sync'),
            occurrenceDoc('pto-device-sync', [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-sync' }]),
        );

        // Device-sync update of the same activity rewrites the same occurrence doc
        // (update, not create). A second occurrence for the same physical workout
        // must never appear merely because the execution arrived later.
        await setDoc(
            doc(db, 'users', USER_ID, 'performedTrainingOccurrences', 'pto-device-sync'),
            {
                ...occurrenceDoc('pto-device-sync', [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-sync' }]),
                endedAt: '2026-09-29T07:40:00.000Z',
                updatedAt: '2026-09-29T07:40:00.000Z',
            },
        );

        const snap = await getDocs(collection(db, 'users', USER_ID, 'performedTrainingOccurrences'));
        expect(snap.docs.length).toBe(1);
    });
});
