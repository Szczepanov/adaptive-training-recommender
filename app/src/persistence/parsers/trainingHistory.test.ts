import { describe, expect, it } from 'vitest';
import { parseDailyRecommendation, parseNormalizedGarminActivity } from './trainingHistory';

const activity = {
    activityId: 'a-1', date: '2026-08-06', type: 'cycling', durationMin: 45,
    trainingEffectAerobic: 3.2, trainingEffectAnaerobic: null, averageHr: 150,
    activityTrainingLoad: 115, intensityTag: 'hard', syncedAt: '2026-08-07T06:00:00Z',
};

const recommendation = {
    userId: 'u1', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
    category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 2,
    createdAt: '2026-08-06T06:00:00Z', updatedAt: '2026-08-06T06:00:00Z',
    adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
};

describe('training-history persistence parsers', () => {
    it('accepts the documented schema-less legacy Garmin record', () => {
        const parsed = parseNormalizedGarminActivity(activity, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1', durationMin: 45 } });
    });

    it('rejects malformed activity dates instead of normalizing them', () => {
        const parsed = parseNormalizedGarminActivity({ ...activity, date: '2026-02-30' }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ field: 'date', code: 'invalid-date' }] });
    });

    it('rejects an unknown future activity schema', () => {
        const parsed = parseNormalizedGarminActivity({ ...activity, schemaVersion: 3 }, 'users/u1/activities/a-1', 'a-1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 3 }] });
    });

    it('parses supported recommendation schemas and rejects future ones', () => {
        expect(parseDailyRecommendation(recommendation, 'users/u1/daily_recommendations/2026-08-06')).toMatchObject({ status: 'AVAILABLE', data: { date: '2026-08-06' } });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 3 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ field: 'recommendationAudit' }] });
        expect(parseDailyRecommendation({ ...recommendation, schemaVersion: 4 }, 'users/u1/daily_recommendations/2026-08-06'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 4 }] });
    });
});
