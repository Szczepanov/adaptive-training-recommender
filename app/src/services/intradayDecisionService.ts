/**
 * ADR-0036 (H4) D-AUDIT: Intraday decision persistence and query service.
 *
 * Scoped to user subcollection `users/{userId}/intraday_decisions/{decisionId}`.
 * Write-once append-only semantics: each record is immutable once written;
 * updates/reassessments create new records with `supersededDecisionId` pointing
 * to previous records.
 */

import { collection, doc, getDoc, getDocs, query, setDoc, where, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import {
    validateIntradayDecisionRecord,
    type IntradayDecisionRecord,
    type ReassessmentInputRevision,
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
    if (validated.supersededDecisionId) {
        const prior = await getIntradayDecision(validated.userId, validated.supersededDecisionId);
        if (prior && prior.occurrenceId !== validated.occurrenceId) {
            throw new Error(
                `Invalid supersession: decision ${validated.id} for occurrence ${validated.occurrenceId} cannot supersede decision ${validated.supersededDecisionId} for occurrence ${prior.occurrenceId}`
            );
        }
    }
    const db = getDb();
    const docRef = doc(db, getIntradayDecisionDocPath(validated.userId, validated.id));
    await setDoc(docRef, validated);
}

/**
 * H4 (#434) PR 3 step 9: deterministic id for a *provisional* decision, derived from the
 * occurrence it decides for and the exact input revision the verdict was computed
 * against. A deterministic id alone is not an idempotency rule -- see
 * `decisionRecordsMatch` and `writeProvisionalDecisionInTransaction` below, which define
 * what "the same decision" means on a retry after an ambiguous acknowledgement.
 */
export async function deterministicIntradayDecisionId(
    occurrenceId: string,
    reassessmentInputRevision: ReassessmentInputRevision,
): Promise<string> {
    const raw = JSON.stringify([occurrenceId, reassessmentInputRevision]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 24);
    return `dec_${occurrenceId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64)}_${hash}`;
}

/**
 * Whether two candidate decision records represent *the same decision* -- an ambiguous
 * retry should converge on this, not append a second record. Compares only the fields
 * the plan names as immutable identity: the target occurrence, the predecessor identity,
 * the verdict, and the input revision it was computed against. Two decisions differing
 * only in which predecessor they depend on are different decisions -- omitting
 * `predecessorOccurrenceId`/`predecessorExecutionId` here would accept one as an
 * idempotent retry of the other.
 */
export function decisionRecordsMatch(a: IntradayDecisionRecord, b: IntradayDecisionRecord): boolean {
    return a.occurrenceId === b.occurrenceId
        && a.predecessorOccurrenceId === b.predecessorOccurrenceId
        && a.predecessorExecutionId === b.predecessorExecutionId
        && a.verdict.decision === b.verdict.decision
        && JSON.stringify(a.reassessmentInputRevision) === JSON.stringify(b.reassessmentInputRevision);
}

/**
 * Writes a provisional decision record inside a caller-supplied transaction, so it can
 * commit atomically with whatever occurrence/aggregate write the decision authorizes
 * (plan step 9: "steps 8 and 9 must not be able to half-succeed"). `existing` must already
 * have been read via `transaction.get` in the same transaction (Firestore's
 * reads-before-writes rule), typically alongside the occurrence/aggregate reads the same
 * transaction needs.
 *
 * - Absent: creates the record and returns it.
 * - Present and matching (`decisionRecordsMatch`): the first attempt already committed --
 *   an ambiguous-acknowledgement retry converges on it without writing again.
 * - Present and *not* matching: a different decision is colliding on this deterministic
 *   id, not a retry of this one. Throws rather than silently overwriting an append-only
 *   audit record -- a silent overwrite would break the replay guarantee the store exists
 *   for.
 */
export function writeProvisionalDecisionInTransaction(
    transaction: Transaction,
    userId: string,
    existing: IntradayDecisionRecord | null,
    record: IntradayDecisionRecord,
): IntradayDecisionRecord {
    const validated = validateIntradayDecisionRecord(record);
    if (existing) {
        if (!decisionRecordsMatch(existing, validated)) {
            throw new Error(
                `Decision id ${validated.id} already holds a different decision for occurrence ${existing.occurrenceId}; refusing to overwrite an append-only record.`,
            );
        }
        return existing;
    }
    transaction.set(doc(getDb(), getIntradayDecisionDocPath(userId, validated.id)), validated);
    return validated;
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
 * Filters out records whose ID is referenced as `supersededDecisionId` by any other record
 * belonging to the same occurrence.
 */
export async function getActiveIntradayDecisionsForDate(userId: string, date: string): Promise<IntradayDecisionRecord[]> {
    const allRecords = await listIntradayDecisionsForDate(userId, date);
    if (allRecords.length === 0) return [];

    const recordById = new Map<string, IntradayDecisionRecord>(allRecords.map(r => [r.id, r]));
    const supersededIds = new Set<string>();
    for (const r of allRecords) {
        if (r.supersededDecisionId) {
            const target = recordById.get(r.supersededDecisionId);
            if (target && target.occurrenceId === r.occurrenceId) {
                supersededIds.add(r.supersededDecisionId);
            }
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
