/**
 * ADR-0036 (H4) D-AUDIT: Intraday decision persistence and query service.
 *
 * Scoped to user subcollection `users/{userId}/intraday_decisions/{decisionId}`.
 * Write-once append-only semantics: each record is immutable once written;
 * updates/reassessments create new records with `supersededDecisionId` pointing
 * to previous records.
 */

import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import {
    validateIntradayDecisionRecord,
    type IntradayDecisionRecord,
} from '../engine/intradayDecision';

export function getIntradayDecisionDocPath(userId: string, decisionId: string): string {
    return `users/${userId}/intraday_decisions/${decisionId}`;
}

export function getIntradayDecisionsCollectionPath(userId: string): string {
    return `users/${userId}/intraday_decisions`;
}

/**
 * Saves a validated intraday decision record write-once.
 */
export async function saveIntradayDecision(record: IntradayDecisionRecord): Promise<void> {
    const validated = validateIntradayDecisionRecord(record);
    const db = getDb();
    const docRef = doc(db, getIntradayDecisionDocPath(validated.userId, validated.id));
    await setDoc(docRef, validated);
}

/**
 * Retrieves an intraday decision record by ID, or null if not found.
 */
export async function getIntradayDecision(userId: string, decisionId: string): Promise<IntradayDecisionRecord | null> {
    const db = getDb();
    const docRef = doc(db, getIntradayDecisionDocPath(userId, decisionId));
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return validateIntradayDecisionRecord(snap.data());
}

/**
 * Lists all intraday decision records for a given date, ordered by evaluation time.
 */
export async function listIntradayDecisionsForDate(userId: string, date: string): Promise<IntradayDecisionRecord[]> {
    const db = getDb();
    const colRef = collection(db, getIntradayDecisionsCollectionPath(userId));
    const q = query(colRef, where('date', '==', date));
    const querySnap = await getDocs(q);

    const records: IntradayDecisionRecord[] = [];
    for (const docSnap of querySnap.docs) {
        records.push(validateIntradayDecisionRecord(docSnap.data()));
    }

    return records.sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/**
 * Resolves the active (non-superseded) decision records for a given date.
 * Filters out records whose ID is referenced as `supersededDecisionId` by any other record.
 */
export async function getActiveIntradayDecisionsForDate(userId: string, date: string): Promise<IntradayDecisionRecord[]> {
    const allRecords = await listIntradayDecisionsForDate(userId, date);
    if (allRecords.length === 0) return [];

    const supersededIds = new Set<string>();
    for (const r of allRecords) {
        if (r.supersededDecisionId) {
            supersededIds.add(r.supersededDecisionId);
        }
    }

    return allRecords.filter(r => !supersededIds.has(r.id) && r.status !== 'superseded');
}

/**
 * Resolves the active intraday decision record for a specific occurrence on a date, if any.
 */
export async function getActiveIntradayDecisionForOccurrence(
    userId: string,
    date: string,
    occurrenceId: string,
): Promise<IntradayDecisionRecord | null> {
    const active = await getActiveIntradayDecisionsForDate(userId, date);
    return active.find(r => r.occurrenceId === occurrenceId) ?? null;
}
