import { describe, expect, it } from 'vitest';
import type { DataState } from './dataState';
import type { DailyRecommendation, NormalizedGarminActivity } from './models';
import { buildTrainingHistorySnapshot, TrainingHistorySourceError } from './trainingHistorySnapshot';

const activities: DataState<NormalizedGarminActivity[]> = {
    status: 'AVAILABLE', revision: 'activity-revision', data: [{
        activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 45,
        trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null, averageHr: 150,
        activityTrainingLoad: 115, intensityTag: 'hard',
    }],
};

const recommendations: DataState<DailyRecommendation[]> = {
    status: 'AVAILABLE', revision: 'recommendation-revision', data: [{
        userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
        category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 2,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: 'x', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
    }],
};

describe('training history snapshot', () => {
    it('creates one revisioned event/exposure view from both bounded sources', () => {
        const snapshot = buildTrainingHistorySnapshot('2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z');
        expect(snapshot).toMatchObject({
            revision: 'history-v1:2026-08-07:7:activity-revision:recommendation-revision',
            completedEvents: [{ sources: ['garmin', 'adherence'] }],
            sourceStates: { activities: { status: 'AVAILABLE' }, recommendations: { status: 'AVAILABLE' }, manualTraining: { status: 'MISSING' } },
        });
        expect(snapshot.exposures).toHaveLength(1);
    });

    it('does not turn an unavailable activity query into zero training load', () => {
        const unavailable: DataState<NormalizedGarminActivity[]> = {
            status: 'UNAVAILABLE', operation: 'read activities history', retryable: true,
        };
        expect(() => buildTrainingHistorySnapshot('2026-08-07', 7, unavailable, recommendations)).toThrow(TrainingHistorySourceError);
    });
});
