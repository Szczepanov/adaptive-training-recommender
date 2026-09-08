/**
 * ADR-0036 (H4) D-REASSESS, Phase 4 step 11 of
 * `docs/plans/h4-434-pr3-bundle-second-member-launch.md`: the atomic claim that stands
 * between a non-primary intraday bundle member's Start control and its session runner.
 *
 * The adjudication loop (Phase 3, `intradayBundleMemberAdjudication.ts`) already decided
 * this member may proceed, reserved its minutes/systemic cost in the date-level aggregate,
 * and wrote a provisional decision record. That verdict is a *morning* answer. Between it
 * and the athlete actually tapping Start, the predecessor may still be running, its
 * check-in answer may have been edited, another tab may have claimed the last remaining
 * minutes, or a re-import may have superseded the whole placement. This module re-validates
 * that verdict against transaction-scoped state and either claims the capacity or refuses.
 *
 * Why the aggregate write is mandatory, not incidental: `claimOccurrenceLaunch` transacts
 * on a single occurrence document, so two *different* occurrences can each read the same
 * ledger, each find headroom, and both commit -- Firestore sees no conflict because they
 * touch disjoint documents. Re-running the reassessment inside the hook does not fix that;
 * both callers would compute the same stale-but-individually-valid answer. Moving this
 * member's row from `reserved` to `in_progress` (same debit, never re-charged -- D-LEDGER)
 * bumps the aggregate's `revision`, which is what makes a concurrent claim conflict and
 * retry against a ledger that now includes the other winner.
 *
 * Firestore's reads-before-writes rule shapes the whole hook: every `transaction.get` here
 * happens before `applyReservation` stages anything.
 *
 * What this module deliberately does NOT do: re-run `reassessDependentBundleMember`. The
 * `ReassessmentInputRevision` is a fingerprint of every input that verdict consumed, so an
 * unchanged fingerprint means an unchanged verdict by construction -- re-deriving it would
 * add a large parameter surface (readiness, availability, planned dose, the resolved
 * definition) whose only possible outcomes are "same answer" or "the fingerprint lied".
 * A *changed* fingerprint is not re-adjudicated here either: the claim fails closed and the
 * dashboard recomputes on its next load, which is the one path that can write a new
 * decision record. See `StaleDecisionError`.
 */

