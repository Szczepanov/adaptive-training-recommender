/**
 * H4 (#434) PR 3: runs the real `SessionOccurrenceService` (not mocked Firestore calls)
 * against the emulator, for behavior that a rules-only or a mocked-transaction unit test
 * cannot prove -- specifically, that `getOrCreateExternalPlanOccurrence`'s multi-document
 * transaction actually commits under the real security rules. A prior version of
 * `session_occurrence_windows`'s rules (`allow update: if false`) made the same-window
 * re-import supersession path fail with permission-denied in production while every
 * mocked unit test still passed, because the mock never evaluates real rules.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { SessionOccurrenceService, windowReservationId } from '../services/sessionOccurrenceService';
import { isExternalPlanOccurrence } from '../sessions/models';

// Guards the whole suite -- hooks included -- exactly like every sibling
// `*.emulator.test.ts` file in this directory. Gating only the leaf `it()` (e.g. via
// `it.skip`) while leaving `beforeAll`/`afterEach`/`afterAll` at module scope would let
// those hooks attempt `initializeTestEnvironment`/`clearFirestore` against an emulator
// that may not be running whenever this file is collected outside `firebase
// emulators:exec` (a plain `npm run check` / `vitest run`, for instance).
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('getOrCreateExternalPlanOccurrence (real transaction, real rules)', () => {
    let testEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            // A distinct project id from firestoreRules.emulator.test.ts's
            // 'demo-adaptive-training' -- separate projects are separate namespaces within
            // the same emulator process, so this file's afterEach(clearFirestore()) can
            // never race with or wipe data a concurrently-running sibling test file just
            // wrote under the same ownerId.
            projectId: 'demo-h4-pr3-occurrence-service',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('hands off a shared window to the successor occurrence on re-import supersession', async () => {
        const ownerId = 'athlete-a';
        // `.firestore()` is declared to return the legacy compat type for interop, but its
        // own doc comment confirms the returned instance actually is the modular Firebase
        // JS Client SDK object -- the same instance every other emulator test in this repo
        // passes straight into modular `doc()`/`getDoc()` calls without a cast. The cast is
        // needed only because `SessionOccurrenceService`'s constructor is typed against the
        // strict modular `Firestore` interface rather than accepting the same loose overload.
        const db = testEnvironment.authenticatedContext(ownerId).firestore() as unknown as Firestore;
        const service = new SessionOccurrenceService(db);

        const windowBinding = {
            windowId: 'window-1', bundleId: 'bundle-1', order: 0,
            boundStartLocal: '07:00', boundEndLocal: '08:00',
            startInstant: '2026-08-18T05:00:00Z', endInstant: '2026-08-18T06:00:00Z',
        };
        const refV1 = { planId: 'plan-1', revision: 1, sessionId: 'session-1', contentHash: 'a'.repeat(64) };
        const refV2 = { ...refV1, revision: 2, contentHash: 'b'.repeat(64) };

        const first = await service.getOrCreateExternalPlanOccurrence(ownerId, '2026-08-18', refV1, { windowBinding });
        expect(first.state).toBe('scheduled');

        // Re-importing the plan (a new revision, same window) must not throw -- this is
        // the exact permission-denied regression: the window reservation already exists
        // and must be handed off to the successor occurrence in the same transaction.
        const second = await service.getOrCreateExternalPlanOccurrence(ownerId, '2026-08-18', refV2, { windowBinding });
        expect(second.occurrenceId).not.toBe(first.occurrenceId);
        expect(isExternalPlanOccurrence(second) && second.windowBinding?.windowId).toBe('window-1');

        const supersededFirst = await service.getOccurrence(ownerId, first.occurrenceId);
        expect(supersededFirst.status === 'AVAILABLE' && supersededFirst.data.state).toBe('superseded');

        // Read the actual reservation document, not just the two occurrences' own state.
        // Both occurrences agreeing the window "belongs" to `second` is necessary but not
        // sufficient: a regression that left the persisted reservation still pointing at
        // `first` would pass every assertion above yet incorrectly reject the *next*
        // same-window re-import as a conflict against an occurrence that no longer governs
        // anything.
        const reservationRef = doc(db, 'users', ownerId, 'session_occurrence_windows', windowReservationId('2026-08-18', 'window-1'));
        const reservationSnap = await getDoc(reservationRef);
        expect(reservationSnap.exists()).toBe(true);
        expect(reservationSnap.data()?.occurrenceId).toBe(second.occurrenceId);
    });
});
