import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { ResponseWindow, SessionResponse, SessionResponseSourceRef } from '../responses/models';
import { parseSessionResponseDocument } from '../persistence/parsers/sessionResponse';

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

    private newResponseId(): string {
        return `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        return responses.sort((a, b) => a.window.localeCompare(b.window));
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
     * answered before. Callers must check `getResponseForWindow` first and call
     * `updateResponseFacts` instead when one already exists -- this never silently
     * overwrites an existing answer's `createdAt`/identity. */
    async recordResponse(
        userId: string,
        sourceSession: SessionResponseSourceRef,
        window: ResponseWindow,
        date: string,
        checkinDate: string,
        facts: Partial<Pick<SessionResponse, 'sessionRpe' | 'completedFraction' | 'unexpectedFatigue' | 'techniqueNote' | 'note'>>,
        occurrenceId?: string,
        now: string = new Date().toISOString(),
    ): Promise<SessionResponse> {
        const response: SessionResponse = {
            userId,
            responseId: this.newResponseId(),
            sourceSession,
            ...(occurrenceId ? { occurrenceId } : {}),
            window,
            date,
            checkinRef: { date: checkinDate },
            ...(facts.sessionRpe !== undefined ? { sessionRpe: facts.sessionRpe } : {}),
            ...(facts.completedFraction !== undefined ? { completedFraction: facts.completedFraction } : {}),
            ...(facts.unexpectedFatigue !== undefined ? { unexpectedFatigue: facts.unexpectedFatigue } : {}),
            ...(facts.techniqueNote !== undefined ? { techniqueNote: facts.techniqueNote } : {}),
            ...(facts.note !== undefined ? { note: facts.note } : {}),
            createdAt: now,
            updatedAt: now,
        };
        await setDoc(this.responseRef(userId, response.responseId), response);
        return response;
    }

    /** Revises the non-tissue facts on an existing response. `sourceSession`, `occurrenceId`,
     * `window`, `date` and `createdAt` are never part of the patch -- provenance (what this
     * response is *of*, and when it was first recorded) is preserved across every edit. */
    async updateResponseFacts(
        userId: string,
        responseId: string,
        patch: Partial<Pick<SessionResponse, 'sessionRpe' | 'completedFraction' | 'unexpectedFatigue' | 'techniqueNote' | 'note'>>,
        now: string = new Date().toISOString(),
    ): Promise<void> {
        await updateDoc(this.responseRef(userId, responseId), { ...patch, updatedAt: now });
    }
}

export const sessionResponseService = new SessionResponseService();
