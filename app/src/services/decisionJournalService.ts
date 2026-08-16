import { doc, getDoc, setDoc, deleteField, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DecisionJournalEntry, ShadowVerdict } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { validateDecisionJournalEntry } from '../engine/validation';
import { parseDecisionJournalEntry } from '../persistence/parsers/decisionInputs';
import { isPermissionDeniedError } from '../utils/errors';

export interface DecisionJournalRangeResult {
    entries: DecisionJournalEntry[];
    /** Invalid persisted records are omitted from the rows but counted explicitly so the
     * shadow readout cannot mistake malformed evidence for a genuinely missing day. */
    invalidRecords: number;
}

/**
 * Storage for `users/{userId}/decision_journal/{date}` (Phase 9.0). This is the athlete's
 * own verdict, recorded to be *compared against* the engine's `daily_recommendations/{date}`
 * verdict -- never a second input to it. `engine/externalArchitecture.test.ts` enforces
 * that no module reachable from `rules.ts`, `optimizer.ts`, `planner.ts` or
 * `trainingIntent.ts` can import this file.
 *
 * Journal evidence is append-only at the day level: the morning observation cannot be
 * edited or deleted after creation, and only the evening actual outcome may be updated.
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
     * `sawEngineVerdictFirst` from observed interaction (9.0.3's UI ordering).
     *
     * This is deliberately CREATE-ONLY. Once the athlete records a blind verdict, the app
     * reveals its own recommendation. Allowing the morning verdict or note to be edited
     * after that reveal while keeping `sawEngineVerdictFirst === false` would manufacture
     * apparently-unanchored evidence. Corrections therefore belong in the evening
     * `actualVerdict`, not in a rewritten morning observation.
     */
    async recordMorningEntry(
        userId: string,
        date: string,
        input: { externalVerdict: ShadowVerdict; externalNote?: string | null; sawEngineVerdictFirst: boolean },
    ): Promise<DecisionJournalEntry> {
        const existingState = await this.getEntryState(userId, date);
        if (existingState.status === 'UNAVAILABLE') {
            throw new Error("Could not confirm whether today's entry already exists; please try again");
        }
        if (existingState.status === 'INVALID') {
            throw new Error("Today's stored decision journal entry is invalid; it must be repaired before recording new evidence");
        }
        if (existingState.status === 'AVAILABLE') {
            throw new Error(`The morning verdict for ${date} is already recorded and cannot be rewritten after the engine may have been revealed`);
        }
        const externalNote = input.externalNote?.trim() || undefined;
        if (externalNote && externalNote.length > 2000) {
            throw new Error('Validation failed: externalNote must be 2000 characters or fewer');
        }
        const now = new Date().toISOString();
        const raw: Record<string, unknown> = {
            userId,
            date,
            externalVerdict: input.externalVerdict,
            ...(externalNote ? { externalNote } : {}),
            sawEngineVerdictFirst: input.sawEngineVerdictFirst,
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1,
        };
        return this.write(userId, date, raw);
    }

    /**
     * Evening write: records or updates what the athlete actually did, in the same
     * five-value vocabulary. Requires a valid morning entry to already exist -- an
     * evening-only record with no external verdict is not a valid shadow-mode day.
     */
    async recordActualVerdict(userId: string, date: string, actualVerdict: ShadowVerdict): Promise<DecisionJournalEntry> {
        const existingState = await this.getEntryState(userId, date);
        if (existingState.status === 'UNAVAILABLE') {
            throw new Error("Could not confirm today's entry; please try again");
        }
        if (existingState.status === 'INVALID') {
            throw new Error("Today's stored decision journal entry is invalid; it must be repaired before recording actual outcome");
        }
        if (existingState.status !== 'AVAILABLE') {
            throw new Error(`No decision journal entry exists for ${date}; record the morning verdict first`);
        }
        const raw: Record<string, unknown> = { ...existingState.data, actualVerdict, updatedAt: new Date().toISOString() };
        return this.write(userId, date, raw);
    }

    private async write(userId: string, date: string, raw: Record<string, unknown>): Promise<DecisionJournalEntry> {
        const validation = validateDecisionJournalEntry(raw);
        if (!validation.isValid) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
        }
        const validated = validation.data!;

        // merge: true leaves an omitted key untouched rather than clearing it. The create
        // path has no prior document, while evening updates start from the full parsed
        // morning entry. Keep the defensive deletes for malformed legacy/repair callers.
        const payload: Record<string, unknown> = { ...validated };
        if (!('externalNote' in validated)) payload.externalNote = deleteField();
        if (!('actualVerdict' in validated)) payload.actualVerdict = deleteField();

        const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
        await setDoc(docRef, payload, { merge: true });
        return validated;
    }

    /** Used by the 9.0.5 export. Invalid or foreign-owned records never become neutral
     * rows, but their count is surfaced to the readout so omitted corruption is not
     * confused with a genuine missing journal day. */
    async getEntriesInRange(userId: string, startDate: string, endDate: string): Promise<DecisionJournalRangeResult> {
        const collRef = collection(getDb(), 'users', userId, this.collectionPath);
        const q = query(collRef, where('date', '>=', startDate), where('date', '<=', endDate), orderBy('date', 'asc'));
        const querySnapshot = await getDocs(q);
        const entries: DecisionJournalEntry[] = [];
        let invalidRecords = 0;
        for (const docSnap of querySnapshot.docs) {
            const state = parseDecisionJournalEntry(docSnap.data(), docSnap.ref.path, userId, docSnap.id);
            if (state.status === 'AVAILABLE') entries.push(state.data);
            else if (state.status === 'INVALID') invalidRecords += 1;
        }
        return { entries, invalidRecords };
    }
}

// Export singleton instance
export const decisionJournalService = new DecisionJournalService();