import { doc, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { SessionOccurrence } from '../sessions/models';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import { parseSessionResponseDocument } from '../persistence/parsers/sessionResponse';
import type { LedgerEntry } from '../engine/dailyLedger';
import { admitsCandidate, computeDailyLedger } from '../engine/dailyLedger';
import type { ReassessmentInputRevision } from '../engine/intradayReassessment';
import { validateIntradayDecisionRecord } from '../engine/intradayDecision';
import { getIntradayDecisionDocPath } from './intradayDecisionService';
import {
    DailyLedgerAggregateService,
    dailyLedgerAggregateService,
    hasSeededAggregate,
    type DailyLedgerAggregate,
    type DailyLedgerReservation,
} from './dailyLedgerAggregateService';
import {
    SessionOccurrenceService,
    sessionOccurrenceService,
} from './sessionOccurrenceService';
import {
    SessionExecutionService,
    sessionExecutionService,
} from './sessionExecutionService';
import { sessionResponseDocId } from './sessionResponseService';

/** Why a claim refused. Every value means "do not launch; recompute", never "retry as-is". */
export type StaleDecisionCode =
    | 'ledger-unseeded'
    | 'no-reservation'
    | 'reservation-not-reserved'
    | 'no-decision-pointer'
    | 'decision-missing'
    | 'decision-invalid'
    | 'decision-mismatch'
    | 'decision-not-proceed'
    | 'reservation-changed'
    | 'input-revision-changed'
    | 'predecessor-incomplete'
    | 'predecessor-confirmation-missing'
    | 'predecessor-confirmation-changed'
    | 'capacity-exhausted'
    | 'ledger-contended';

/**
 * The typed refusal plan step 11 requires. Callers must not navigate to the runner on this;
 * they refresh the dashboard and surface `athleteMessage`, which is deliberately written for
 * the athlete rather than restating the internal `code`.
 */
export class StaleDecisionError extends Error {
    readonly code: StaleDecisionCode;
    readonly athleteMessage: string;

    constructor(code: StaleDecisionCode, detail: string, athleteMessage: string) {
        super(`Intraday launch refused (${code}): ${detail}`);
        this.name = 'StaleDecisionError';
        this.code = code;
        this.athleteMessage = athleteMessage;
    }
}

const RECOMPUTING = 'Rechecking this session against your current day.';

function stale(code: StaleDecisionCode, detail: string, athleteMessage = RECOMPUTING): never {
    throw new StaleDecisionError(code, detail, athleteMessage);
}

/** The subset of the input fingerprint the dashboard carries to the tap. The check-in is
 * also re-read by document id inside the claim transaction; the remaining fields currently
 * have no single transaction-addressable source document and therefore use this fingerprint. */
export type DashboardInputRevision = Pick<
    ReassessmentInputRevision,
    'availabilityRevision' | 'completedFactsRevision' | 'checkinRevision' | 'placementRevision'
>;

export interface ClaimIntradayMemberLaunchParams {
    userId: string;
    date: string;
    occurrenceId: string;
    /**
     * The dashboard's freshly computed fingerprint. The date-keyed subjective check-in is
     * independently re-read inside the transaction below; availability, performed facts and
     * placement still use this dashboard-carried comparison because they are not represented
     * by one document the claim can address without a query.
     *
     * For those non-addressable inputs this closes the gap between the last dashboard
     * evaluation and the tap, not between the tap and the commit: a change landing inside
     * that final window is detectable only once its writer bumps the aggregate revision in
     * the same atomic write (plan step 11's "not addressable" contract).
     */
    dashboardInputRevision?: DashboardInputRevision;
    now?: string;
    db?: Firestore;
    services?: {
        occurrenceService?: SessionOccurrenceService;
        aggregateService?: DailyLedgerAggregateService;
    };
}

/**
 * Rebuilds ledger rows from the aggregate's own reservations -- the only day-level view a
 * transaction can obtain, since `Transaction.get` cannot run a query.
 *
 * Two exclusions, for different reasons:
 * - The candidate's own row, because it is the thing being measured; counting it would have
 *   it consume itself and flip an admitted member to rejected with every input unchanged.
 * - Every *other* row still in `reserved`. A reservation is a soft morning hold; a claim is
 *   the hard spend. Counting sibling holds as consumption would deny both members of a pair
 *   that two tabs over-admitted against the same earlier revision, leaving the athlete unable
 *   to start anything until a reload re-adjudicates. Counting only committed consumption
 *   (`in_progress` and terminal states) means the first claim converts its hold into a real
 *   debit and the second then finds no room -- exactly one winner, which is what ADR-0036's
 *   "two tabs cannot spend the same minute" asks for.
 *
 * `revision` orders competing evidence for one identity; within a single map each id appears
 * once, so a constant is correct and honest here.
 */
function entriesFromReservations(
    reservations: Record<string, DailyLedgerReservation>,
    excludeOccurrenceId: string,
): LedgerEntry[] {
    return Object.entries(reservations)
        .filter(([occurrenceId, reservation]) => occurrenceId !== excludeOccurrenceId && reservation.state !== 'reserved')
        .map(([occurrenceId, reservation]) => ({
            occurrenceId,
            revision: 1,
            reservedMinutes: reservation.minutes,
            reservedSystemicCost: reservation.systemicCost,
            state: reservation.state,
            ...(reservation.actualMinutes !== undefined ? { actualMinutes: reservation.actualMinutes } : {}),
            ...(reservation.actualSystemicCost !== undefined ? { actualSystemicCost: reservation.actualSystemicCost } : {}),
        }));
}

/**
 * Claims a non-primary bundle member for launch, or throws `StaleDecisionError`.
 *
 * On success the occurrence is `active` and its ledger row is `in_progress`. On any refusal
 * nothing is written: the whole transaction aborts, so a refused claim can never leave the
 * occurrence claimed with its capacity un-debited (or the reverse).
 */
export async function claimIntradayMemberLaunch(
    params: ClaimIntradayMemberLaunchParams,
): Promise<SessionOccurrence> {
    const {
        userId,
        date,
        occurrenceId,
        dashboardInputRevision,
        now = new Date().toISOString(),
    } = params;
    const db = params.db ?? getDb();
    const occurrenceService = params.services?.occurrenceService
        ?? (params.db ? new SessionOccurrenceService(params.db) : sessionOccurrenceService);
    const aggregateService = params.services?.aggregateService
        ?? (params.db ? new DailyLedgerAggregateService(params.db) : dailyLedgerAggregateService);

    try {
        return await claimWithinTransaction();
    } catch (err) {
        if (err instanceof StaleDecisionError) throw err;
        // The only rules that can reject this transaction's writes are the aggregate's
        // `revision == old + 1` clause and the occurrence's state-transition clause -- both of
        // which mean another writer got there first. Firestore usually surfaces that as a
        // contention abort and retries, at which point the re-read catches it as
        // `capacity-exhausted`; when the rules reject the stale revision before the abort
        // fires, the raw error is `permission-denied` instead, for the same underlying reason.
        // Translating it keeps the athlete on the recompute path rather than showing a
        // permission failure for ordinary two-tab contention. The original message is carried
        // in `detail` so a genuine rules regression is still diagnosable rather than silenced.
        if ((err as { code?: string })?.code === 'permission-denied') {
            stale('ledger-contended', `another writer changed the day's ledger first: ${(err as Error).message}`);
        }
        throw err;
    }

    function claimWithinTransaction() {
        return occurrenceService.claimOccurrenceLaunch(userId, occurrenceId, {
        now,
        onBeforeClaim: async (transaction, occurrence) => {
            if (occurrence.date !== date) {
                stale('decision-mismatch', `occurrence ${occurrenceId} is dated ${occurrence.date}, not ${date}`);
            }

            // ---- reads (all of them, before any write) ----
            const aggRef = aggregateService.ref(userId, date);
            const aggSnap = await transaction.get(aggRef);
            const aggregate = aggSnap.exists() ? (aggSnap.data() as DailyLedgerAggregate) : null;
            if (!hasSeededAggregate(aggregate)) {
                // An absent or half-written aggregate is not an empty day with free capacity
                // (plan step 6a: "Initialization is part of the contract").
                stale('ledger-unseeded', `no seeded daily ledger for ${date}`);
            }

            const reservation = aggregate.reservations?.[occurrenceId];
            if (!reservation) {
                stale('no-reservation', `occurrence ${occurrenceId} holds no ledger reservation`);
            }
            if (reservation.state !== 'reserved') {
                // `in_progress` here is the double-claim case: another tab already won.
                stale('reservation-not-reserved', `reservation state is '${reservation.state}', expected 'reserved'`);
            }
            if (!reservation.decisionId) {
                // A `pending`/`scale` member legitimately has no decision record; a member
                // offered for launch without one has no durable expected revision to check
                // against, which is exactly the non-transactional fallback this closes.
                stale('no-decision-pointer', `reservation for ${occurrenceId} carries no decisionId`);
            }

            const decSnap = await transaction.get(doc(db, getIntradayDecisionDocPath(userId, reservation.decisionId)));
            if (!decSnap.exists()) {
                stale('decision-missing', `decision ${reservation.decisionId} no longer exists`);
            }
            const decision = (() => {
                try {
                    return validateIntradayDecisionRecord(decSnap.data());
                } catch (err) {
                    stale('decision-invalid', `decision ${reservation.decisionId} failed validation: ${(err as Error).message}`);
                }
            })();

            if (decision.userId !== userId || decision.occurrenceId !== occurrenceId || decision.date !== date) {
                stale('decision-mismatch', `decision ${decision.id} does not describe ${occurrenceId} on ${date}`);
            }
            if (decision.status !== 'provisional') {
                stale('decision-mismatch', `decision ${decision.id} has status '${decision.status}'`);
            }
            if (decision.verdict.decision !== 'proceed') {
                // Belt and braces: the adjudication loop only writes a reservation for a
                // `proceed`, so reaching this means the record was superseded underneath us.
                stale('decision-not-proceed', `decision ${decision.id} verdict is '${decision.verdict.decision}'`);
            }
            if (
                // Both fields are optional on their respective shapes, so an absent pair
                // would compare equal and wave the claim through on a record that pins
                // nothing. A launchable member must carry the pointer on both sides.
                !reservation.postReservationLedgerRevision
                || !decision.postReservationLedgerRevision
                || reservation.postReservationLedgerRevision !== decision.postReservationLedgerRevision
            ) {
                // This member's own row changed since the decision was written (rejected and
                // re-reserved, superseded by a re-import, or reconciled). Other members'
                // reservations advancing the aggregate `revision` is *not* invalidating --
                // this member's debit was already granted and is not re-charged.
                stale('reservation-changed', `reservation revision '${reservation.postReservationLedgerRevision}' != decision's '${decision.postReservationLedgerRevision}'`);
            }

            // Unlike availability/placement/performed facts, today's subjective check-in has
            // a deterministic document id. Read it *inside this transaction* so an edit from
            // another tab after Home rendered cannot pass by comparing the cached fingerprint
            // to the decision that was created from that same cached fingerprint.
            const expectedCheckinRevision = decision.reassessmentInputRevision.checkinRevision;
            const checkinRef = doc(db, 'users', userId, 'daily_subjective_checkins', date);
            const checkinSnap = await transaction.get(checkinRef);
            let actualCheckinRevision = 'checkin-missing';
            if (checkinSnap.exists()) {
                const parsedCheckin = parseSubjectiveCheckin(checkinSnap.data(), checkinRef.path, userId, date);
                if (parsedCheckin.status !== 'AVAILABLE') {
                    stale('input-revision-changed', `current check-in could not be parsed (${parsedCheckin.status})`);
                }
                // `checkin-present` is the intentionally coarse fallback used when the
                // dashboard had a check-in value but no source revision. Preserve that
                // contract instead of spuriously comparing it to a now-visible timestamp.
                actualCheckinRevision = expectedCheckinRevision === 'checkin-present'
                    ? 'checkin-present'
                    : (parsedCheckin.revision ?? 'checkin-present');
            }
            if (actualCheckinRevision !== expectedCheckinRevision) {
                stale(
                    'input-revision-changed',
                    `checkinRevision changed since the verdict ('${expectedCheckinRevision}' -> '${actualCheckinRevision}')`,
                );
            }

            if (dashboardInputRevision) {
                const expected = decision.reassessmentInputRevision;
                for (const field of ['availabilityRevision', 'completedFactsRevision', 'checkinRevision', 'placementRevision'] as const) {
                    if (dashboardInputRevision[field] !== expected[field]) {
                        stale('input-revision-changed', `${field} changed since the verdict ('${expected[field]}' -> '${dashboardInputRevision[field]}')`);
                    }
                }
            }

            const { predecessorOccurrenceId, predecessorExecutionId } = decision;
            if (predecessorOccurrenceId && predecessorExecutionId) {
                const predSnap = await transaction.get(occurrenceService.occurrenceRef(userId, predecessorOccurrenceId));
                if (!predSnap.exists()) {
                    stale('predecessor-incomplete', `predecessor occurrence ${predecessorOccurrenceId} not found`);
                }
                const predParsed = parseSessionOccurrenceDocument(predSnap.data(), `users/${userId}/session_occurrences/${predecessorOccurrenceId}`);
                if (predParsed.status !== 'AVAILABLE' || predParsed.data.state !== 'completed') {
                    stale(
                        'predecessor-incomplete',
                        `predecessor ${predecessorOccurrenceId} is not completed`,
                        'Finish your earlier session first — this one unlocks once it is logged.',
                    );
                }

                const expectedConfirmation = decision.reassessmentInputRevision.postPredecessorConfirmationRevision;
                if (!expectedConfirmation) {
                    // D-REASSESS forbids an unconfirmed dependent launch. A record naming a
                    // predecessor but pinning no confirmation cannot prove one was given, and
                    // must not be the one path that skips the check.
                    stale(
                        'predecessor-confirmation-missing',
                        `decision ${decision.id} names a predecessor but pins no confirmation revision`,
                        'Answer the check-in for your earlier session to unlock this one.',
                    );
                }
                const respRef = doc(
                    db,
                    'users',
                    userId,
                    'session_responses',
                    sessionResponseDocId({ kind: 'execution', id: predecessorExecutionId }, 'immediate'),
                );
                const respSnap = await transaction.get(respRef);
                if (!respSnap.exists()) {
                    stale(
                        'predecessor-confirmation-missing',
                        `no immediate response for predecessor execution ${predecessorExecutionId}`,
                        'Answer the check-in for your earlier session to unlock this one.',
                    );
                }
                const respParsed = parseSessionResponseDocument(respSnap.data(), respRef.path);
                if (respParsed.status !== 'AVAILABLE') {
                    stale('predecessor-confirmation-missing', `predecessor response could not be parsed (${respParsed.status})`);
                }
                const actualConfirmation = respParsed.data.updatedAt ?? respParsed.data.createdAt;
                if (actualConfirmation !== expectedConfirmation) {
                    // ADR-0036: "changes to completion, symptoms, ... invalidate a pending PM approval".
                    stale(
                        'predecessor-confirmation-changed',
                        `predecessor confirmation moved ('${expectedConfirmation}' -> '${actualConfirmation}')`,
                    );
                }
            }

            // Capacity, re-checked against the aggregate as it stands *now*. Two tabs that
            // each adjudicated against the same earlier revision can both have written a
            // reservation; this is where the second one is caught, because its own row is
            // excluded and every other live row is charged against the ceiling.
            const ledger = computeDailyLedger(
                aggregate.ceilings,
                entriesFromReservations(aggregate.reservations, occurrenceId),
            );
            const admission = admitsCandidate(ledger, reservation.minutes, reservation.minutes, reservation.systemicCost);
            if (!admission.admitted) {
                stale(
                    'capacity-exhausted',
                    `no remaining capacity (${ledger.remainingMinutes} min / ${ledger.remainingSystemicCost} cost) for ${reservation.minutes} min / ${reservation.systemicCost} cost`,
                    "Today's remaining training capacity is already spoken for.",
                );
            }

            // ---- write (reserved -> in_progress; same debit, revision +1) ----
            aggregateService.applyReservation(
                transaction,
                userId,
                date,
                aggregate,
                occurrenceId,
                { ...reservation, state: 'in_progress' },
                now,
            );
        },
        });
    }
}

export interface ReleaseIntradayMemberClaimParams {
    userId: string;
    date: string;
    occurrenceId: string;
    now?: string;
    db?: Firestore;
    services?: {
        occurrenceService?: SessionOccurrenceService;
        aggregateService?: DailyLedgerAggregateService;
        executionService?: SessionExecutionService;
    };
}

/**
 * Plan step 11's rollback: undo a committed claim when the launch failed afterwards.
 * Returns the occurrence to `scheduled` and its ledger row to `reserved` in one transaction,
 * so the two can never disagree about whether the member is running.
 *
 * Never throws. It runs inside a `catch` on the launch path, and a failure to roll back must
 * surface as the original launch error plus a stranded-but-visible occurrence, not as a
 * second exception that hides why the launch failed in the first place. The caller logs the
 * returned reason.
 */
export async function releaseIntradayMemberClaim(
    params: ReleaseIntradayMemberClaimParams,
): Promise<{ released: boolean; reason?: string }> {
    const { userId, date, occurrenceId, now = new Date().toISOString() } = params;
    const occurrenceService = params.services?.occurrenceService
        ?? (params.db ? new SessionOccurrenceService(params.db) : sessionOccurrenceService);
    const aggregateService = params.services?.aggregateService
        ?? (params.db ? new DailyLedgerAggregateService(params.db) : dailyLedgerAggregateService);
    const executionService = params.services?.executionService
        ?? (params.db ? new SessionExecutionService(params.db) : sessionExecutionService);

    try {
        // Plan step 11: release only when no execution references the occurrence. The Web
        // transaction API can only read documents by reference, not run this query, so this
        // is necessarily a preflight. The transaction below independently requires the exact
        // ledger row to still be `in_progress`; it will now abort rather than scheduling the
        // occurrence when that paired rollback cannot also be committed.
        const existingExecution = await executionService.findExecutionByOccurrenceId(userId, occurrenceId);
        if (existingExecution) {
            return { released: false, reason: `execution ${existingExecution.executionId} already references this occurrence` };
        }

        const released = await occurrenceService.releaseOccurrenceClaim(userId, occurrenceId, {
            now,
            onBeforeRelease: async transaction => {
                const aggRef = aggregateService.ref(userId, date);
                const aggSnap = await transaction.get(aggRef);
                const aggregate = aggSnap.exists() ? (aggSnap.data() as DailyLedgerAggregate) : null;
                if (!hasSeededAggregate(aggregate)) {
                    throw new Error(`cannot release ${occurrenceId}: no seeded daily ledger for ${date}`);
                }
                const reservation = aggregate.reservations?.[occurrenceId];
                // Only an `in_progress` row is ours to reverse. A row already reconciled to
                // `completed`/`partial`/`abandoned` means the session really ran; re-reserving
                // it would double-charge the day. Missing/wrong state must abort the *whole*
                // transaction -- returning here would otherwise still write active->scheduled
                // and split occurrence truth from ledger truth.
                if (!reservation || reservation.state !== 'in_progress') {
                    throw new Error(
                        `cannot release ${occurrenceId}: reservation is ${reservation ? `'${reservation.state}'` : 'missing'}, expected 'in_progress'`,
                    );
                }
                aggregateService.applyReservation(
                    transaction,
                    userId,
                    date,
                    aggregate,
                    occurrenceId,
                    { ...reservation, state: 'reserved' },
                    now,
                );
            },
        });
        if (!released) return { released: false, reason: 'occurrence not found' };
        if (released.state !== 'scheduled') return { released: false, reason: `occurrence is '${released.state}'` };
        return { released: true };
    } catch (err) {
        return { released: false, reason: (err as Error).message };
    }
}
