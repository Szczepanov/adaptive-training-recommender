import type { DataState } from './dataState';
import type { StrengthSession } from './models';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { activityService } from '../services/activityService';
import { strengthSessionService } from '../services/strengthSessionService';
import { buildTrainingHistorySnapshot, type TrainingHistorySnapshot } from './trainingHistorySnapshot';

/** Turns `strengthSessionService.getSessionsInRange`'s result into the `DataState` shape
 *  `buildTrainingHistorySnapshot` expects. Exported and pure specifically so the
 *  MISSING-vs-INVALID distinction below is directly unit-testable -- with the manual-
 *  training selector `'off'` in production (S3.2), `getSnapshot`'s returned snapshot cannot
 *  observably distinguish the two, so a black-box test of `getSnapshot` alone could never
 *  catch a regression here.
 *
 *  `getSessionsInRange` (S1.7) already omits an individually malformed document rather than
 *  failing the whole range -- matching `decisionJournalService`'s precedent, not
 *  `activityService`'s stricter one; see S1.7's outcome note for that choice. But zero
 *  usable sessions with a nonzero `invalidRecords` count means every document present was
 *  corrupt, which must not read the same as "the athlete genuinely logged nothing" -- the
 *  exact conflation this source's failure contract exists to prevent. */
export function toManualTrainingDataState(
    userId: string,
    result: { sessions: StrengthSession[]; invalidRecords: number },
): DataState<StrengthSession[]> {
    if (result.sessions.length > 0) {
        return { status: 'AVAILABLE', data: result.sessions, revision: result.sessions.map(session => session.updatedAt).sort().join('|') };
    }
    if (result.invalidRecords > 0) {
        return { status: 'INVALID', issues: [{ code: 'all-manual-training-records-invalid', documentPath: `users/${userId}/strength_sessions` }] };
    }
    return { status: 'MISSING' };
}

/** Production implementation. The bounded activity, recommendation, and strength-session
 * reads execute in parallel; a failed source is surfaced to the caller rather than becoming
 * empty load. The strength-session fetch is real (S3.2), but `buildTrainingHistorySnapshot`
 * is called with the manual-training policy explicitly `'off'` -- its default -- so this
 * fetch has no effect on the returned snapshot yet. Wiring the read here now, rather than
 * only in a future S3.3 harness, means enabling the source later is a policy flip, not a
 * second fetch-wiring change. */
export const firestoreTrainingHistoryProvider: TrainingHistoryProvider = {
    async getSnapshot(userId, throughDateExclusive, windowDays): Promise<TrainingHistorySnapshot> {
        const startDateInclusive = addDaysToLocalDateString(throughDateExclusive, -windowDays);
        const [activities, recommendations, strengthSessions] = await Promise.all([
            activityService.getActivitiesInRange(userId, startDateInclusive, throughDateExclusive),
            recommendationService.getRecommendationsInRange(userId, startDateInclusive, throughDateExclusive),
            strengthSessionService.getSessionsInRange(userId, startDateInclusive, throughDateExclusive),
        ]);
        const manualTraining = toManualTrainingDataState(userId, strengthSessions);
        return buildTrainingHistorySnapshot(throughDateExclusive, windowDays, activities, recommendations, undefined, manualTraining, 'off');
    },

    async reconstruct(userId, throughDateExclusive, windowDays): Promise<CompletedExposure[]> {
        return (await this.getSnapshot!(userId, throughDateExclusive, windowDays)).exposures;
    },
};
