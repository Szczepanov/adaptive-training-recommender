import { doc, getDoc, setDoc, deleteDoc, deleteField, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DecisionJournalEntry, ShadowVerdict } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { validateDecisionJournalEntry } from '../engine/validation';
import { parseDecisionJournalEntry } from '../persistence/parsers/decisionInputs';
import { isPermissionDeniedError } from '../utils/errors';

/**
 * Storage for `users/{userId}/decision_journal/{date}` (Phase 9.0). This is the athlete's
 * own verdict, recorded to be *compared against* the engine's `daily_recommendations/{date}`
 * verdict -- never a second input to it. `engine/externalArchitecture.test.ts` enforces
 * that no module reachable from `rules.ts`, `optimizer.ts`, `planner.ts` or
 * `trainingIntent.ts` can import this file.
 */
export class DecisionJournalService {
    private readonly collectionPath = 'decision_journal';

    async getEntryState(userId: string, date: string): Promise<DataState<DecisionJournalEntry>> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return { status: 'MISSING' };
            return parseDecisionJournalEntry(docSnap.data(), `users/${userId}/${this.collectionPath}/${date}`, userId, date);
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read decision journal entry',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }

    async getEntry(userId: string, date: string): Promise<DecisionJournalEntry | null> {
        const state = await this.getEntryState(userId, date);
        return state.status === 'AVAILABLE' ? state.data : null;
    }

    /**
     * Morning write: records what the athlete's own planner said to do today, and locks
     * `sawEngineVerdictFirst` from observed interaction (9.0.3's UI ordering). Creates the
     * entry if absent. Calling this again the same day updates `externalVerdict` /
     * `externalNote` but never re-derives `sawEngineVerdictFirst` or `createdAt` -- both are
     * fixed at first write, mirroring the immutability `firestore.rules` enforces
     * server-side.
     */
    async recordMorningEntry(
        userId: string,
        date: string,
        input: { externalVerdict: ShadowVerdict; externalNote?: string | null; sawEngineVerdictFirst: boolean },
    ): Promise<DecisionJournalEntry> {
        const existing = await this.getEntry(userId, date);
        const now = new Date().toISOString();
        const raw: Record<string, unknown> = {
            userId,
            date,
            externalVerdict: input.externalVerdict,
            ...(input.externalNote ? { externalNote: input.externalNote } : {}),
            sawEngineVerdictFirst: existing ? existing.sawEngineVerdictFirst : input.sawEngineVerdictFirst,
            ...(existing?.actualVerdict ? { actualVerdict: existing.actualVerdict } : {}),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        return this.write(userId, date, raw);
    }

    /**
     * Evening write: records or updates what the athlete actually did, in the same
     * five-value vocabulary. Requires the morning entry to already exist -- an
     * evening-only record with no external verdict is not a valid shadow-mode day.
     */
    async recordActualVerdict(userId: string, date: string, actualVerdict: ShadowVerdict): Promise<DecisionJournalEntry> {
        const existing = await this.getEntry(userId, date);
        if (!existing) {
            throw new Error(`No decision journal entry exists for ${date}; record the morning verdict first`);
        }
        const raw: Record<string, unknown> = { ...existing, actualVerdict, updatedAt: new Date().toISOString() };
        return this.write(userId, date, raw);
    }

    private async write(userId: string, date: string, raw: Record<string, unknown>): Promise<DecisionJournalEntry> {
        const validation = validateDecisionJournalEntry(raw);
        if (!validation.isValid) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = validation.data!;

        // merge: true leaves an omitted key untouched rather than clearing it (same gotcha
        // checkinService.upsertCheckin documents for tissueResponses) -- explicitly delete
        // externalNote/actualVerdict when this write's own validated result doesn't carry
        // them, so an edit that removes a note or is genuinely morning-only doesn't leave a
        // stale value live in Firestore.
        const payload: Record<string, unknown> = { ...validated };
        if (!('externalNote' in validated)) payload.externalNote = deleteField();
        if (!('actualVerdict' in validated)) payload.actualVerdict = deleteField();

        const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
        await setDoc(docRef, payload, { merge: true });
        return validated;
    }

    async deleteEntry(userId: string, date: string): Promise<void> {
        const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
        await deleteDoc(docRef);
    }

    /** Used by the 9.0.5 export. Invalid or foreign-owned records are dropped rather than
     *  surfaced as a neutral entry -- see `parseDecisionJournalEntry`. */
    async getEntriesInRange(userId: string, startDate: string, endDate: string): Promise<DecisionJournalEntry[]> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('date', '>=', startDate), where('date', '<=', endDate), orderBy('date', 'asc'));
        const querySnapshot = await getDocs(q);
        const entries: DecisionJournalEntry[] = [];
        for (const docSnap of querySnapshot.docs) {
            const state = parseDecisionJournalEntry(docSnap.data(), docSnap.ref.path, userId, docSnap.id);
            if (state.status === 'AVAILABLE') entries.push(state.data);
        }
        return entries;
    }
}

// Export singleton instance
export const decisionJournalService = new DecisionJournalService();
