import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, startAfter, where, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { CompetitionOutcome } from '../observations/models';
import { assertValidCompetitionOutcome } from '../observations/validation';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { ecologicalOutcomeMatchesEvaluation } from './blockOutcomeReportService';
import { getLocalDateString } from '../utils/localDate';

export const COMPETITION_OUTCOME_MAX_SCANNED_RECORDS = 200;

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

    /** D-EXPORT: bounded raw outcomes, independent of any engine/evaluation verdict. */
    async listForLedger(userId: string, startDate: string, endDate: string): Promise<{
        outcomes: CompetitionOutcome[]; unreadableCount: number; truncated: boolean;
    }> {
        // Stored instants can carry offsets: filter by Warsaw date after the bounded scan.
        const snapshot = await getDocs(query(collection(this.db, 'users', userId, 'competition_outcomes'),
            orderBy(documentId(), 'asc'), limit(COMPETITION_OUTCOME_MAX_SCANNED_RECORDS + 1)));
        const outcomes: CompetitionOutcome[] = [];
        let unreadableCount = 0;
        for (const item of snapshot.docs.slice(0, COMPETITION_OUTCOME_MAX_SCANNED_RECORDS)) {
            try {
                const outcome = item.data() as CompetitionOutcome;
                assertValidCompetitionOutcome(outcome);
                if (outcome.id !== item.id) throw new Error('Competition outcome path mismatch');
                const date = getLocalDateString(new Date(outcome.occurredAt));
                if (date >= startDate && date <= endDate) outcomes.push(outcome);
            } catch { unreadableCount++; }
        }
        return { outcomes, unreadableCount, truncated: snapshot.docs.length > COMPETITION_OUTCOME_MAX_SCANNED_RECORDS };
    }

    /** Scope before the result cap; legacy missing links and offset timestamps require a bounded scan. */
    async listOutcomesWithDiagnostics(userId: string, evaluation: OutcomeEvaluationSnapshot, asOfDate: string, maxRecords = 100): Promise<{
        outcomes: CompetitionOutcome[]; unreadableCount: number; truncated: boolean; scanLimitReached?: boolean;
    }> {
        if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords >= Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid maxRecords');
        const outcomes: CompetitionOutcome[] = [];
        let unreadableCount = 0;
        if (asOfDate < evaluation.revision.startDate) return { outcomes, unreadableCount, truncated: false };
        const event = evaluation.revision.sourceRef;
        let cursor: QueryDocumentSnapshot | undefined;
        let scanned = 0;
        while (scanned <= COMPETITION_OUTCOME_MAX_SCANNED_RECORDS) {
            const pageSize = Math.min(maxRecords + 1, COMPETITION_OUTCOME_MAX_SCANNED_RECORDS - scanned + 1);
            const snapshot = await getDocs(query(collection(this.db, 'users', userId, 'competition_outcomes'),
                ...(event?.kind === 'event' ? [where('eventRef', '==', event.id)] : []),
                orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(pageSize)));
            for (const item of snapshot.docs) {
                if (scanned === COMPETITION_OUTCOME_MAX_SCANNED_RECORDS) {
                    return { outcomes, unreadableCount, truncated: true, scanLimitReached: true };
                }
                scanned++;
                try {
                    const outcome = item.data() as CompetitionOutcome;
                    assertValidCompetitionOutcome(outcome);
                    if (outcome.id !== item.id) throw new Error('Competition outcome path mismatch');
                    if (!ecologicalOutcomeMatchesEvaluation(outcome, evaluation)
                        || getLocalDateString(new Date(outcome.occurredAt)) > asOfDate) continue;
                    if (outcomes.length === maxRecords) return { outcomes, unreadableCount, truncated: true };
                    outcomes.push(outcome);
                } catch { unreadableCount++; }
            }
            if (snapshot.docs.length < pageSize) return { outcomes, unreadableCount, truncated: false };
            cursor = snapshot.docs.at(-1);
        }
        return { outcomes, unreadableCount, truncated: true, scanLimitReached: true };
    }
}

export const competitionOutcomeService = new CompetitionOutcomeService();
