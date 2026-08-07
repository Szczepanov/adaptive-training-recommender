import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { activityService } from '../services/activityService';
import { buildTrainingHistorySnapshot, type TrainingHistorySnapshot } from './trainingHistorySnapshot';

/** Production implementation. The bounded activity and recommendation reads execute in
 * parallel; a failed source is surfaced to the caller rather than becoming empty load. */
export const firestoreTrainingHistoryProvider: TrainingHistoryProvider = {
    async getSnapshot(userId, throughDateExclusive, windowDays): Promise<TrainingHistorySnapshot> {
        const startDateInclusive = addDaysToLocalDateString(throughDateExclusive, -windowDays);
        const [activities, recommendations] = await Promise.all([
            activityService.getActivitiesInRange(userId, startDateInclusive, throughDateExclusive),
            recommendationService.getRecommendationsInRange(userId, startDateInclusive, throughDateExclusive),
        ]);
        return buildTrainingHistorySnapshot(throughDateExclusive, windowDays, activities, recommendations);
    },

    async reconstruct(userId, throughDateExclusive, windowDays): Promise<CompletedExposure[]> {
        return (await this.getSnapshot!(userId, throughDateExclusive, windowDays)).exposures;
    },
};
