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

const ownerId = 'athlete-intraday-decision';
const otherId = 'other-intraday-decision';
const decisionId = 'dec-2026-09-06-am';
const date = '2026-09-06';
const docPath = `users/${ownerId}/intraday_decisions/${decisionId}`;

function validRecord() {
    return {
        id: decisionId,
        userId: ownerId,
        date,
        asOf: '2026-09-06T07:30:00.000Z',
        policyVersion: '2026-09-h4-intraday-bundle-placement-v1',
        schemaVersion: 1,
        status: 'provisional',
        supersededDecisionId: null,
        occurrenceId: 'occ-am-1',
        sessionId: 'sess-am-1',
        windowId: 'win-am-1',
        bundleId: 'bundle-sunday-1',
        orderInBundle: 0,
        reassessmentInputRevision: {
            availabilityRevision: 'avail-rev-1',
            completedFactsRevision: 'facts-rev-1',
            checkinRevision: 'checkin-rev-1',
            ledgerRevision: 'ledger-rev-1',
            placementRevision: 'placement-rev-1',
        },
        bundlePlacement: {
            bundleId: 'bundle-sunday-1',
            outcome: 'placed',
            bindings: [
                {
                    sessionId: 'sess-am-1',
                    windowId: 'win-am-1',
                    boundStartLocal: '08:00',
                    boundEndLocal: '09:00',
                    startInstant: '2026-09-06T06:00:00.000Z',
                    endInstant: '2026-09-06T07:00:00.000Z',
                },
            ],
        },
        ledgerSnapshot: {
            ceilings: {
                dailyMinuteCeiling: 90,
                dailySystemicCostCeiling: 0.8,
            },
            entries: [],
        },
        verdict: {
            decision: 'proceed',
            reasons: ['Capacity verified'],
        },
    };
}

emulatorDescribe('Intraday decision security rules (ADR-0036 D-AUDIT)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-intraday-decision',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows the owner to create and read a valid decision record', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, docPath), validRecord()));
        await assertSucceeds(getDoc(doc(db, docPath)));
    });

    it('rejects cross-user reads and writes', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, docPath), validRecord()));

        const otherDb = testEnvironment.authenticatedContext(otherId).firestore();
        await assertFails(getDoc(doc(otherDb, docPath)));
        await assertFails(setDoc(doc(otherDb, docPath), { ...validRecord(), userId: otherId }));
    });

    it('strictly enforces write-once immutability (updates and deletes are forbidden)', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, docPath), validRecord()));
        await assertFails(updateDoc(doc(db, docPath), { status: 'confirmed' }));
        await assertFails(deleteDoc(doc(db, docPath)));
    });

    it('requires document ID to match payload id', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const mismatchedPath = `users/${ownerId}/intraday_decisions/different-id`;
        await assertFails(setDoc(doc(db, mismatchedPath), validRecord()));
    });

    it('rejects malformed payloads and invalid enums', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, docPath), { ...validRecord(), status: 'invalid_status' }));
        await assertFails(setDoc(doc(db, docPath), { ...validRecord(), date: '09-06-2026' }));
        await assertFails(setDoc(doc(db, docPath), { ...validRecord(), schemaVersion: 2 }));
        await assertFails(setDoc(doc(db, docPath), { ...validRecord(), orderInBundle: -1 }));
        await assertFails(setDoc(doc(db, docPath), { ...validRecord(), unexpectedKey: true }));
        await assertFails(setDoc(doc(db, docPath), {
            ...validRecord(),
            bundlePlacement: { bundleId: 'bundle-sunday-1', outcome: 'placed', bindings: [] },
        }));
        await assertFails(setDoc(doc(db, docPath), {
            ...validRecord(),
            bundlePlacement: { bundleId: 'bundle-sunday-1', outcome: 'infeasible' },
        }));
        await assertFails(setDoc(doc(db, docPath), {
            ...validRecord(),
            bundlePlacement: { bundleId: 'bundle-sunday-1', outcome: 'infeasible', reason: '' },
        }));
    });

    it('accepts valid infeasible proposals with a non-empty reason', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const infeasibleRecord = {
            ...validRecord(),
            bundlePlacement: {
                bundleId: 'bundle-sunday-1',
                outcome: 'infeasible',
                reason: 'No available schedule window',
            },
        };
        await assertSucceeds(setDoc(doc(db, docPath), infeasibleRecord));
    });
});
