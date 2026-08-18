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
import type { SessionOccurrence } from '../sessions/models';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';

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
        return occurrences.sort((a, b) => (a.placementOrder ?? 0) - (b.placementOrder ?? 0));
    }
}

export const sessionOccurrenceService = new SessionOccurrenceService();
