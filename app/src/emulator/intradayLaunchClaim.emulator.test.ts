/**
 * H4 (#434) PR 3 Phase 4 step 11: the launch claim, exercised against the real emulator
 * with the real security rules.
 *
 * A mocked-transaction unit test cannot prove any of what matters here. The properties under
 * test are all products of Firestore's actual commit protocol -- that two claims on the same
 * occurrence serialize, that two claims on *different* occurrences serialize because both
 * write the shared aggregate, and that the `revision == resource.data.revision + 1` rule
 * rejects a stale writer. A mock would happily let every one of those pass while production
 * double-spent the day.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { SessionOccurrenceService } from '../services/sessionOccurrenceService';
import type { DailyLedgerAggregate } from '../services/dailyLedgerAggregateService';
import { sessionResponseDocId } from '../services/sessionResponseService';
import {
    claimIntradayMemberLaunch,
    releaseIntradayMemberClaim,
    StaleDecisionError,
    type DashboardInputRevision,
} from '../services/intradayLaunchClaim';

// Guards the whole suite -- hooks included -- exactly like every sibling `*.emulator.test.ts`
// file here, so a plain `vitest run` outside `firebase emulators:exec` never attempts
// `initializeTestEnvironment` against an emulator that is not running.
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const DATE = '2026-09-06';
const CEILINGS = { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 0.8 };

const DASHBOARD_REVISION: DashboardInputRevision = {
    availabilityRevision: 'avail-rev-1',
    completedFactsRevision: 'facts-rev-1',
    checkinRevision: 'checkin-rev-1',
    placementRevision: 'plan-1:1',
};

function decisionRecord(params: {
    userId: string;
    decisionId: string;
    occurrenceId: string;
    postReservationLedgerRevision: string;
    predecessorExecutionId?: string | null;
    predecessorOccurrenceId?: string | null;
    postPredecessorConfirmationRevision?: string;
    verdict?: 'proceed' | 'scale';
}) {
    return {
        id: params.decisionId,
        userId: params.userId,
        date: DATE,
        asOf: '2026-09-06T07:30:00.000Z',
        policyVersion: '2026-09-h4-intraday-reassessment-v1',
        schemaVersion: 1,
        status: 'provisional',
        supersededDecisionId: null,
        occurrenceId: params.occurrenceId,
        sessionId: 'sess-pm-1',
        windowId: 'win-pm-1',
        bundleId: 'bundle-sunday-1',
        orderInBundle: 1,
        predecessorExecutionId: params.predecessorExecutionId ?? null,
        predecessorOccurrenceId: params.predecessorOccurrenceId ?? null,
        reassessmentInputRevision: {
            ...DASHBOARD_REVISION,
            ledgerRevision: '1',
            ...(params.postPredecessorConfirmationRevision
                ? { postPredecessorConfirmationRevision: params.postPredecessorConfirmationRevision }
                : {}),
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
        verdict: { decision: params.verdict ?? 'proceed', reasons: ['Capacity and confirmation verified'] },
        postReservationLedgerRevision: params.postReservationLedgerRevision,
    };
}

function aggregate(params: {
    userId: string;
    revision: number;
    reservations: DailyLedgerAggregate['reservations'];
}): DailyLedgerAggregate {
    return {
        userId: params.userId,
        date: DATE,
        revision: params.revision,
        ceilings: CEILINGS,
        reservations: params.reservations,
        seededAt: '2026-09-06T07:00:00.000Z',
        createdAt: '2026-09-06T07:00:00.000Z',
        updatedAt: '2026-09-06T07:00:00.000Z',
    };
}

emulatorDescribe('claimIntradayMemberLaunch (real transactions, real rules)', () => {
    let testEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            // A project id of its own: sibling emulator files clear Firestore in `afterEach`,
            // and separate projects are separate namespaces within the same emulator process.
            projectId: 'demo-h4-pr3-launch-claim',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    /**
     * Creates a real scheduled occurrence plus the aggregate row and decision record the
     * adjudication loop would have written for it.
     *
     * Every document is written exactly once, in its final shape. Both stores forbid the
     * shortcut a fixture naturally reaches for: `intraday_decisions` is append-only
     * (`allow update: if false`) and `daily_ledgers` enforces `revision == old + 1` per write,
     * so a test that seeds a happy path and then rewrites it into the shape it actually wants
     * fails on the rules rather than on the behavior under test.
     */
    async function seedLaunchableMember(
        db: Firestore,
        userId: string,
        options: {
            sessionId?: string;
            windowId?: string;
            minutes?: number;
            systemicCost?: number;
            /** The aggregate's `revision`. Defaults to 2, the value a seed-plus-one-reservation
             * transaction leaves behind. */
            aggregateRevision?: number;
            /** `postReservationLedgerRevision` on the reservation row. */
            reservationPointer?: string;
            /** `postReservationLedgerRevision` on the decision record. Differs from
             * `reservationPointer` only when a test is deliberately staging a mismatch. */
            decisionPointer?: string;
            /** `decisionId` stored on the reservation row; defaults to the record actually
             * written. Point it elsewhere to stage a dangling pointer. */
            reservationDecisionId?: string;
            /** Omit this member's own row entirely (an aggregate that knows nothing about it). */
            omitOwnReservation?: boolean;
            otherReservations?: DailyLedgerAggregate['reservations'];
            predecessor?: { executionId: string; occurrenceId: string; confirmationRevision: string };
            verdict?: 'proceed' | 'scale';
        } = {},
    ) {
        const occurrenceService = new SessionOccurrenceService(db);
        const sessionId = options.sessionId ?? 'sess-pm-1';
        const windowId = options.windowId ?? 'win-pm-1';
        const occurrence = await occurrenceService.getOrCreateExternalPlanOccurrence(
            userId,
            DATE,
            { planId: 'plan-1', revision: 1, sessionId, contentHash: 'a'.repeat(64) },
            {
                placementOrder: 1,
                windowBinding: {
                    windowId, bundleId: 'bundle-sunday-1', order: 1,
                    boundStartLocal: '17:00', boundEndLocal: '18:30',
                    startInstant: '2026-09-06T15:00:00.000Z', endInstant: '2026-09-06T16:30:00.000Z',
                },
            },
        );

        const decisionId = `dec-${occurrence.occurrenceId}`;
        const aggregateRevision = options.aggregateRevision ?? 2;
        const reservationPointer = options.reservationPointer ?? String(aggregateRevision);
        const decisionPointer = options.decisionPointer ?? reservationPointer;

        await setDoc(
            doc(db, 'users', userId, 'daily_ledgers', DATE),
            aggregate({
                userId,
                revision: aggregateRevision,
                reservations: {
                    ...(options.otherReservations ?? {}),
                    ...(options.omitOwnReservation ? {} : {
                        [occurrence.occurrenceId]: {
                            minutes: options.minutes ?? 60,
                            systemicCost: options.systemicCost ?? 0.3,
                            state: 'reserved' as const,
                            decisionId: options.reservationDecisionId ?? decisionId,
                            postReservationLedgerRevision: reservationPointer,
                        },
                    }),
                },
            }),
        );
        await setDoc(
            doc(db, 'users', userId, 'intraday_decisions', decisionId),
            decisionRecord({
                userId,
                decisionId,
                occurrenceId: occurrence.occurrenceId,
                postReservationLedgerRevision: decisionPointer,
                ...(options.verdict ? { verdict: options.verdict } : {}),
                ...(options.predecessor
                    ? {
                        predecessorExecutionId: options.predecessor.executionId,
                        predecessorOccurrenceId: options.predecessor.occurrenceId,
                        postPredecessorConfirmationRevision: options.predecessor.confirmationRevision,
                    }
                    : {}),
            }),
        );

        return { occurrenceId: occurrence.occurrenceId, decisionId, occurrenceService };
    }

    async function readAggregate(db: Firestore, userId: string): Promise<DailyLedgerAggregate> {
        const snap = await getDoc(doc(db, 'users', userId, 'daily_ledgers', DATE));
        return snap.data() as DailyLedgerAggregate;
    }

    function ownerDb(userId: string): Firestore {
        // `.firestore()` is declared as the legacy compat type for interop but returns the
        // modular SDK instance -- the same cast every sibling emulator test here uses.
        return testEnvironment.authenticatedContext(userId).firestore() as unknown as Firestore;
    }

    it('claims a launchable member: occurrence active, reservation in_progress, same debit', async () => {
        const userId = 'athlete-claim-happy';
        const db = ownerDb(userId);
        const { occurrenceId, occurrenceService } = await seedLaunchableMember(db, userId);

        const claimed = await claimIntradayMemberLaunch({
            userId, date: DATE, occurrenceId, db, dashboardInputRevision: DASHBOARD_REVISION,
        });
        expect(claimed.state).toBe('active');

        const after = await readAggregate(db, userId);
        expect(after.reservations[occurrenceId].state).toBe('in_progress');
        // D-LEDGER: an in-progress reservation keeps its identity and is never charged twice.
        expect(after.reservations[occurrenceId].minutes).toBe(60);
        expect(after.reservations[occurrenceId].systemicCost).toBe(0.3);
        expect(after.revision).toBe(3);

        const reread = await occurrenceService.getOccurrence(userId, occurrenceId);
        expect(reread.status === 'AVAILABLE' && reread.data.state).toBe('active');
    });

    it('lets exactly one of two concurrent claims on the SAME occurrence win', async () => {
        const userId = 'athlete-same-occurrence';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId);

        const results = await Promise.allSettled([
            claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }),
            claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);

        const after = await readAggregate(db, userId);
        // One debit moved to in_progress, once -- not two revisions' worth of claiming.
        expect(after.reservations[occurrenceId].state).toBe('in_progress');
        expect(after.revision).toBe(3);
    });

    /**
     * The case a single-occurrence transaction does not cover, and precisely what ADR-0036's
     * "two tabs cannot spend the same minute" clause is about: two *different* occurrences,
     * each individually reserved, contending for a day whose ceiling cannot hold both once
     * one is actually claimed. Without the shared aggregate write they touch disjoint
     * documents, Firestore sees no conflict, and both launch.
     */
    it('lets exactly one of two concurrent claims on DIFFERENT occurrences win the last capacity', async () => {
        const userId = 'athlete-different-occurrences';
        const db = ownerDb(userId);
        const occurrenceService = new SessionOccurrenceService(db);

        const makeOccurrence = async (sessionId: string, windowId: string) =>
            occurrenceService.getOrCreateExternalPlanOccurrence(
                userId, DATE,
                { planId: 'plan-1', revision: 1, sessionId, contentHash: 'a'.repeat(64) },
                {
                    placementOrder: 1,
                    windowBinding: {
                        windowId, bundleId: 'bundle-sunday-1', order: 1,
                        boundStartLocal: '17:00', boundEndLocal: '18:30',
                        startInstant: '2026-09-06T15:00:00.000Z', endInstant: '2026-09-06T16:30:00.000Z',
                    },
                },
            );

        const a = await makeOccurrence('sess-a', 'win-a');
        const b = await makeOccurrence('sess-b', 'win-b');

        // Both were admitted against the same earlier ledger revision -- the over-admission a
        // two-tab morning genuinely produces -- and together they exceed the day's 120-minute
        // ceiling, so at most one can actually be claimed.
        await setDoc(doc(db, 'users', userId, 'daily_ledgers', DATE), aggregate({
            userId,
            revision: 2,
            reservations: {
                [a.occurrenceId]: { minutes: 100, systemicCost: 0.5, state: 'reserved', decisionId: `dec-${a.occurrenceId}`, postReservationLedgerRevision: '2' },
                [b.occurrenceId]: { minutes: 100, systemicCost: 0.5, state: 'reserved', decisionId: `dec-${b.occurrenceId}`, postReservationLedgerRevision: '2' },
            },
        }));
        for (const occurrenceId of [a.occurrenceId, b.occurrenceId]) {
            await setDoc(
                doc(db, 'users', userId, 'intraday_decisions', `dec-${occurrenceId}`),
                decisionRecord({ userId, decisionId: `dec-${occurrenceId}`, occurrenceId, postReservationLedgerRevision: '2' }),
            );
        }

        const results = await Promise.allSettled([
            claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId: a.occurrenceId, db }),
            claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId: b.occurrenceId, db }),
        ]);
        const won = results.filter(r => r.status === 'fulfilled');
        expect(won).toHaveLength(1);

        // The loser always refuses, but by one of two routes depending on how Firestore
        // resolves the collision: a contention abort retries and the re-read then finds the
        // winner's committed debit (`capacity-exhausted`), while a rules rejection of the
        // stale `revision` surfaces first as `ledger-contended`. Both are refusals to launch;
        // pinning one would make this test assert a timing detail rather than the invariant.
        const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(StaleDecisionError);
        expect(['capacity-exhausted', 'ledger-contended']).toContain((loser.reason as StaleDecisionError).code);

        const after = await readAggregate(db, userId);
        const inProgress = Object.values(after.reservations).filter(r => r.state === 'in_progress');
        expect(inProgress).toHaveLength(1);
    });

    it('refuses a second claim on an already-active occurrence', async () => {
        const userId = 'athlete-already-active';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId);

        await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db });
        await expect(
            claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }),
        ).rejects.toThrow(/state is 'active'/);
    });

    it('refuses when a dashboard-owned input moved since the verdict', async () => {
        const userId = 'athlete-stale-inputs';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId);

        const error = await claimIntradayMemberLaunch({
            userId, date: DATE, occurrenceId, db,
            dashboardInputRevision: { ...DASHBOARD_REVISION, checkinRevision: 'checkin-rev-2' },
        }).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(StaleDecisionError);
        expect((error as StaleDecisionError).code).toBe('input-revision-changed');

        // Fail closed and write nothing: the occurrence stays claimable once recomputed.
        const after = await readAggregate(db, userId);
        expect(after.reservations[occurrenceId].state).toBe('reserved');
        expect(after.revision).toBe(2);
        const occurrence = await new SessionOccurrenceService(db).getOccurrence(userId, occurrenceId);
        expect(occurrence.status === 'AVAILABLE' && occurrence.data.state).toBe('scheduled');
    });

    it('refuses when the decision record the reservation names is gone', async () => {
        const userId = 'athlete-missing-decision';
        const db = ownerDb(userId);
        // A reservation left pointing at a record that never landed. Launching without a
        // durable expected revision is exactly the non-transactional fallback the claim
        // exists to close, so this must refuse rather than proceed unchecked.
        const { occurrenceId } = await seedLaunchableMember(db, userId, {
            reservationDecisionId: 'dec-does-not-exist',
        });

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(StaleDecisionError);
        expect((error as StaleDecisionError).code).toBe('decision-missing');
    });

    it('refuses when the member holds no ledger reservation at all', async () => {
        const userId = 'athlete-no-reservation';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId, { omitOwnReservation: true });

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('no-reservation');
    });

    it('refuses when there is no seeded ledger for the day rather than reading it as free capacity', async () => {
        const userId = 'athlete-unseeded';
        const db = ownerDb(userId);
        const occurrenceService = new SessionOccurrenceService(db);
        const occurrence = await occurrenceService.getOrCreateExternalPlanOccurrence(
            userId, DATE,
            { planId: 'plan-1', revision: 1, sessionId: 'sess-pm-1', contentHash: 'a'.repeat(64) },
            { placementOrder: 1 },
        );

        const error = await claimIntradayMemberLaunch({
            userId, date: DATE, occurrenceId: occurrence.occurrenceId, db,
        }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('ledger-unseeded');
    });

    it('refuses a dependent member whose predecessor is not completed', async () => {
        const userId = 'athlete-predecessor-open';
        const db = ownerDb(userId);
        const occurrenceService = new SessionOccurrenceService(db);
        const predecessor = await occurrenceService.getOrCreateExternalPlanOccurrence(
            userId, DATE,
            { planId: 'plan-1', revision: 1, sessionId: 'sess-am-1', contentHash: 'c'.repeat(64) },
            { placementOrder: 0 },
        );
        const { occurrenceId } = await seedLaunchableMember(db, userId, {
            predecessor: {
                executionId: 'exec-am-1',
                occurrenceId: predecessor.occurrenceId,
                confirmationRevision: '2026-09-06T10:00:00.000Z',
            },
        });

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('predecessor-incomplete');
    });

    it("refuses when the predecessor's confirmation was edited after the verdict", async () => {
        const userId = 'athlete-confirmation-edited';
        const db = ownerDb(userId);
        const occurrenceService = new SessionOccurrenceService(db);
        const predecessor = await occurrenceService.getOrCreateExternalPlanOccurrence(
            userId, DATE,
            { planId: 'plan-1', revision: 1, sessionId: 'sess-am-1', contentHash: 'c'.repeat(64) },
            { placementOrder: 0 },
        );
        await occurrenceService.transitionOccurrenceState(userId, predecessor.occurrenceId, 'completed');

        const { occurrenceId } = await seedLaunchableMember(db, userId, {
            predecessor: {
                executionId: 'exec-am-1',
                occurrenceId: predecessor.occurrenceId,
                confirmationRevision: '2026-09-06T10:00:00.000Z',
            },
        });

        // ADR-0036: "changes to completion, symptoms, ... invalidate a pending PM approval".
        // The answer exists but has since been edited, so its fingerprint no longer matches.
        const responseId = sessionResponseDocId({ kind: 'execution', id: 'exec-am-1' }, 'immediate');
        await setDoc(
            doc(db, 'users', userId, 'session_responses', responseId),
            {
                userId,
                responseId,
                sourceSession: { kind: 'execution', id: 'exec-am-1', date: DATE },
                occurrenceId: predecessor.occurrenceId,
                window: 'immediate',
                date: DATE,
                checkinRef: { date: DATE },
                sessionRpe: 6,
                createdAt: '2026-09-06T10:00:00.000Z',
                updatedAt: '2026-09-06T11:15:00.000Z',
            },
        );

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('predecessor-confirmation-changed');
    });

    it('releases a committed claim back to scheduled and reserved when the launch then fails', async () => {
        const userId = 'athlete-release';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId);

        await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db });
        const release = await releaseIntradayMemberClaim({ userId, date: DATE, occurrenceId, db });
        expect(release.released, release.reason).toBe(true);

        const occurrence = await new SessionOccurrenceService(db).getOccurrence(userId, occurrenceId);
        expect(occurrence.status === 'AVAILABLE' && occurrence.data.state).toBe('scheduled');

        const after = await readAggregate(db, userId);
        expect(after.reservations[occurrenceId].state).toBe('reserved');
        // Still one debit, not zero: releasing a claim must not free the member's own capacity.
        expect(after.reservations[occurrenceId].minutes).toBe(60);
    });

    it('re-claims cleanly after a release, so a failed launch is genuinely recoverable', async () => {
        const userId = 'athlete-reclaim';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId);

        await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db });
        await releaseIntradayMemberClaim({ userId, date: DATE, occurrenceId, db });
        const reclaimed = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db });

        expect(reclaimed.state).toBe('active');
        const after = await readAggregate(db, userId);
        expect(after.reservations[occurrenceId].state).toBe('in_progress');
    });

    it('leaves the aggregate untouched when the decision is not a proceed verdict', async () => {
        const userId = 'athlete-not-proceed';
        const db = ownerDb(userId);
        const { occurrenceId } = await seedLaunchableMember(db, userId, { verdict: 'scale' });

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('decision-not-proceed');

        const after = await readAggregate(db, userId);
        expect(after.revision).toBe(2);
        expect(after.reservations[occurrenceId].state).toBe('reserved');
    });

    it("refuses when this member's own reservation was replaced since the verdict", async () => {
        const userId = 'athlete-reservation-changed';
        const db = ownerDb(userId);
        // A reject-then-recover cycle re-reserved this member at a later revision, so the
        // decision record no longer describes the reservation that now exists.
        const { occurrenceId } = await seedLaunchableMember(db, userId, {
            aggregateRevision: 5,
            reservationPointer: '5',
            decisionPointer: '2',
        });

        const error = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db }).catch((e: unknown) => e);
        expect((error as StaleDecisionError).code).toBe('reservation-changed');
    });

    it("does not invalidate a member's claim merely because another member reserved after it", async () => {
        const userId = 'athlete-sibling-reservation';
        const db = ownerDb(userId);
        // A sibling reservation advanced the aggregate's revision after this member reserved.
        // This member's own row is untouched and its debit was already granted, so it must
        // still be claimable -- otherwise an ordinary two-member day is unlaunchable by
        // construction, which would be a far worse bug than the staleness it guards against.
        const { occurrenceId } = await seedLaunchableMember(db, userId, {
            aggregateRevision: 4,
            reservationPointer: '2',
            otherReservations: {
                'occ-sibling': { minutes: 30, systemicCost: 0.2, state: 'reserved' },
            },
        });

        const claimed = await claimIntradayMemberLaunch({ userId, date: DATE, occurrenceId, db });
        expect(claimed.state).toBe('active');
    });
});
