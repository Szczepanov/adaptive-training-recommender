/**
 * ADR-0036 (H4) D-LEDGER, Phase 2 step 6a of
 * `docs/plans/h4-434-pr3-bundle-second-member-launch.md`: the persisted date-level
 * reservation aggregate at `users/{userId}/daily_ledgers/{date}`.
 *
 * Why this document has to exist at all: in the Web SDK, `Transaction.get()` accepts a
 * `DocumentReference` only -- a transaction cannot query "every occurrence for this date"
 * to re-derive the day's ledger. So the day's reservation totals must live in one named
 * document every reserving/releasing writer reads and updates atomically, and
 * `intradayLedgerInputs.ts`'s `buildLedgerEntries` (step 6) becomes a read-side
 * projection over `session_occurrences`, not the serialization authority the claim
 * transaction (Phase 4 step 11) actually reads.
 *
 * Every transition that changes an occurrence's reserving status must update this
 * document and bump `revision` in the *same* transaction as the occurrence write --
 * see the table in the plan's step 6a. This module exposes the primitives
 * (`seedIfAbsent`, `applyReservation`) that those call sites compose; it does not itself
 * own a `runTransaction` for the mutating path, because the reservation change must
 * commit atomically with whatever occurrence/decision write triggered it, not as a
 * separate round trip.
 *
 * Wiring status (tracked here so this doesn't read as silently "done"):
 * `getOrCreateExternalPlanOccurrence` (`sessionOccurrenceService.ts`) already covers the
 * "create" and re-import "supersede" rows. Phase 3 step 8 item 2a now has the dedicated
 * `rejectReservationAndIncrementGeneration` aggregate primitive, but the Home adjudication
 * transaction still has to compose it with the occurrence's `scheduled -> skipped` write.
 * "claim"/"release" (Phase 4 step 11) and completion/abandonment reconciliation
 * (`useSessionRunner.ts`) still need to compose `applyReservation` once those call sites
 * exist. The primitive layer therefore enforces the ledger invariants without claiming the
 * later end-to-end wiring is already shipped.
 */

