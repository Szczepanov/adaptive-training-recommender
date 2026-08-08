import { describe, expect, it } from 'vitest';
import type { CompletedTrainingEvent, DailyRecommendation, NormalizedGarminActivity } from './models';
import { completedEventToExposure, DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY, deriveSessionPlanRelationship, reconcileCompletedTrainingEvents, scaleCostByDeliveredDose } from './completedTraining';

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
    it('scales each cost dimension monotonically with delivered duration and completion ratio', () => {
        const base = { systemic: 0.6, cardiovascular: 0.7, lowerBody: 0.5, upperBody: 0.1, impactTissue: 0.2, neuromuscular: 0.4 };
        const short = scaleCostByDeliveredDose(base, { plannedDurationMin: 60, completedDurationMin: 40, completionRatio: 1 });
        const long = scaleCostByDeliveredDose(base, { plannedDurationMin: 60, completedDurationMin: 180, completionRatio: 1 });
        const partial = scaleCostByDeliveredDose(base, { plannedDurationMin: 60, completedDurationMin: 180, completionRatio: 0.5 });

        expect(long.systemic).toBeGreaterThan(short.systemic);
        expect(long.systemic).toBe(base.systemic);
        expect(partial.systemic).toBeLessThan(long.systemic);
        expect(partial.impactTissue).toBeLessThan(long.impactTissue);
    });

    it('retains a Garmin hard session with no adherence answer and scales it against the catalog duration reference', () => {
        const [event] = reconcileCompletedTrainingEvents([activity()], []);
        const exposure = completedEventToExposure(event);
        expect(event.sources).toEqual(['garmin']);
        expect(event.intensity).toBe('hard');
        expect(event.deliveredDose?.completedDurationMin).toBe(45);
        expect(event.deliveredDose?.plannedDurationMin).toBeGreaterThan(45);
        expect(exposure.costProfile.systemic).toBeGreaterThan(0);
        expect(exposure.costProfile.systemic).toBeLessThan(DEFAULT_COST_BY_MODALITY.Cycling.hard.systemic);
        expect(exposure.costProfile.systemic).toBe(event.estimatedCost.systemic);
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

    it('classifies a standalone adherence-confirmed, catalog-matched session as exact confidence', () => {
        const [event] = reconcileCompletedTrainingEvents([], [recommendation()]);
        expect(event.exactTemplateMatch).toBe(true);
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('exact');
    });

    it('classifies a Garmin-only session (no adherence answer) as inferred, not exact', () => {
        const [event] = reconcileCompletedTrainingEvents([activity()], []);
        expect(event.exactTemplateMatch).toBe(false);
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('inferred');
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

    it('attaches inferred stimulus profile to recognized Garmin cycling session', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({ type: 'cycling', intensityTag: 'moderate', trainingEffectAerobic: 2.5 })], []);
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('inferred');
        expect(exposure.stimulusProfile?.aerobicEndurance).toBeGreaterThan(0.5);
        expect(exposure.modality).toBe('Cycling');
    });

    it('withholds stimulus profile and sets unknown confidence for unknown modality', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({ type: 'unknown_sport' })], []);
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('unknown');
        expect(exposure.stimulusProfile).toBeUndefined();
    });

    it('asserts DEFAULT_STIMULUS_BY_MODALITY table totality for all recognized modalities and intensities', () => {
        const modalities = ['Cycling', 'Running', 'Strength', 'Field', 'Mobility', 'Cross Training'];
        const intensities = ['easy', 'moderate', 'hard', 'unknown'];

        for (const mod of modalities) {
            for (const int of intensities) {
                const vector = DEFAULT_STIMULUS_BY_MODALITY[mod as keyof typeof DEFAULT_STIMULUS_BY_MODALITY][int as import('./models').CompletedTrainingIntensity];
                expect(vector).toBeDefined();
                const sum = (Object.values(vector) as number[]).reduce((a, b) => a + b, 0);
                expect(sum).toBeGreaterThan(0);
            }
        }
    });
});

function completedEvent(overrides: Partial<CompletedTrainingEvent> = {}): CompletedTrainingEvent {
    return {
        id: 'evt-1', date: '2026-08-06', durationMin: 45, modality: 'Cycling', intensity: 'moderate',
        trainingEffect: 3.0, estimatedCost: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0.1, neuromuscular: 0 },
        estimatedStimulus: {}, exactTemplateMatch: false, sources: ['garmin'], confidence: 'high',
        linkedActivityId: 'garmin-1', linkedRecommendationDate: '2026-08-06',
        athleteFeedback: { followed: true, notes: null },
        ...overrides,
    };
}

describe('deriveSessionPlanRelationship', () => {
    it('is unplanned when there is no recommendation at all', () => {
        expect(deriveSessionPlanRelationship(null, completedEvent())).toBe('unplanned');
    });

    it('is missed when there is a recommendation with no matching event and it was reported skipped', () => {
        const rec = recommendation({ adherence: { respondedAt: '', followed: false, actualModality: null, actualDurationMin: null, skipped: true, notes: null } });
        expect(deriveSessionPlanRelationship(rec, null)).toBe('missed');
    });

    it('is uncertain_match when there is a recommendation with no matching event and no skip was reported', () => {
        const rec = recommendation({ adherence: { respondedAt: '', followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null } });
        expect(deriveSessionPlanRelationship(rec, null)).toBe('uncertain_match');
    });

    it('is matched_as_planned for a same-day, same-modality event with adherence not explicitly false', () => {
        const rec = recommendation({ date: '2026-08-06', modality: 'Cycling' });
        const event = completedEvent({ date: '2026-08-06', modality: 'Cycling' });
        expect(deriveSessionPlanRelationship(rec, event)).toBe('matched_as_planned');
    });

    it('is matched_modified for a same-day, same-modality event explicitly marked not followed', () => {
        const rec = recommendation({
            date: '2026-08-06', modality: 'Cycling',
            adherence: { respondedAt: '', followed: false, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        });
        const event = completedEvent({ date: '2026-08-06', modality: 'Cycling' });
        expect(deriveSessionPlanRelationship(rec, event)).toBe('matched_modified');
    });

    it('is matched_modified for a same-day event whose modality differs from the recommendation', () => {
        const rec = recommendation({ date: '2026-08-06', modality: 'Cycling' });
        const event = completedEvent({ date: '2026-08-06', modality: 'Running' });
        expect(deriveSessionPlanRelationship(rec, event)).toBe('matched_modified');
    });

    it('is rescheduled for a same-modality event completed on a different day', () => {
        const rec = recommendation({ date: '2026-08-06', modality: 'Cycling' });
        const event = completedEvent({ date: '2026-08-07', modality: 'Cycling' });
        expect(deriveSessionPlanRelationship(rec, event)).toBe('rescheduled');
    });

    it('is unplanned for a different-modality event completed on a different day', () => {
        const rec = recommendation({ date: '2026-08-06', modality: 'Cycling' });
        const event = completedEvent({ date: '2026-08-07', modality: 'Running' });
        expect(deriveSessionPlanRelationship(rec, event)).toBe('unplanned');
    });
});
