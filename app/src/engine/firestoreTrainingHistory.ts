import { exposureFromRecommendation, type CompletedExposure, type TrainingHistoryProvider } from './trainingHistory';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString } from '../utils/localDate';

/** Production implementation. The loop deliberately yields oldest-to-newest history. */
export const firestoreTrainingHistoryProvider: TrainingHistoryProvider = {
    async reconstruct(userId, throughDateExclusive, windowDays) {
        const exposures: CompletedExposure[] = [];
        for (let offset = windowDays; offset >= 1; offset--) {
            const date = addDaysToLocalDateString(throughDateExclusive, -offset);
            const exposure = exposureFromRecommendation(date, await recommendationService.getRecommendation(userId, date));
            if (exposure) exposures.push(exposure);
        }
        return exposures;
    },
};