import { doc, getDoc, type DocumentReference, type Firestore, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { LedgerCeilings, ReconciliationState } from '../engine/dailyLedger';
import { buildLedgerEntries, type OccurrenceLedgerInput } from '../engine/intradayLedgerInputs';

/** One occurrence's row in the aggregate. Mirrors `LedgerEntry`'s reservation/actual
 * fields under the `minutes`/`systemicCost` names the persisted document uses.
 * `decisionId` is optional on the row but mandatory for anything launchable (plan step
 * 6a): a `pending`/`scale` reservation legitimately has none, since step 9 only writes a
 * decision record for a member that receives a binding -- the claim (step 11) must reject
 * a launchable entry lacking one rather than reading the absence as "nothing to check". */
export interface DailyLedgerReservation {
    minutes: number;
    systemicCost: number;
    state: ReconciliationState;
    actualMinutes?: number;
    actualSystemicCost?: number;
    decisionId?: string;
    postReservationLedgerRevision?: string;
}

/**
 * Maximum permitted recovery generation counter. Kept deliberately far below
 * Number.MAX_SAFE_INTEGER. Reaching the cap is an explicit fail-closed condition: silently
 * saturating here would let a later recovery reuse the same deterministic occurrence id.
 */
export const MAX_RECOVERY_GENERATION = 1_000_000;

export interface DailyLedgerAggregate {
    userId: string;
    date: string;
    revision: number;
    ceilings: LedgerCeilings;
    reservations: Record<string, DailyLedgerReservation>;
    /**
     * H4 (#434) PR 3 plan step 8, item 2a: per-`sessionId` recovery generation counters.
     * `date` is already this document's own identity, so the key is `sessionId` alone.
     * A `reject` that transitions a `scheduled` occurrence to `skipped` increments the
     * counter for that session in the same transaction; a later `pending`/`proceed`
     * verdict for the same session mints a *new* occurrence identity carrying the current
     * generation, rather than reactivating the terminal `skipped` document (which #445's
     * transition table forbids). Absent key means generation 0 -- the original,
     * pre-recovery occurrence identity `deterministicExternalPlanOccurrenceId` already
     * produces unchanged, so a session that has never been rejected needs no entry here.
     */
    generations?: Record<string, number>;
    /** Presence (not just document existence) is what "seeded" means -- see
     * `hasSeededAggregate`. A partially-written document without this field must still
     * fail closed rather than read as an empty day. */
    seededAt: string;
    createdAt: string;
    updatedAt: string;
}

/** True only for a document that completed seeding. A claim (Phase 4 step 11) must treat
 * an absent *or* unseeded aggregate as "fail closed", never as an empty day with free
 * capacity (plan step 6a: "Initialization is part of the contract"). */
export function hasSeededAggregate(aggregate: DailyLedgerAggregate | null | undefined): aggregate is DailyLedgerAggregate {
    return !!aggregate && typeof aggregate.seededAt === 'string' && aggregate.seededAt.length > 0;
}

function reservationFromLedgerEntry(entry: ReturnType<typeof buildLedgerEntries>[number]): DailyLedgerReservation {
    return {
        minutes: entry.reservedMinutes,
        systemicCost: entry.reservedSystemicCost,
        state: entry.state,
        ...(entry.actualMinutes !== undefined ? { actualMinutes: entry.actualMinutes } : {}),
        ...(entry.actualSystemicCost !== undefined ? { actualSystemicCost: entry.actualSystemicCost } : {}),
    };
}

/** Builds the initial `reservations` map for a seed. Reuses `buildLedgerEntries` (step 6)
 * verbatim rather than restating its state mapping, so the seed and the derived ledger
 * can never drift -- a subset here is exactly how a pre-existing occurrence (e.g. an
 * abandoned execution) would be dropped from the seed and undercount the day. */
export function buildInitialReservations(inputs: readonly OccurrenceLedgerInput[]): Record<string, DailyLedgerReservation> {
    const reservations: Record<string, DailyLedgerReservation> = {};
    for (const entry of buildLedgerEntries(inputs)) {
        reservations[entry.occurrenceId] = reservationFromLedgerEntry(entry);
    }
    return reservations;
}

/**
 * Read-side reconciliation check (plan step 6a): recomputes the seed set the aggregate
 * *should* currently reflect for its already-reserving occurrences and reports any
 * disagreement. A mismatch is a bug to surface, never to silently paper over by trusting
 * whichever side shows less consumption -- callers should prefer the aggregate's own
 * value when it is the higher (more conservative) one.
 */
export function findAggregateDrift(
    aggregate: DailyLedgerAggregate,
    currentInputs: readonly OccurrenceLedgerInput[],
): string[] {
    const expected = buildInitialReservations(currentInputs);
    const drifted: string[] = [];
    const ids = new Set([...Object.keys(expected), ...Object.keys(aggregate.reservations)]);
    for (const occurrenceId of ids) {
        const a = aggregate.reservations[occurrenceId];
        const b = expected[occurrenceId];
        if (JSON.stringify(a) !== JSON.stringify(b)) drifted.push(occurrenceId);
    }
    return drifted;
}

export class DailyLedgerAggregateService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    ref(userId: string, date: string): DocumentReference {
        return doc(this.db, 'users', userId, 'daily_ledgers', date);
    }

    async get(userId: string, date: string): Promise<DailyLedgerAggregate | null> {
        const snap = await getDoc(this.ref(userId, date));
        return snap.exists() ? (snap.data() as DailyLedgerAggregate) : null;
    }

    /**
     * Create-if-absent seeding, callable from inside a caller-supplied transaction so it
     * can commit atomically with whatever occurrence write is triggering it (e.g. a bundle
     * member's first reservation on a date that has no aggregate yet). `transaction.get`
     * on this document must already have been read by the caller *before* any writes in
     * that transaction (Firestore's reads-before-writes rule) -- pass that snapshot's data
     * as `existing`. A concurrent seeder loses the create (Firestore's transaction commit
     * protocol detects the conflict) and retries, so two tabs opening the same day cannot
     * produce two different starting balances.
     */
    seedIfAbsent(
        transaction: Transaction,
        userId: string,
        date: string,
        existing: DailyLedgerAggregate | null,
        ceilings: LedgerCeilings,
        inputs: readonly OccurrenceLedgerInput[],
        now = new Date().toISOString(),
    ): DailyLedgerAggregate {
        const priorCreatedAt = existing?.createdAt;
        if (hasSeededAggregate(existing)) return existing;
        const aggregate: DailyLedgerAggregate = {
            userId,
            date,
            revision: 1,
            ceilings,
            reservations: buildInitialReservations(inputs),
            seededAt: now,
            createdAt: priorCreatedAt ?? now,
            updatedAt: now,
        };
        transaction.set(this.ref(userId, date), aggregate);
        return aggregate;
    }

    /**
     * Adds, replaces, or removes one occurrence's reservation row and bumps `revision` by
     * exactly one (the rules enforce this, so a stale caller's write is rejected rather
     * than silently applied). Must be called with `current` already read via
     * `transaction.get` in the same transaction, and only after any `seedIfAbsent` call in
     * that same transaction. Passing `reservation: null` removes the row -- the "reject"
     * and "re-import supersede" rows in the plan's step 6a table.
     */
    applyReservation(
        transaction: Transaction,
        userId: string,
        date: string,
        current: DailyLedgerAggregate,
        occurrenceId: string,
        reservation: DailyLedgerReservation | null,
        now = new Date().toISOString(),
    ): DailyLedgerAggregate {
        const reservations = { ...current.reservations };
        if (reservation) {
            reservations[occurrenceId] = reservation;
        } else {
            delete reservations[occurrenceId];
        }
        const next: DailyLedgerAggregate = {
            ...current,
            reservations,
            revision: current.revision + 1,
            updatedAt: now,
        };
        transaction.set(this.ref(userId, date), next);
        return next;
    }

    /**
     * The "reject" row of the plan step 6a transition table, as one combined write: drops
     * the rejected occurrence's reservation *and* bumps its recovery generation counter,
     * in a single `transaction.set` (bumping `revision` by exactly one total, matching the
     * rules' strict +1-per-write enforcement). Deliberately not two separate
     * `applyReservation`/generation calls -- multiple writes to the same document
     * reference within one transaction is more than this module needs to rely on when a
     * single combined write says the same thing unambiguously. The returned generation is
     * what a later recovery (step 8, item 2a) mints its new occurrence identity with.
     *
     * If the stored generation is malformed or already at the supported maximum this
     * method throws before writing. Falling back to 0 or saturating at the maximum would
     * allow a later recovery to reuse a terminal skipped occurrence's deterministic id.
     */
    rejectReservationAndIncrementGeneration(
        transaction: Transaction,
        userId: string,
        date: string,
        current: DailyLedgerAggregate,
        occurrenceId: string,
        sessionId: string,
        now = new Date().toISOString(),
    ): { aggregate: DailyLedgerAggregate; generation: number } {
        const currentGeneration = this.currentGeneration(current, sessionId);
        if (currentGeneration >= MAX_RECOVERY_GENERATION) {
            throw new RangeError(
                `Recovery generation exhausted for session '${sessionId}' on ${date}; refusing to reuse an occurrence identity.`,
            );
        }

        const reservations = { ...current.reservations };
        delete reservations[occurrenceId];
        const generation = currentGeneration + 1;
        const generations = { ...current.generations, [sessionId]: generation };
        const next: DailyLedgerAggregate = {
            ...current,
            reservations,
            generations,
            revision: current.revision + 1,
            updatedAt: now,
        };
        transaction.set(this.ref(userId, date), next);
        return { aggregate: next, generation };
    }

    /**
     * The current recovery generation for a session. An absent map or key means generation
     * 0. A present map/value is persisted identity state, not advisory metadata: malformed
     * container shape, negative/non-safe-integer values, or out-of-range values fail closed
     * instead of being coerced to 0, because coercion could mint an occurrence id that was
     * already used by an earlier generation.
     */
    currentGeneration(aggregate: DailyLedgerAggregate, sessionId: string): number {
        const generations = aggregate.generations;
        if (generations === undefined) return 0;
        if (generations === null || typeof generations !== 'object' || Array.isArray(generations)) {
            throw new TypeError('Invalid recovery generation map.');
        }
        if (!Object.prototype.hasOwnProperty.call(generations, sessionId)) return 0;

        const val = generations[sessionId];
        if (
            typeof val !== 'number'
            || !Number.isSafeInteger(val)
            || val < 0
            || val > MAX_RECOVERY_GENERATION
        ) {
            throw new TypeError(`Invalid recovery generation for session '${sessionId}'.`);
        }
        return val;
    }
}

export const dailyLedgerAggregateService = new DailyLedgerAggregateService();
