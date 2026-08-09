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

    it('still infers a generic stimulus profile from real Garmin measured-effort evidence even when the modality itself is unknown', () => {
        // Phase 5.5: modality and evidence quality are independent axes -- this activity's
        // sport couldn't be classified, but it still carries real trainingEffect +
        // activityTrainingLoad, so it must not be treated as adaptation-neutral.
        const [event] = reconcileCompletedTrainingEvents([activity({ type: 'unknown_sport' })], []);
        expect(event.evidenceTier).toBe('measuredEffort');
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('inferred');
        expect(exposure.stimulusProfile).toBeDefined();
        expect(exposure.stimulusProfile?.aerobicEndurance).toBeGreaterThan(0);
        expect(exposure.modality).toBeUndefined(); // genuinely unknown -- never fabricated
    });

    it('withholds stimulus profile and sets unknown confidence when there is genuinely no evidence at all', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({
            type: 'unknown_sport', trainingEffectAerobic: 0, trainingEffectAnaerobic: 0, activityTrainingLoad: null, intensityTag: '',
        })], []);
        expect(event.evidenceTier).toBe('genericModalityFallback');
        const exposure = completedEventToExposure(event);
        expect(exposure.stimulusConfidence).toBe('unknown');
        expect(exposure.stimulusProfile).toBeDefined(); // still non-zero -- see DEFAULT_STIMULUS_BY_MODALITY.Unknown
        expect(exposure.modality).toBeUndefined();
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

// Phase 5.5: docs/plans/phase-5-sequence-planning.md 5.5 -- every rung of the evidence
// hierarchy that's actually reachable given current ingested data.
describe('evidence hierarchy (Phase 5.5)', () => {
    it('measuredEffort: known modality with both trainingEffect and activityTrainingLoad', () => {
        const [event] = reconcileCompletedTrainingEvents([activity()], []); // base fixture has both
        expect(event.evidenceTier).toBe('measuredEffort');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('inferred');
    });

    it('garminTrainingEffect: trainingEffect present but no activityTrainingLoad', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({ activityTrainingLoad: null })], []);
        expect(event.evidenceTier).toBe('garminTrainingEffect');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('inferred');
    });

    it('durationIntensity: only an intensity tag, no trainingEffect or trainingLoad', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({
            trainingEffectAerobic: 0, trainingEffectAnaerobic: 0, activityTrainingLoad: null, intensityTag: 'moderate',
        })], []);
        expect(event.evidenceTier).toBe('durationIntensity');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('inferred');
    });

    it('athleteClassification: modality guessed from free text, no other signal at all', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({
            type: 'cycling', trainingEffectAerobic: 0, trainingEffectAnaerobic: 0, activityTrainingLoad: null, intensityTag: '',
        })], []);
        expect(event.evidenceTier).toBe('athleteClassification');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('inferred');
    });

    it('genericModalityFallback: nothing known at all', () => {
        const [event] = reconcileCompletedTrainingEvents([activity({
            type: 'unknown_sport', trainingEffectAerobic: 0, trainingEffectAnaerobic: 0, activityTrainingLoad: null, intensityTag: '',
        })], []);
        expect(event.evidenceTier).toBe('genericModalityFallback');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('unknown');
    });

    it('exactPrescribedMatch: adherence-only event confirming a template with an authored stimulusProfile', () => {
        const [event] = reconcileCompletedTrainingEvents([], [recommendation()]);
        expect(event.evidenceTier).toBe('exactPrescribedMatch');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('exact');
    });

    it('athleteClassification: adherence-only event with a self-reported modality and no template match', () => {
        const rec = recommendation({
            templateId: 'nonexistent',
            adherence: { respondedAt: 'x', followed: false, actualModality: 'Strength', actualDurationMin: 40, skipped: false, notes: null },
        });
        const [event] = reconcileCompletedTrainingEvents([], [rec]);
        expect(event.evidenceTier).toBe('athleteClassification');
        expect(completedEventToExposure(event).stimulusConfidence).toBe('inferred');
    });

    it('mergeAdherenceIntoGarmin upgrades a Garmin-only tier to exactPrescribedMatch when adherence confirms the exact template', () => {
        const events = reconcileCompletedTrainingEvents([activity()], [recommendation()]);
        expect(events).toHaveLength(1);
        expect(events[0].evidenceTier).toBe('exactPrescribedMatch');
        expect(completedEventToExposure(events[0]).stimulusConfidence).toBe('exact');
    });

    it('mergeAdherenceIntoGarmin retains the Garmin-derived tier when adherence does not confirm the exact template', () => {
        const rec = recommendation({ adherence: { respondedAt: 'x', followed: false, actualModality: 'Cycling', actualDurationMin: 45, skipped: false, notes: null } });
        const events = reconcileCompletedTrainingEvents([activity()], [rec]);
        expect(events).toHaveLength(1);
        expect(events[0].evidenceTier).toBe('measuredEffort'); // unchanged from the Garmin-only classification
    });
});
