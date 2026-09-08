/**
 * H4 (#434) PR 3 Phase 4 regression: rollback is a paired occurrence+ledger transition.
 * If the ledger side cannot be proven/reversed, the occurrence must remain active rather
 * than becoming scheduled on its own.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { releaseIntradayMemberClaim } from '../services/intradayLaunchClaim';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'athlete-release-pairing';
const DATE = '2026-09-06';
const OCCURRENCE_ID = 'occ-pm-1';
const NOW = '2026-09-06T15:00:00.000Z';

emulatorDescribe('intraday release pairing', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-h4-pr3-release-pairing',
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

    it('keeps the occurrence active when the paired in-progress ledger row is missing', async () => {
        await setDoc(doc(db, 'users', USER_ID, 'session_occurrences', OCCURRENCE_ID), {
            userId: USER_ID,
            occurrenceId: OCCURRENCE_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: {
                planId: 'plan-1',
                revision: 1,
                sessionId: 'sess-pm-1',
                contentHash: 'a'.repeat(64),
            },
            state: 'active',
            createdAt: NOW,
            updatedAt: NOW,
        });

        // A seeded aggregate exists, but its own row is missing. The old implementation
        // returned from the transaction hook here and still wrote active -> scheduled.
        await setDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE), {
            userId: USER_ID,
            date: DATE,
            revision: 1,
            ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 0.8 },
            reservations: {},
            seededAt: NOW,
            createdAt: NOW,
            updatedAt: NOW,
        });

        const release = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
            db,
        });

        expect(release.released).toBe(false);
        expect(release.reason).toMatch(/reservation is missing/);
        const occurrence = await getDoc(doc(db, 'users', USER_ID, 'session_occurrences', OCCURRENCE_ID));
        expect(occurrence.data()?.state).toBe('active');
        const ledger = await getDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE));
        expect(ledger.data()?.revision).toBe(1);
    });
});
