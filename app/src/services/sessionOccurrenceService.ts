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
    type WriteBatch,
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
} from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';

/** ACTIVE_OCCURRENCE_STATES excludes terminal/superseded states from "what governs today". */
const ACTIVE_OCCURRENCE_STATES: ReadonlySet<SessionOccurrence['state']> = new Set(['scheduled', 'active']);

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
 */
export async function deterministicExternalPlanOccurrenceId(
    date: string,
    ref: ExternalPlanOccurrenceRef,
): Promise<string> {
    const raw = JSON.stringify([
        date,
        ref.planId,
        ref.sessionId,
        ref.revision,
        ref.contentHash,
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 24);
    return `ext_${date}_${hash}`;
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
     * Idempotently retrieves an existing external-plan occurrence for (userId, date, planId, sessionId, revision, contentHash),
     * or schedules a new one with a deterministic occurrenceId if not yet present.
     * Transactionally reads and creates to prevent concurrent double-creations and permission errors on Firestore updates.
     */
    async getOrCreateExternalPlanOccurrence(
        userId: string,
        date: string,
        externalPlanRef: ExternalPlanOccurrenceRef,
        placementOrder?: number,
        now = new Date().toISOString(),
    ): Promise<SessionOccurrence> {
        const deterministicId = await deterministicExternalPlanOccurrenceId(date, externalPlanRef);
        const ref = this.occurrenceRef(userId, deterministicId);
        let result: SessionOccurrence | null = null;
        await runTransaction(this.db, async transaction => {
            const snap = await transaction.get(ref);
            if (snap.exists()) {
                const parsed = parseSessionOccurrenceDocument(snap.data(), ref.path);
                if (parsed.status !== 'AVAILABLE') {
                    throw new Error(`External plan occurrence ${deterministicId} exists but could not be parsed (${parsed.status}).`);
                }
                result = parsed.data;
                return;
            }
            const occurrence: ExternalPlanSessionOccurrence = {
                userId,
                occurrenceId: deterministicId,
                date,
                authority: 'external_plan',
                externalPlanRef,
                state: 'scheduled',
                ...(placementOrder !== undefined ? { placementOrder } : {}),
                createdAt: now,
                updatedAt: now,
            };
            transaction.set(ref, occurrence);
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

    /**
     * Reads the occurrence document, validates the state transition, and queues the state update
     * into the caller's WriteBatch so that occurrence and execution updates commit atomically.
     */
    async queueOccurrenceTransition(
        userId: string,
        occurrenceId: string,
        nextState: OccurrenceState,
        batch: WriteBatch,
        now = new Date().toISOString(),
    ): Promise<SessionOccurrence> {
        const ref = this.occurrenceRef(userId, occurrenceId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            throw new Error(`Occurrence ${occurrenceId} not found.`);
        }
        const parsed = parseSessionOccurrenceDocument(snap.data(), ref.path);
        if (parsed.status !== 'AVAILABLE') {
            throw new Error(`Occurrence ${occurrenceId} could not be parsed (${parsed.status}).`);
        }
        const current = parsed.data;
        if (current.state === nextState) {
            return current;
        }
        if (!isValidOccurrenceTransition(current.state, nextState)) {
            throw new Error(
                `Cannot transition occurrence ${occurrenceId} from '${current.state}' to '${nextState}'.`,
            );
        }
        const transitioned: SessionOccurrence = {
            ...current,
            state: nextState,
            updatedAt: now,
        } as SessionOccurrence;
        batch.set(ref, transitioned);
        return transitioned;
    }
}

export const sessionOccurrenceService = new SessionOccurrenceService();
