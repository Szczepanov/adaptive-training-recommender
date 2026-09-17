import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
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
}

export const competitionOutcomeService = new CompetitionOutcomeService();
