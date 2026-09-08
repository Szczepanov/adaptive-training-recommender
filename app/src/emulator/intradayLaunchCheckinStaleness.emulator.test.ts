/**
 * H4 (#434) PR 3 Phase 4 regression: the date-keyed subjective check-in is one of the
 * sources ADR-0036 explicitly requires the Start-time claim to re-read transactionally.
 * A dashboard fingerprint alone cannot see an edit made by another tab after render.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { SessionOccurrenceService } from '../services/sessionOccurrenceService';
import { claimIntradayMemberLaunch, StaleDecisionError } from '../services/intradayLaunchClaim';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATE = '2026-09-06';
const USER_ID = 'athlete-checkin-staleness';
const NOW = '2026-09-06T07:30:00.000Z';
const CEILINGS = { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 0.8 };

emulatorDescribe('intraday launch check-in staleness', () => {
    let testEnvironment: RulesTestEnvironment;
    let db: Firestore;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-h4-pr3-checkin-staleness',
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

    it('refuses when another tab creates/changes today check-in after the verdict', async () => {
        const occurrence = await new SessionOccurrenceService(db).getOrCreateExternalPlanOccurrence(
            USER_ID,
            DATE,
            { planId: 'plan-1', revision: 1, sessionId: 'sess-pm-1', contentHash: 'a'.repeat(64) },
            { placementOrder: 1 },
        );
        const decisionId = `dec-${occurrence.occurrenceId}`;

        await setDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE), {
            userId: USER_ID,
            date: DATE,
            revision: 1,
            ceilings: CEILINGS,
            reservations: {
                [occurrence.occurrenceId]: {
                    minutes: 60,
                    systemicCost: 0.3,
                    state: 'reserved',
                    decisionId,
                    postReservationLedgerRevision: '1',
                },
            },
            seededAt: NOW,
            createdAt: NOW,
            updatedAt: NOW,
        });

        await setDoc(doc(db, 'users', USER_ID, 'intraday_decisions', decisionId), {
            id: decisionId,
            userId: USER_ID,
            date: DATE,
            asOf: NOW,
            policyVersion: '2026-09-h4-intraday-reassessment-v1',
            schemaVersion: 1,
            status: 'provisional',
            supersededDecisionId: null,
            occurrenceId: occurrence.occurrenceId,
            sessionId: 'sess-pm-1',
            windowId: 'win-pm-1',
            bundleId: 'bundle-sunday-1',
            orderInBundle: 1,
            predecessorExecutionId: null,
            predecessorOccurrenceId: null,
            reassessmentInputRevision: {
                availabilityRevision: 'avail-rev-1',
                completedFactsRevision: 'facts-rev-1',
                checkinRevision: 'checkin-missing',
                ledgerRevision: '1',
                placementRevision: 'plan-1:1',
            },
            bundlePlacement: {
                bundleId: 'bundle-sunday-1',
                outcome: 'placed',
                bindings: [{
                    sessionId: 'sess-pm-1',
                    windowId: 'win-pm-1',
                    boundStartLocal: '17:00',
                    boundEndLocal: '18:30',
                    startInstant: '2026-09-06T15:00:00.000Z',
                    endInstant: '2026-09-06T16:30:00.000Z',
                }],
            },
            ledgerSnapshot: { ceilings: CEILINGS, entries: [] },
            verdict: { decision: 'proceed', reasons: ['Capacity verified'] },
            postReservationLedgerRevision: '1',
        });

        // This document did not exist when the decision above was created. It appears after
        // the dashboard render, exactly the cross-tab window a cached fingerprint cannot see.
        await setDoc(doc(db, 'users', USER_ID, 'daily_subjective_checkins', DATE), {
            userId: USER_ID,
            date: DATE,
            availability: {
                timeAvailableMin: 60,
                preferredModalityToday: null,
                indoorOnly: false,
            },
            dataQuality: { isComplete: true, missingFields: [] },
            painOrInjury: false,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            illnessSymptoms: false,
            createdAt: '2026-09-06T07:35:00.000Z',
            updatedAt: '2026-09-06T07:35:00.000Z',
        });

        const error = await claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: occurrence.occurrenceId,
            db,
            dashboardInputRevision: {
                availabilityRevision: 'avail-rev-1',
                completedFactsRevision: 'facts-rev-1',
                checkinRevision: 'checkin-missing',
                placementRevision: 'plan-1:1',
            },
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(StaleDecisionError);
        expect((error as StaleDecisionError).code).toBe('input-revision-changed');

        const occurrenceAfter = await getDoc(doc(db, 'users', USER_ID, 'session_occurrences', occurrence.occurrenceId));
        expect(occurrenceAfter.data()?.state).toBe('scheduled');
        const ledgerAfter = await getDoc(doc(db, 'users', USER_ID, 'daily_ledgers', DATE));
        expect(ledgerAfter.data()?.revision).toBe(1);
        expect(ledgerAfter.data()?.reservations?.[occurrence.occurrenceId]?.state).toBe('reserved');
    });
});
