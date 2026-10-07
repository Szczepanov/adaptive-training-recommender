import { doc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ManualOccurrenceRef, SessionOccurrence } from '../sessions/models';
import { isExternalPlanOccurrence, isManualOccurrence } from '../sessions/models';
import type { DailyRecommendation } from '../engine/models';
import { parseDailyRecommendation } from '../persistence/parsers/trainingHistory';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import { windowReservationId } from './sessionOccurrenceService';
import { deepEqual } from '../utils/deepEqual';

/**
 * Schedules replacement intent, then transfers authority only when its adjudicated
 * recommendation is committed. The recommendation binding is the only source of truth for
 * which prepared occurrence is being displaced: same-day occurrence scans and title matching
 * are intentionally forbidden because intraday plans may contain multiple legitimate sessions.
 */
export class ManualRecommendationReplacementService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    async replaceRecommendationOccurrence(
        userId: string,
        date: string,
        definitionRef: ManualOccurrenceRef,
        now = new Date().toISOString(),
    ): Promise<SessionOccurrence> {
        const occurrenceId = `occ-${Date.now()}-${crypto.randomUUID()}`;
        const replacement: SessionOccurrence = {
            userId,
            occurrenceId,
            date,
            authority: 'replace_recommendation',
            definitionRef,
            state: 'scheduled',
            createdAt: now,
            updatedAt: now,
        };
        const recommendationRef = doc(this.db, 'users', userId, 'daily_recommendations', date);
        const replacementRef = doc(this.db, 'users', userId, 'session_occurrences', occurrenceId);

        await runTransaction(this.db, async transaction => {
            const recommendationSnap = await transaction.get(recommendationRef);

            if (recommendationSnap.exists()) {
                const parsedRecommendation = parseDailyRecommendation(
                    recommendationSnap.data(),
                    recommendationRef.path,
                );
                if (parsedRecommendation.status !== 'AVAILABLE') {
                    throw new Error(
                        `Today's recommendation cannot be used for replacement (${parsedRecommendation.status}).`,
                    );
                }
                await this.readPreparedPrimary(transaction, userId, date, parsedRecommendation.data.primarySession?.occurrenceId);
            }
            transaction.set(replacementRef, replacement);
        });

        return replacement;
    }

    /** Called before any recommendation/archive writes in the same transaction. */
    async transferAuthorityInTransaction(
        transaction: Transaction,
        userId: string,
        date: string,
        prior: DailyRecommendation | undefined,
        accepted: DailyRecommendation,
    ): Promise<void> {
        const claim = accepted.recommendationAudit?.authoredOccurrence;
        const binding = accepted.primarySession;
        if (!claim || !['proceed', 'scale'].includes(claim.decision)
            || binding?.occurrenceId !== claim.occurrenceId || binding.sessionSource.kind !== 'manual'
            || !deepEqual(accepted.recommendationAudit?.primarySession, binding)
            || accepted.recommendationAudit?.externalPlan) {
            throw new Error('Replacement recommendation has no exact accepted manual authority.');
        }
        const ref = doc(this.db, 'users', userId, 'session_occurrences', claim.occurrenceId);
        const snap = await transaction.get(ref);
        const parsed = snap.exists() ? parseSessionOccurrenceDocument(snap.data(), ref.path) : null;
        const source = binding.sessionSource;
        if (parsed?.status !== 'AVAILABLE' || !isManualOccurrence(parsed.data)
            || parsed.data.authority !== 'replace_recommendation'
            || parsed.data.userId !== userId || parsed.data.date !== date
            || !['scheduled', 'active'].includes(parsed.data.state)
            || parsed.data.definitionRef.definitionId !== source.definitionId
            || parsed.data.definitionRef.revision !== source.revision
            || parsed.data.definitionRef.contentHash !== source.contentHash) {
            throw new Error('Replacement occurrence does not match the accepted recommendation.');
        }
        if (prior?.primarySession?.occurrenceId === claim.occurrenceId) return;
        const displaced = await this.readPreparedPrimary(transaction, userId, date, prior?.primarySession?.occurrenceId);
        if (displaced) {
            transaction.set(displaced.ref, { ...displaced.occurrence, state: 'superseded', updatedAt: accepted.updatedAt });
            if (displaced.reservationRef) transaction.delete(displaced.reservationRef);
        }
    }

    private async readPreparedPrimary(transaction: Transaction, userId: string, date: string, occurrenceId?: string) {
        if (!occurrenceId) return null;
        const ref = doc(this.db, 'users', userId, 'session_occurrences', occurrenceId);
        const snap = await transaction.get(ref);
        const parsed = snap.exists() ? parseSessionOccurrenceDocument(snap.data(), ref.path) : null;
        if (parsed?.status !== 'AVAILABLE' || parsed.data.occurrenceId !== occurrenceId
            || parsed.data.userId !== userId || parsed.data.date !== date) {
            throw new Error('Prepared occurrence does not belong to the recommendation date and athlete.');
        }
        const occurrence = parsed.data;
        if (occurrence.state !== 'scheduled') {
            throw new Error(`Cannot replace today's recommendation because occurrence ${occurrenceId} is already '${occurrence.state}'.`);
        }
        // Primary execution can be committed before its occurrence lifecycle catches
        // up. Reading the same deterministic lock serializes launch against transfer.
        const lockRef = doc(this.db, 'users', userId, 'session_execution_locks', `occ_${date}_${encodeURIComponent(occurrenceId)}`);
        if ((await transaction.get(lockRef)).exists()) {
            throw new Error(`Cannot replace today's recommendation because occurrence ${occurrenceId} already has an execution.`);
        }
        let reservationRef: ReturnType<typeof doc> | null = null;
        if (isExternalPlanOccurrence(occurrence) && occurrence.windowBinding) {
            const windowRef = doc(this.db, 'users', userId, 'session_occurrence_windows', windowReservationId(date, occurrence.windowBinding.windowId));
            const reservation = await transaction.get(windowRef);
            if (reservation.exists()) {
                if (reservation.data()?.occurrenceId !== occurrenceId) {
                    throw new Error('Prepared occurrence window is owned by another occurrence.');
                }
                reservationRef = windowRef;
            }
        }
        return { ref, occurrence, reservationRef };
    }
}

export const manualRecommendationReplacementService = new ManualRecommendationReplacementService();
