import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, NormalizedGarminActivity } from './models';
import { completedEventToExposure, reconcileCompletedTrainingEvents } from './completedTraining';

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'garmin-1', date: '2026-08-06', type: 'cycling', durationMin: 45,
        trainingEffectAerobic: 3.6, trainingEffectAnaerobic: 0.5, averageHr: 155,
        activityTrainingLoad: 120, intensityTag: 'hard', ...overrides,
    };
}

function recommendation(overrides: Partial<DailyRecommendation> = {}): DailyRecommendation {
    return {
        userId: 'athlete', date: '2026-08-06', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
        category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 1,
        createdAt: '', updatedAt: '',
        adherence: { respondedAt: '2026-08-07T08:00:00Z', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: 'Felt controlled.' },
        ...overrides,
    };
}

describe('completed training reconciliation', () => {
    it('retains a Garmin hard session with no adherence answer', () => {
        const [event] = reconcileCompletedTrainingEvents([activity()], []);
        expect(event.sources).toEqual(['garmin']);
        expect(event.intensity).toBe('hard');
        expect(completedEventToExposure(event).costProfile.systemic).toBeGreaterThan(0.5);
    });

    it('merges matching Garmin and followed-adherence evidence into one event', () => {
        const events = reconcileCompletedTrainingEvents([activity()], [recommendation()]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ sources: ['garmin', 'adherence'], linkedActivityId: 'garmin-1', linkedRecommendationDate: '2026-08-06', confidence: 'high' });
        expect(events[0].durationMin).toBe(45);
        expect(events[0].athleteFeedback.notes).toBe('Felt controlled.');
    });

    it('creates an adherence-only event when no Garmin activity matches', () => {
        const events = reconcileCompletedTrainingEvents([], [recommendation()]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ sources: ['adherence'], linkedActivityId: null, modality: 'Cycling' });
    });

    it('does not count skipped or unanswered recommendations as completed training', () => {
        const skipped = recommendation({ adherence: { respondedAt: 'x', followed: false, actualModality: null, actualDurationMin: null, skipped: true, notes: null } });
        const unanswered = recommendation({ adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null } });
        expect(reconcileCompletedTrainingEvents([], [skipped, unanswered])).toEqual([]);
    });

    it('keeps two real Garmin activities on the same day distinct', () => {
        const events = reconcileCompletedTrainingEvents([
            activity({ activityId: 'garmin-1', type: 'running' }),
            activity({ activityId: 'garmin-2', type: 'cycling' }),
        ], []);
        expect(events.map(event => event.linkedActivityId)).toEqual(['garmin-1', 'garmin-2']);
    });

    it('matches adherence to the closest eligible same-modality Garmin activity', () => {
        const events = reconcileCompletedTrainingEvents([
            activity({ activityId: 'garmin-long', durationMin: 60 }),
            activity({ activityId: 'garmin-close', durationMin: 45 }),
        ], [recommendation()]);

        expect(events.find(event => event.sources.includes('adherence'))?.linkedActivityId).toBe('garmin-close');
    });
});
