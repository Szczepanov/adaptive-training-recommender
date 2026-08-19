import type { DataState } from './dataState';
import type { StrengthSession } from './models';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { activityService } from '../services/activityService';
import { strengthHistoryReadService } from '../services/strengthHistoryReadService';
import { isPermissionDeniedError } from '../utils/errors';
import {
    buildTrainingHistorySnapshot,
    type ManualTrainingPolicy,
    type TrainingHistorySnapshot,
} from './trainingHistorySnapshot';

export function toManualTrainingDataState(
    userId: string,
    result: { sessions: StrengthSession[]; invalidRecords: number },
): DataState<StrengthSession[]> {
    // ADR-0010: one corrupt record blocks an engine source. Partial valid data is not a
    // license to silently omit load from the corrupt records.
    if (result.invalidRecords > 0) {
        return {
            status: 'INVALID',
            issues: [{ code: 'manual-training-records-invalid', documentPath: `users/${userId}/strength_sessions` }],
        };
    }
    if (result.sessions.length === 0) return { status: 'MISSING' };
    return {
        status: 'AVAILABLE',
        data: result.sessions,
        revision: result.sessions
            .map(session => `${session.sessionId}:${session.updatedAt}`)
            .sort()
            .join('|'),
    };
}

async function readManualTraining(
    userId: string,
    startDateInclusive: string,
    throughDateExclusive: string,
): Promise<DataState<StrengthSession[]>> {
    try {
        return toManualTrainingDataState(
            userId,
            await strengthHistoryReadService.getSessionsInRange(userId, startDateInclusive, throughDateExclusive),
        );
    } catch (error: unknown) {
        return {
            status: 'UNAVAILABLE',
            operation: 'read manual training history',
            retryable: !isPermissionDeniedError(error),
        };
    }
}

export async function getFirestoreTrainingHistorySnapshot(
    userId: string,
    throughDateExclusive: string,
    windowDays: number,
    manualTrainingPolicy: ManualTrainingPolicy = 'off',
): Promise<TrainingHistorySnapshot> {
    const startDateInclusive = addDaysToLocalDateString(throughDateExclusive, -windowDays);

    // Default-off must be operationally inert as well as mathematically inert. Performing
    // a third Firestore read while off could make planning fail on a missing index/rule or
    // network error even though manual load is not allowed to affect the decision.
    if (manualTrainingPolicy === 'off') {
        const [activities, recommendations] = await Promise.all([
            activityService.getActivitiesInRange(userId, startDateInclusive, throughDateExclusive),
            recommendationService.getRecommendationsInRange(userId, startDateInclusive, throughDateExclusive),
        ]);
        return buildTrainingHistorySnapshot(throughDateExclusive, windowDays, activities, recommendations);
    }

    const [activities, recommendations, manualTraining] = await Promise.all([
        activityService.getActivitiesInRange(userId, startDateInclusive, throughDateExclusive),
        recommendationService.getRecommendationsInRange(userId, startDateInclusive, throughDateExclusive),
        readManualTraining(userId, startDateInclusive, throughDateExclusive),
    ]);
    return buildTrainingHistorySnapshot(
        throughDateExclusive,
        windowDays,
        activities,
        recommendations,
        undefined,
        manualTraining,
        manualTrainingPolicy,
    );
}

/** Production remains explicitly default-off until S3.3 records a ship decision. */
export const firestoreTrainingHistoryProvider: TrainingHistoryProvider = {
    async getSnapshot(userId, throughDateExclusive, windowDays): Promise<TrainingHistorySnapshot> {
        return getFirestoreTrainingHistorySnapshot(userId, throughDateExclusive, windowDays, 'off');
    },

    async reconstruct(userId, throughDateExclusive, windowDays): Promise<CompletedExposure[]> {
        return (await this.getSnapshot!(userId, throughDateExclusive, windowDays)).exposures;
    },
};
