import {
    doc,
    getDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { ResponseWindow, SessionResponse, SessionResponseSourceRef } from '../responses/models';
import { parseSessionResponseDocument } from '../persistence/parsers/sessionResponse';

// Explicit chronological order -- not left to `ResponseWindow` values sorting correctly by
// coincidence (they currently do, alphabetically, but nothing enforces that: a future added
// or renamed window would silently break an localeCompare-based sort with no test to catch it).
const RESPONSE_WINDOW_ORDER: Record<ResponseWindow, number> = { immediate: 0, later_day: 1, next_morning: 2 };

type ResponseFacts = Partial<Pick<SessionResponse, 'sessionRpe' | 'completedFraction' | 'unexpectedFatigue' | 'techniqueNote' | 'note'>>;

function definedResponseFacts(facts: ResponseFacts): ResponseFacts {
    return Object.fromEntries(
        Object.entries(facts).filter(([, value]) => value !== undefined),
    );
}

/**
 * The same deterministic id `SessionResponseService` writes under, exposed because H4's
 * launch claim (`intradayLaunchClaim.ts`) must read the predecessor's `immediate` response
 * *inside* a Firestore transaction, and `Transaction.get` takes a `DocumentReference` -- it
 * cannot run the `getResponsesForSource` query the service's own readers use. Exported here
 * rather than restated at the call site so the two can never drift apart.
 */
export function sessionResponseDocId(
    sourceSession: Pick<SessionResponseSourceRef, 'kind' | 'id'>,
    window: ResponseWindow,
): string {
    return `resp-${sourceSession.kind}-${encodeURIComponent(sourceSession.id)}-${window}`;
}

/**
 * M5.1: user-scoped persistence for `SessionResponse` records. Per D-MRESP, this service
 * never writes a tissue value -- only linkage and the non-tissue session facts
 * (`responses/models.ts`'s doc comment). No record is ever fabricated here for a prompt the
 * athlete never answered; a missing `(sourceSession, window)` pair simply has no document,
 * which callers (M5.2's follow-up schedule, M5.3's outcome report) read as `unknown`.
 */
export class SessionResponseService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private responseRef(userId: string, responseId: string) {
        return doc(this.db, 'users', userId, 'session_responses', responseId);
    }

    /** Deterministic, not random: a `(sourceSession, window)` pair has at most one answer
     * (D-MRESP), so the id doubles as an idempotency key. Creation uses a transaction so two
     * concurrent callers cannot both observe a missing document and overwrite one another. */
    private responseIdFor(sourceSession: SessionResponseSourceRef, window: ResponseWindow): string {
        return sessionResponseDocId(sourceSession, window);
    }

    private buildResponse(
        userId: string,
        responseId: string,
        sourceSession: SessionResponseSourceRef,
        window: ResponseWindow,
        date: string,
        checkinDate: string,
        facts: ResponseFacts,
        occurrenceId: string | undefined,
        now: string,
    ): SessionResponse {
        return {
            userId,
            responseId,
            sourceSession,
            ...(occurrenceId ? { occurrenceId } : {}),
            window,
            date,
            checkinRef: { date: checkinDate },
            ...definedResponseFacts(facts),
            createdAt: now,
            updatedAt: now,
        };
    }

    async getResponse(userId: string, responseId: string): Promise<DataState<SessionResponse>> {
        const path = `users/${userId}/session_responses/${responseId}`;
        try {
            const snap = await getDoc(this.responseRef(userId, responseId));
            return parseSessionResponseDocument(snap.exists() ? snap.data() : undefined, path);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getResponse', retryable: true };
        }
    }

    /** Every response recorded so far for one source session, across all windows -- the
     * caller can tell "answered" from "never asked/answered" per window by which of
     * `immediate`/`later_day`/`next_morning` actually appears here. A single-field query
     * (`sourceSession.id`) plus a client-side `kind` filter avoids requiring a composite
     * index for what is, per user, a small bounded collection. */
    async getResponsesForSource(userId: string, source: Pick<SessionResponseSourceRef, 'kind' | 'id'>): Promise<SessionResponse[]> {
        const coll = collection(this.db, 'users', userId, 'session_responses');
        const q = query(coll, where('sourceSession.id', '==', source.id));
        const snap = await getDocs(q);
        const responses: SessionResponse[] = [];
        for (const docSnap of snap.docs) {
            const parsed = parseSessionResponseDocument(docSnap.data(), docSnap.ref.path);
            if (parsed.status === 'AVAILABLE' && parsed.data.sourceSession.kind === source.kind) {
                responses.push(parsed.data);
            }
        }
        return responses.sort((a, b) => RESPONSE_WINDOW_ORDER[a.window] - RESPONSE_WINDOW_ORDER[b.window]);
    }

    /** The response for one specific window, if the athlete ever answered it -- `null`
     * (never fabricated) if not. Distinguishing "missing" from "answered normal" is the
     * whole point (D-MRESP); callers must not default this to a passing value. */
    async getResponseForWindow(
        userId: string,
        source: Pick<SessionResponseSourceRef, 'kind' | 'id'>,
        window: ResponseWindow,
    ): Promise<SessionResponse | null> {
        const responses = await this.getResponsesForSource(userId, source);
        return responses.find(response => response.window === window) ?? null;
    }

    /** Creates a new response for a `(sourceSession, window)` pair that has never been
     * answered before. The deterministic document is read and created in one transaction,
     * so a concurrent second create retries against the committed first write and rejects
     * instead of overwriting its `createdAt`/facts. */
    async recordResponse(
        userId: string,
        sourceSession: SessionResponseSourceRef,
        window: ResponseWindow,
        date: string,
        checkinDate: string,
        facts: ResponseFacts,
        occurrenceId?: string,
        now: string = new Date().toISOString(),
    ): Promise<SessionResponse> {
        const responseId = this.responseIdFor(sourceSession, window);
        const responseRef = this.responseRef(userId, responseId);
        const response = this.buildResponse(
            userId,
            responseId,
            sourceSession,
            window,
            date,
            checkinDate,
            facts,
            occurrenceId,
            now,
        );

        return runTransaction(this.db, async transaction => {
            const existing = await transaction.get(responseRef);
            if (existing.exists()) {
                throw new Error(`A response already exists for this session's ${window} window; call updateResponseFacts instead.`);
            }
            transaction.set(responseRef, response);
            return response;
        });
    }

    /** Revises the non-tissue facts on an existing response. `sourceSession`, `occurrenceId`,
     * `window`, `date` and `createdAt` are never part of the patch -- provenance (what this
     * response is *of*, and when it was first recorded) is preserved across every edit. */
    async updateResponseFacts(
        userId: string,
        responseId: string,
        patch: ResponseFacts,
        now: string = new Date().toISOString(),
    ): Promise<void> {
        await updateDoc(this.responseRef(userId, responseId), { ...definedResponseFacts(patch), updatedAt: now });
    }

    /**
     * Records submitted completion evidence or revises the existing answer for the
     * deterministic `(sourceSession, window)` pair. An empty fact set is deliberately a
     * no-op: callers such as `completeSession()` may have no submitted completion payload,
     * and D-MRESP requires that absence to remain distinguishable from answered-normal.
     *
     * The query-first read preserves compatibility with any already-stored response found by
     * the canonical reader. If no answer exists, the final deterministic read/write happens
     * transactionally so concurrent retries cannot race into two blind `set` operations or
     * overwrite `createdAt`.
     */
    async recordOrUpdateResponse(
        userId: string,
        sourceSession: SessionResponseSourceRef,
        window: ResponseWindow,
        date: string,
        checkinDate: string,
        facts: ResponseFacts,
        occurrenceId?: string,
        now: string = new Date().toISOString(),
    ): Promise<void> {
        const definedFacts = definedResponseFacts(facts);
        if (Object.keys(definedFacts).length === 0) return;

        const existing = await this.getResponseForWindow(userId, sourceSession, window);
        if (existing) {
            await this.updateResponseFacts(userId, existing.responseId, definedFacts, now);
            return;
        }

        const responseId = this.responseIdFor(sourceSession, window);
        const responseRef = this.responseRef(userId, responseId);
        const response = this.buildResponse(
            userId,
            responseId,
            sourceSession,
            window,
            date,
            checkinDate,
            definedFacts,
            occurrenceId,
            now,
        );

        await runTransaction(this.db, async transaction => {
            const raced = await transaction.get(responseRef);
            if (raced.exists()) {
                transaction.update(responseRef, { ...definedFacts, updatedAt: now });
                return;
            }
            transaction.set(responseRef, response);
        });
    }
}

export const sessionResponseService = new SessionResponseService();
