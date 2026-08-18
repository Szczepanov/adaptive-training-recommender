import {
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { OccurrenceAuthority, SessionOccurrence } from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';

/** ACTIVE_OCCURRENCE_STATES excludes terminal/superseded states from "what governs today". */
const ACTIVE_OCCURRENCE_STATES: ReadonlySet<SessionOccurrence['state']> = new Set(['scheduled', 'active']);

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
        authority: OccurrenceAuthority,
        definitionRef: SessionOccurrence['definitionRef'],
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
        definitionRef: SessionOccurrence['definitionRef'],
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'schedule', definitionRef);
    }

    /** Persists a request to replace the engine's pick for `date`. Until the gated M3.3
     * composition path exists, creating this occurrence does not change a recommendation. */
    async replaceRecommendationOccurrence(
        userId: string,
        date: string,
        definitionRef: SessionOccurrence['definitionRef'],
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'replace_recommendation', definitionRef);
    }

    /** Persists a request to add a session on `date`. `placementOrder` disambiguates multiple
     * additions; a separate gated composition path must attach them to a recommendation. */
    async addAdditionalSessionOccurrence(
        userId: string,
        date: string,
        definitionRef: SessionOccurrence['definitionRef'],
        placementOrder?: number,
    ): Promise<SessionOccurrence> {
        return this.createOccurrence(userId, date, 'additional_session', definitionRef, placementOrder);
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
}

export const sessionOccurrenceService = new SessionOccurrenceService();
