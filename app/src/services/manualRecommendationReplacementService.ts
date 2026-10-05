import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { ManualOccurrenceRef, SessionOccurrence } from '../sessions/models';
import { isExternalPlanOccurrence } from '../sessions/models';
import { parseDailyRecommendation } from '../persistence/parsers/trainingHistory';
import { parseSessionOccurrenceDocument } from '../persistence/parsers/sessionDefinition';
import { windowReservationId } from './sessionOccurrenceService';

/**
 * Coordinates the authority hand-off from today's persisted primary recommendation to a
 * manual replacement occurrence. The recommendation binding is the only source of truth for
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
            let displaced: SessionOccurrence | null = null;
            let displacedRef: ReturnType<typeof doc> | null = null;
            let reservationRef: ReturnType<typeof doc> | null = null;
            let hasOwnedReservation = false;

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
                const displacedOccurrenceId = parsedRecommendation.data.primarySession?.occurrenceId;
                if (displacedOccurrenceId) {
                    displacedRef = doc(this.db, 'users', userId, 'session_occurrences', displacedOccurrenceId);
                    const displacedSnap = await transaction.get(displacedRef);
                    if (!displacedSnap.exists()) {
                        throw new Error(
                            `Prepared occurrence ${displacedOccurrenceId} referenced by today's recommendation was not found.`,
                        );
                    }
                    const parsedOccurrence = parseSessionOccurrenceDocument(displacedSnap.data(), displacedRef.path);
                    if (parsedOccurrence.status !== 'AVAILABLE') {
                        throw new Error(
                            `Prepared occurrence ${displacedOccurrenceId} could not be parsed (${parsedOccurrence.status}).`,
                        );
                    }
                    displaced = parsedOccurrence.data;
                    if (displaced.userId !== userId || displaced.date !== date) {
                        throw new Error('Prepared occurrence does not belong to the recommendation date and athlete.');
                    }
                    if (displaced.state !== 'scheduled') {
                        throw new Error(
                            `Cannot replace today's recommendation because occurrence ${displaced.occurrenceId} is already '${displaced.state}'.`,
                        );
                    }
                    if (isExternalPlanOccurrence(displaced) && displaced.windowBinding) {
                        reservationRef = doc(
                            this.db,
                            'users',
                            userId,
                            'session_occurrence_windows',
                            windowReservationId(date, displaced.windowBinding.windowId),
                        );
                        const reservationSnap = await transaction.get(reservationRef);
                        if (reservationSnap.exists()) {
                            const owner = reservationSnap.data()?.occurrenceId as string | undefined;
                            if (owner !== displaced.occurrenceId) {
                                throw new Error(
                                    `Prepared occurrence window is owned by another occurrence (${owner ?? 'unknown'}).`,
                                );
                            }
                            hasOwnedReservation = true;
                        }
                    }
                }
            }

            if (displaced && displacedRef) {
                transaction.set(displacedRef, {
                    ...displaced,
                    state: 'superseded',
                    updatedAt: now,
                });
                if (reservationRef && hasOwnedReservation) {
                    transaction.delete(reservationRef);
                }
            }
            transaction.set(replacementRef, replacement);
        });

        return replacement;
    }
}

export const manualRecommendationReplacementService = new ManualRecommendationReplacementService();
