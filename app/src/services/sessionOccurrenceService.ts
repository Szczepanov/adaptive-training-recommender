import {
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    runTransaction,
    type Firestore,
    type Transaction,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import {
    type OccurrenceState,
    type SessionOccurrence,
    type ManualOccurrenceAuthority,
    type ManualOccurrenceRef,
    type ExternalPlanOccurrenceRef,
    type ExternalPlanSessionOccurrence,
    type OccurrenceWindowBinding,
    isExternalPlanOccurrence,
} from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import { MAX_RECOVERY_GENERATION } from './dailyLedgerAggregateService';

/** ACTIVE_OCCURRENCE_STATES excludes terminal/superseded states from "what governs today". */
const ACTIVE_OCCURRENCE_STATES: ReadonlySet<SessionOccurrence['state']> = new Set(['scheduled', 'active']);

/**
 * H4 (#434) PR 3, Phase 1 step 4: a rejected member (`scheduled -> skipped`, plan step 8)
 * or a re-imported revision's predecessor (`scheduled -> superseded`, plan step 4b) has
 * never governed today's decision and never will again -- neither reserves capacity nor
 * is offered for adjudication. Both are excluded from the bundle-member query below.
 */
const BUNDLE_QUERY_EXCLUDED_STATES: ReadonlySet<SessionOccurrence['state']> = new Set(['superseded', 'skipped']);

/**
 * Valid occurrence lifecycle transitions.
 * Until the PR 3 launch-claim path is wired for every occurrence-backed execution,
 * a scheduled occurrence may finish directly as completed/abandoned as well as being
 * claimed (active), skipped, superseded, or marked missed. Once claimed, active
 * occurrences may be completed, abandoned, or superseded. Terminal states cannot move.
 */
export const VALID_OCCURRENCE_TRANSITIONS: Record<OccurrenceState, readonly OccurrenceState[]> = {
    scheduled: ['active', 'completed', 'abandoned', 'skipped', 'superseded', 'missed'],
    active: ['completed', 'abandoned', 'superseded'],
    completed: [],
    abandoned: [],
    missed: [],
    skipped: [],
    superseded: [],
};

export function isValidOccurrenceTransition(from: OccurrenceState, to: OccurrenceState): boolean {
    if (from === to) return true;
    const allowed = VALID_OCCURRENCE_TRANSITIONS[from];
    return allowed !== undefined && allowed.includes(to);
}

/**
 * Computes a deterministic Firestore document ID for an external-plan occurrence using SHA-256.
 * Ensures concurrent getOrCreate operations resolve to the exact same document ID without
 * character replacement collisions or reserved Firestore identifier issues.
 *
 * `generation` (H4 #434 PR 3 plan step 8, item 2a) is the recovery discriminator: a member
 * rejected earlier in the day and later admissible again (predecessor completed, symptom
 * resolved, capacity freed) must recover as a *new* occurrence identity rather than
 * reactivate the terminal `skipped` document (#445's transition table forbids that
 * transition). `generation` defaults to `0`, which hashes identically to every id already
 * minted before this parameter existed -- this is a pure additive extension, not a change
 * to any occurrence identity that already exists in production. `generation` is not
 * incremented here; the caller reads the current value from
 * `dailyLedgerAggregateService.currentGeneration` (already bumped by the `reject` that
 * necessitated the recovery) and passes it in. Explicit malformed or unsupported values
 * fail closed: silently mapping them back to generation 0 could reuse a terminal occurrence
 * identity and defeat the recovery discriminator itself.
 */
export async function deterministicExternalPlanOccurrenceId(
    date: string,
    ref: ExternalPlanOccurrenceRef,
    generation = 0,
): Promise<string> {
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation)) {
        throw new TypeError('Recovery generation must be a safe integer.');
    }
    if (generation < 0 || generation > MAX_RECOVERY_GENERATION) {
        throw new RangeError(`Recovery generation must be between 0 and ${MAX_RECOVERY_GENERATION}.`);
    }

    const raw = JSON.stringify([
        date,
        ref.planId,
        ref.sessionId,
        ref.revision,
        ref.contentHash,
        ...(generation > 0 ? [generation] : []),
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 24);
    return `ext_${date}_${hash}`;
}

