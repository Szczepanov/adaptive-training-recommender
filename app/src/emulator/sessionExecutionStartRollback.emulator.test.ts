/**
 * H4 (#434) PR 3 Phase 4 regression: the claim happens on Home before SessionRunner
 * creates its execution. If that execution write fails, the failure crosses a component
 * boundary, so Home can no longer perform the rollback itself. SessionExecutionService
 * owns the last durable step and must release the already-committed intraday claim.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { SessionExecutionService } from '../services/sessionExecutionService';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATE = '2026-09-06';
const USER_ID = 'athlete-execution-rollback';
const OCCURRENCE_ID = 'occ-pm-1';
const NOW = '2026-09-06T15:00:00.000Z';

emulatorDescribe('SessionExecutionService intraday claim rollback', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-h4-pr3-execution-start-rollback',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
        // `.firestore()` is declared as the legacy compat type for interop but returns the
        // modular SDK instance -- this is the same bridge used by the launch-claim emulator suite.
        db = testEnvironment.authenticatedContext(USER_ID).firestore() as unknown as Firestore;
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('returns an active occurrence and in-progress reservation to scheduled/reserved when execution creation is rejected', async () => {
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

        await setDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE), {
            userId: USER_ID,
            date: DATE,
            revision: 1,
            ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 0.8 },
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 60,
                    systemicCost: 0.3,
                    state: 'in_progress',
                    decisionId: 'dec-pm-1',
                    postReservationLedgerRevision: '1',
                },
            },
            seededAt: NOW,
            createdAt: NOW,
            updatedAt: NOW,
        });

        const service = new SessionExecutionService(db);
        await expect(service.startExecution(USER_ID, 'exec-rejected', {
            // revision 0 violates the Firestore session-source contract, deliberately
            // failing exactly at the execution write after the claim already committed.
            sessionSource: {
                kind: 'external_plan',
                planId: 'plan-1',
                revision: 0,
                sessionId: 'sess-pm-1',
                contentHash: 'a'.repeat(64),
            },
            occurrenceId: OCCURRENCE_ID,
            prescriptionHash: 'prescription-hash',
            date: DATE,
        })).rejects.toBeDefined();

        const occurrence = await getDoc(doc(db, 'users', USER_ID, 'session_occurrences', OCCURRENCE_ID));
        expect(occurrence.data()?.state).toBe('scheduled');

        const ledger = await getDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE));
        expect(ledger.data()?.revision).toBe(2);
        expect(ledger.data()?.reservations?.[OCCURRENCE_ID]?.state).toBe('reserved');

        const execution = await getDoc(doc(db, 'users', USER_ID, 'session_executions', 'exec-rejected'));
        expect(execution.exists()).toBe(false);
    });
});
