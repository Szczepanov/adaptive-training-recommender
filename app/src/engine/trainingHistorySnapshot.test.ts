import { describe, expect, it } from 'vitest';
import type { DataState } from './dataState';
import type { DailyRecommendation, NormalizedGarminActivity, StrengthSession } from './models';
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

const strengthSession: StrengthSession = {
    userId: 'u1', sessionId: 'strength-1', date: '2026-08-06',
    startedAt: '2026-08-06T16:00:00Z', completedAt: '2026-08-06T16:45:00Z',
    updatedAt: '2026-08-06T16:45:00Z', state: 'completed', schemaVersion: 1,
    exercises: [{
        exerciseId: 'front_squat',
        sets: [{ setIndex: 1, weightKg: 80, reps: 5, isWarmup: false, completedAt: '2026-08-06T16:15:00Z', gauge: { scale: 'rir', value: 2 } }],
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

    it('is bit-compatible with the old revision and ignores manual data while policy is off', () => {
        const manual: DataState<StrengthSession[]> = { status: 'AVAILABLE', revision: 'manual-r1', data: [strengthSession] };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', manual, 'off',
        );
        expect(snapshot.revision).toBe('history-v1:2026-08-07:7:activity-revision:recommendation-revision');
        expect(snapshot.sourceStates.manualTraining).toEqual({ status: 'MISSING' });
        expect(snapshot.exposures).toHaveLength(1);
    });

    it('includes completed manual strength with source provenance when explicitly enabled', () => {
        const manual: DataState<StrengthSession[]> = { status: 'AVAILABLE', revision: 'manual-r1', data: [strengthSession] };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', manual, 'included',
        );
        expect(snapshot.revision).toBe('history-v1:2026-08-07:7:activity-revision:recommendation-revision:manual:manual-r1');
        expect(snapshot.sourceStates.manualTraining).toEqual({ status: 'AVAILABLE', revision: 'manual-r1' });
        expect(snapshot.exposures.map(exposure => exposure.occurrenceKey)).toContain('strength:strength-1');
    });

    it('allows a genuinely missing optional manual source but blocks invalid manual history', () => {
        const missing = buildTrainingHistorySnapshot(
            '2026-08-07', 7, activities, recommendations, '2026-08-07T08:00:00Z', { status: 'MISSING' }, 'included',
        );
        expect(missing.revision).toContain(':manual:missing');
        expect(() => buildTrainingHistorySnapshot(
            '2026-08-07', 7, activities, recommendations, undefined,
            { status: 'INVALID', issues: [{ code: 'bad', documentPath: 'strength' }] }, 'included',
        )).toThrow(TrainingHistorySourceError);
    });

    it('replaces rather than double-counts manual and reconciled evidence for one recommendation', () => {
        const linked = { ...strengthSession, sourceRecommendationDate: '2026-08-06' };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7, activities, recommendations, undefined,
            { status: 'AVAILABLE', revision: 'manual-r1', data: [linked] }, 'included',
        );
        expect(snapshot.exposures).toHaveLength(1);
        expect(snapshot.exposures[0]).toMatchObject({ occurrenceKey: 'recommendation:2026-08-06', modality: 'Strength' });
    });
});
