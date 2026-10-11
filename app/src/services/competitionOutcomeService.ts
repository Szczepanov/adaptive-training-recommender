import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { CompetitionOutcome } from '../observations/models';
import { assertValidCompetitionOutcome } from '../observations/validation';

/** Ecological competition evidence stays separate from protocol-locked benchmark series. */
export class CompetitionOutcomeService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private outcomeRef(userId: string, outcomeId: string) {
        return doc(this.db, 'users', userId, 'competition_outcomes', outcomeId);
    }

    async createOutcome(userId: string, outcome: CompetitionOutcome): Promise<CompetitionOutcome> {
        assertValidCompetitionOutcome(outcome);
        const ref = this.outcomeRef(userId, outcome.id);
        await runTransaction(this.db, async (transaction) => {
            const existing = await transaction.get(ref);
            if (existing.exists()) throw new Error(`Competition outcome ${outcome.id} already exists`);
            transaction.set(ref, outcome);
        });
        return outcome;
    }

    async getOutcome(userId: string, outcomeId: string): Promise<CompetitionOutcome | null> {
        const snapshot = await getDoc(this.outcomeRef(userId, outcomeId));
        if (!snapshot.exists()) return null;
        const outcome = snapshot.data() as CompetitionOutcome;
        assertValidCompetitionOutcome(outcome);
        if (outcome.id !== outcomeId) throw new Error(`Competition outcome path mismatch for ${outcomeId}`);
        return outcome;
    }

    /** ID-ordered bounded ecological evidence sample, with a truncation sentinel. */
    async listOutcomesWithDiagnostics(userId: string, maxRecords = 100): Promise<{
        outcomes: CompetitionOutcome[]; unreadableCount: number; truncated: boolean;
    }> {
        if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords >= Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid maxRecords');
        const snapshot = await getDocs(query(collection(this.db, 'users', userId, 'competition_outcomes'),
            orderBy(documentId(), 'asc'), limit(maxRecords + 1)));
        const outcomes: CompetitionOutcome[] = [];
        let unreadableCount = 0;
        for (const item of snapshot.docs.slice(0, maxRecords)) {
            try {
                const outcome = item.data() as CompetitionOutcome;
                assertValidCompetitionOutcome(outcome);
                if (outcome.id !== item.id) throw new Error('Competition outcome path mismatch');
                outcomes.push(outcome);
            } catch { unreadableCount++; }
        }
        return { outcomes, unreadableCount, truncated: snapshot.docs.length > maxRecords };
    }
}

export const competitionOutcomeService = new CompetitionOutcomeService();