/**
 * H4 (#434) PR 3 / ADR-0036 D-WINDOW: deterministic id for the `session_occurrence_windows`
 * document that gives one resolved window on one date real transactional exclusivity.
 * `windowId` is app-generated (a real `ScheduleWindow.id` or the `LEGACY_SINGLE_SLOT_WINDOW_ID`
 * sentinel), not athlete-supplied free text, so `encodeURIComponent` is sufficient here --
 * unlike `deterministicExternalPlanOccurrenceId`, which hashes because plan session ids are.
 */
export function windowReservationId(date: string, windowId: string): string {
    return `win-${date}-${encodeURIComponent(windowId)}`;
}

export interface ClaimOccurrenceLaunchOptions {
    now?: string;
    /**
     * Optional atomic pre-claim hook executed within the same Firestore transaction.
     * Allows callers to read date-level ledger documents, verify ReassessmentInputRevision,
     * or persist capacity reservations atomically before transitioning the occurrence to active.
     */
    onBeforeClaim?: (transaction: Transaction, occurrence: Readonly<SessionOccurrence>) => Promise<void> | void;
}

export class SessionOccurrenceService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private occurrenceRef(userId: string, occurrenceId: string) {
        return doc(this.db, 'users', userId, 'session_occurrences', occurrenceId);
    }

    private windowReservationRef(userId: string, date: string, windowId: string) {
        return doc(this.db, 'users', userId, 'session_occurrence_windows', windowReservationId(date, windowId));
    }

    async saveOccurrence(occurrence: SessionOccurrence): Promise<void> {
        await setDoc(this.occurrenceRef(occurrence.userId, occurrence.occurrenceId), occurrence);
    }

    async getOccurrence(userId: string, occurrenceId: string): Promise<DataState<SessionOccurrence>> {
        const path = `users/${userId}/session_occurrences/${occurrenceId}`;
        try {
            const snap = await getDoc(this.occurrenceRef(userId, occurrenceId));
            return parseSessionOccurrenceDocument(snap.exists() ? snap.data() : undefined, path);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getOccurrence', retryable: true };
        }
    }

    async getOccurrencesForDate(userId: string, date: string): Promise<SessionOccurrence[]> {
        const coll = collection(this.db, 'users', userId, 'session_occurrences');
        const q = query(coll, where('date', '==', date));
        const snap = await getDocs(q);
        const occurrences: SessionOccurrence[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionOccurrenceDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE') {
                occurrences.push(parsed.data);
            }
        }
        return occurrences.sort((a, b) =>
            (a.placementOrder ?? 0) - (b.placementOrder ?? 0)
            || a.occurrenceId.localeCompare(b.occurrenceId));
    }

    private newOccurrenceId(): string {
        return `occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /** Shared persistence constructor for authority-bearing occurrences. Persisting an
     * authority value is not itself permission to alter a recommendation; the gated
     * composition path required by ADR-0023 D-MAUTH remains separate. */
    private async createOccurrence(
        userId: string,
        date: string,
        authority: ManualOccurrenceAuthority,
        definitionRef: ManualOccurrenceRef,
        placementOrder?: number,
        now = new Date().toISOString(),
    ): Promise<SessionOccurrence> {
        const occurrence: SessionOccurrence = {
            userId, occurrenceId: this.newOccurrenceId(), date, authority, definitionRef,
            state: 'scheduled',
            ...(placementOrder !== undefined ? { placementOrder } : {}),
            createdAt: now, updatedAt: now,
        };
        await this.saveOccurrence(occurrence);
        return occurrence;
    }

    /** A future-dated (or today-dated) session the athlete has committed to, with no claim
     * on today's recommendation until/unless it becomes today's date. */
    async scheduleOccurrence(
        userId: string,
        date: string,
        definitionRef: ManualOccurrenceRef,
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'schedule', definitionRef);
    }

    /** Persists a request to replace the engine's pick for `date`. Until the gated M3.3
     * composition path exists, creating this occurrence does not change a recommendation. */
    async replaceRecommendationOccurrence(
        userId: string,
        date: string,
        definitionRef: ManualOccurrenceRef,
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'replace_recommendation', definitionRef);
    }

    /** Persists a request to add a session on `date`. `placementOrder` disambiguates multiple
     * additions; a separate gated composition path must attach them to a recommendation. */
    async addAdditionalSessionOccurrence(
        userId: string,
        date: string,
        definitionRef: ManualOccurrenceRef,
        placementOrder?: number,
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'additional_session', definitionRef, placementOrder);
    }

    /**
     * Schedules an external-plan session occurrence with 'external_plan' authority.
     */
    async scheduleExternalPlanOccurrence(
        userId: string,
        date: string,
        externalPlanRef: ExternalPlanOccurrenceRef,
        placementOrder?: number,
        now = new Date().toISOString(),
        customOccurrenceId?: string,
    ): Promise<ExternalPlanSessionOccurrence> {
        const occurrence: ExternalPlanSessionOccurrence = {
            userId,
            occurrenceId: customOccurrenceId ?? this.newOccurrenceId(),
            date,
            authority: 'external_plan',
            externalPlanRef,
            state: 'scheduled',
            ...(placementOrder !== undefined ? { placementOrder } : {}),
            createdAt: now,
            updatedAt: now,
        };
        await this.saveOccurrence(occurrence);
        return occurrence;
    }

    /**
     * Idempotently retrieves an existing external-plan occurrence for
     * (userId, date, planId, sessionId, revision, contentHash), or schedules a new one with
     * a deterministic occurrenceId if not yet present. Transactionally reads and creates to
     * prevent concurrent double-creations and permission errors on Firestore updates.
     *
     * Two H4 (#434) PR 3 responsibilities live here, both required before this occurrence
     * can be trusted by Phase 2's ledger or Phase 4's claim:
     *
     * - **D-WINDOW exclusivity (plan step 4a):** when `windowBinding` is supplied, this
     *   atomically claims `session_occurrence_windows/(date, windowId)` alongside creating
     *   the occurrence, so two occurrences can never end up bound to the same resolved
     *   window even if placement resolution is ever wrong.
     * - **Re-import supersession (plan step 4b):** a prior `scheduled` occurrence for the
     *   same `(date, planId, sessionId)` under a *different* revision/contentHash is
     *   transitioned to `superseded` in this same transaction, releasing its window
     *   reservation (if any) so a same-window successor is not blocked by history that no
     *   longer governs anything. An occurrence that already reached `active`/`completed` is
     *   never touched -- its consumption is real (D-LEDGER).
     *
     * The candidate predecessor is found by query *outside* the transaction (a transaction
     * cannot query) and re-verified by direct document reference *inside* it, so a
     * concurrent claim/completion of that predecessor between the two reads is not
     * silently overwritten.
     */
    async getOrCreateExternalPlanOccurrence(
        userId: string,
        date: string,
        externalPlanRef: ExternalPlanOccurrenceRef,
        options: {
            placementOrder?: number;
            windowBinding?: OccurrenceWindowBinding;
            now?: string;
        } = {},
    ): Promise<SessionOccurrence> {
        const now = options.now ?? new Date().toISOString();
        const deterministicId = await deterministicExternalPlanOccurrenceId(date, externalPlanRef);
        const ref = this.occurrenceRef(userId, deterministicId);
        const windowReservationRef = options.windowBinding
            ? this.windowReservationRef(userId, date, options.windowBinding.windowId)
            : null;

        const sameDayOccurrences = await this.getOccurrencesForDate(userId, date);
        const priorRevision = sameDayOccurrences.find(
            (occ): occ is ExternalPlanSessionOccurrence =>
                isExternalPlanOccurrence(occ)
                && occ.externalPlanRef.planId === externalPlanRef.planId
                && occ.externalPlanRef.sessionId === externalPlanRef.sessionId
                && occ.occurrenceId !== deterministicId
                && occ.state === 'scheduled',
        );
        const priorRef = priorRevision ? this.occurrenceRef(userId, priorRevision.occurrenceId) : null;

        let result: SessionOccurrence | null = null;
        await runTransaction(this.db, async transaction => {
            // -- every read before any write (Firestore transaction requirement) --
            const snap = await transaction.get(ref);
            const priorSnap = priorRef ? await transaction.get(priorRef) : null;
            const reservationSnap = windowReservationRef ? await transaction.get(windowReservationRef) : null;

            if (snap.exists()) {
                const parsed = parseSessionOccurrenceDocument(snap.data(), ref.path);
                if (parsed.status !== 'AVAILABLE') {
                    throw new Error(`External plan occurrence ${deterministicId} exists but could not be parsed (${parsed.status}).`);
                }
                result = parsed.data;
                return;
            }

            if (reservationSnap?.exists()) {
                const owner = reservationSnap.data()?.occurrenceId as string | undefined;
                if (owner !== priorRevision?.occurrenceId) {
                    throw new Error(
                        `Window '${options.windowBinding!.windowId}' on ${date} is already bound to occurrence '${owner}'.`,
                    );
                }
            }

            let priorWindowIdToRelease: string | undefined;
            if (priorRef && priorSnap?.exists()) {
                const parsedPrior = parseSessionOccurrenceDocument(priorSnap.data(), priorRef.path);
                if (parsedPrior.status === 'AVAILABLE' && parsedPrior.data.state === 'scheduled') {
                    transaction.set(priorRef, { ...parsedPrior.data, state: 'superseded', updatedAt: now });
                    const priorWindowId = isExternalPlanOccurrence(parsedPrior.data)
                        ? parsedPrior.data.windowBinding?.windowId
                        : undefined;
                    if (priorWindowId && priorWindowId !== options.windowBinding?.windowId) {
                        priorWindowIdToRelease = priorWindowId;
                    }
                }
            }
            if (priorWindowIdToRelease) {
                transaction.delete(this.windowReservationRef(userId, date, priorWindowIdToRelease));
            }

            const occurrence: ExternalPlanSessionOccurrence = {
                userId,
                occurrenceId: deterministicId,
                date,
                authority: 'external_plan',
                externalPlanRef,
                state: 'scheduled',
                ...(options.placementOrder !== undefined ? { placementOrder: options.placementOrder } : {}),
                ...(options.windowBinding !== undefined ? { windowBinding: options.windowBinding } : {}),
                createdAt: now,
                updatedAt: now,
            };
            transaction.set(ref, occurrence);

            if (windowReservationRef && options.windowBinding) {
                transaction.set(windowReservationRef, {
                    userId,
                    date,
                    windowId: options.windowBinding.windowId,
                    occurrenceId: deterministicId,
                    createdAt: now,
                });
            }

            result = occurrence;
        });
        return result!;
    }

    /** The occurrence, if any, currently claiming to replace `date`'s recommendation.
     * Superseded/abandoned/completed/missed occurrences never govern a live decision --
     * only `scheduled`/`active` do. Single-athlete simplification: if more than one
     * `replace_recommendation` occurrence is somehow active for the same date, fail closed
     * rather than granting authority by query order (ADR-0023 D-MAUTH). */
    async getReplaceOccurrenceForDate(userId: string, date: string): Promise<SessionOccurrence | null> {
        const occurrences = await this.getOccurrencesForDate(userId, date);
        const active = occurrences.filter(item => item.authority === 'replace_recommendation' && ACTIVE_OCCURRENCE_STATES.has(item.state));
        if (active.length > 1) {
            throw new Error(`Multiple active replace_recommendation occurrences exist for ${date}; authority is ambiguous.`);
        }
        return active[0] ?? null;
    }

    /** Every occurrence currently adding to (not replacing) `date`'s recommendation. */
    async getAdditionalOccurrencesForDate(userId: string, date: string): Promise<SessionOccurrence[]> {
        const occurrences = await this.getOccurrencesForDate(userId, date);
        return occurrences.filter(item => item.authority === 'additional_session' && ACTIVE_OCCURRENCE_STATES.has(item.state));
    }

    /**
     * Every external-plan occurrence on `date`, ordered by `placementOrder` (the bundle's
     * `intraday.order`) then `occurrenceId` for a deterministic tie-break. `superseded` and
     * `skipped` are excluded (see `BUNDLE_QUERY_EXCLUDED_STATES`) -- unlike
     * `getAdditionalOccurrencesForDate`, every other state is included, because callers
     * need `completed`/`abandoned` history too: predecessor-completion checks (D-REASSESS)
     * and the reject-against-an-existing-occurrence branch (plan step 8) both read states
     * this filter would otherwise hide.
     */
    async getExternalPlanOccurrencesForDate(userId: string, date: string): Promise<ExternalPlanSessionOccurrence[]> {
        const occurrences = await this.getOccurrencesForDate(userId, date);
        return occurrences
            .filter(isExternalPlanOccurrence)
            .filter(item => !BUNDLE_QUERY_EXCLUDED_STATES.has(item.state))
            .sort((a, b) =>
                (a.placementOrder ?? 0) - (b.placementOrder ?? 0)
                || a.occurrenceId.localeCompare(b.occurrenceId));
    }

    /**
     * ADR-0036 (H4) D-REASSESS: atomically claim a scheduled occurrence for launch.
     * Prevents duplicate/concurrent requests from launching the same occurrence twice
     * or claiming an occurrence that has already transitioned to active/terminal.
     */
    async claimOccurrenceLaunch(
        userId: string,
        occurrenceId: string,
        nowOrOptions?: string | ClaimOccurrenceLaunchOptions,
    ): Promise<SessionOccurrence> {
        const options: ClaimOccurrenceLaunchOptions =
            typeof nowOrOptions === 'string'
                ? { now: nowOrOptions }
                : (nowOrOptions ?? {});
        const now = options.now ?? new Date().toISOString();
        const ref = this.occurrenceRef(userId, occurrenceId);
        let transitioned: SessionOccurrence | null = null;
        await runTransaction(this.db, async transaction => {
            const snap = await transaction.get(ref);
            if (!snap.exists()) {
                throw new Error(`Occurrence ${occurrenceId} not found.`);
            }
            const parsed = parseSessionOccurrenceDocument(snap.data(), ref.path);
            if (parsed.status !== 'AVAILABLE') {
                throw new Error(`Occurrence ${occurrenceId} could not be parsed (${parsed.status}).`);
            }
            const current = parsed.data;
            if (current.state !== 'scheduled') {
                throw new Error(`Occurrence ${occurrenceId} cannot be claimed; state is '${current.state}', expected 'scheduled'.`);
            }
            if (options.onBeforeClaim) {
                await options.onBeforeClaim(transaction, {
                    ...current,
                    ...(current.definitionRef ? { definitionRef: { ...current.definitionRef } } : {}),
                    ...(current.externalPlanRef ? { externalPlanRef: { ...current.externalPlanRef } } : {}),
                } as SessionOccurrence);
            }
            transitioned = {
                ...current,
                state: 'active',
                updatedAt: now,
            } as SessionOccurrence;
            transaction.set(ref, transitioned);
        });
        return transitioned!;
    }

    /**
     * Transitions an occurrence state across its lifecycle (e.g. scheduled -> completed, active -> completed, active -> abandoned, scheduled -> skipped).
     * Prevents invalid transitions using the explicit occurrence lifecycle table.
     */
    async transitionOccurrenceState(
        userId: string,
        occurrenceId: string,
        nextState: OccurrenceState,
        now = new Date().toISOString(),
    ): Promise<SessionOccurrence> {
        const ref = this.occurrenceRef(userId, occurrenceId);
        let transitioned: SessionOccurrence | null = null;
        await runTransaction(this.db, async transaction => {
            const snap = await transaction.get(ref);
            if (!snap.exists()) {
                throw new Error(`Occurrence ${occurrenceId} not found.`);
            }
            const parsed = parseSessionOccurrenceDocument(snap.data(), ref.path);
            if (parsed.status !== 'AVAILABLE') {
                throw new Error(`Occurrence ${occurrenceId} could not be parsed (${parsed.status}).`);
            }
            const current = parsed.data;
            if (current.state === nextState) {
                transitioned = current;
                return;
            }
            if (!isValidOccurrenceTransition(current.state, nextState)) {
                throw new Error(
                    `Cannot transition occurrence ${occurrenceId} from '${current.state}' to '${nextState}'.`,
                );
            }
            transitioned = {
                ...current,
                state: nextState,
                updatedAt: now,
            } as SessionOccurrence;
            transaction.set(ref, transitioned);
        });
        return transitioned!;
    }
}

export const sessionOccurrenceService = new SessionOccurrenceService();
