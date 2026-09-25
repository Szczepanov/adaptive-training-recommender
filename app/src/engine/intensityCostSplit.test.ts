import { describe, expect, it } from 'vitest';
import type { ActivityOverride, DailyRecommendation, NormalizedGarminActivity } from './models';
import { DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY, reconcileCompletedTrainingEvents } from './completedTraining';
import { formatIntensityCell } from './contextBrief';

// Issue #809: stimulus intensity (intensityTag) and session dose (sessionCost) are
// separate dimensions; completed-training cost indexes by dose, stimulus by intensity.
function ride(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'ride-809', date: '2026-09-20', type: 'cycling', durationMin: 120,
        trainingEffectAerobic: 3.0, trainingEffectAnaerobic: 0.3, averageHr: 117,
        activityTrainingLoad: 140, intensityTag: 'easy', stimulusDomain: 'endurance',
        sessionCost: 'high', intensityEvidence: 'powerIntensityFactor', intensityClassificationVersion: 2,
        ...overrides,
    };
}

describe('stimulus vs session-cost split (#809)', () => {
    it('keeps an endurance stimulus for a long aerobic ride while its cost follows the high dose', () => {
        const [event] = reconcileCompletedTrainingEvents([ride()], []);
        expect(event.intensity).toBe('easy');
        expect(event.estimatedStimulus).toEqual(DEFAULT_STIMULUS_BY_MODALITY.Cycling.easy);
        expect(event.estimatedCost.systemic).toBeGreaterThan(DEFAULT_COST_BY_MODALITY.Cycling.easy.systemic);
    });

    it('gives a long Z2 ride more cost than a short easy ride without changing the stimulus', () => {
        const [long] = reconcileCompletedTrainingEvents([ride()], []);
        const [short] = reconcileCompletedTrainingEvents([ride({ activityId: 'short', durationMin: 40, trainingEffectAerobic: 1.6, sessionCost: 'low' })], []);
        expect(long.intensity).toBe(short.intensity);
        expect(long.estimatedCost.systemic).toBeGreaterThan(short.estimatedCost.systemic);
    });

    it('leaves legacy records (no sessionCost) indexing cost by their intensity tag', () => {
        const legacy = ride({ intensityTag: 'hard', stimulusDomain: undefined, sessionCost: undefined, intensityEvidence: undefined, intensityClassificationVersion: undefined });
        const [event] = reconcileCompletedTrainingEvents([legacy], []);
        const [explicit] = reconcileCompletedTrainingEvents([ride({ intensityTag: 'hard', sessionCost: 'high' })], []);
        expect(event.intensity).toBe('hard');
        expect(event.estimatedCost).toEqual(explicit.estimatedCost);
    });

    it('keeps the dose-indexed cost when an adherence answer merges into the activity', () => {
        const [alone] = reconcileCompletedTrainingEvents([ride()], []);
        const answered: DailyRecommendation = {
            userId: 'athlete', date: '2026-09-20', templateId: 'end_mod_02', templateTitle: 'Tempo Ride',
            category: 'Moderate Endurance', modality: 'Cycling', mode: 'train', rationale: 'test', schemaVersion: 1,
            createdAt: '', updatedAt: '',
            adherence: { respondedAt: '2026-09-20T18:00:00Z', followed: false, actualModality: 'Cycling', actualDurationMin: 120, skipped: false, notes: null },
        };
        const [merged] = reconcileCompletedTrainingEvents([ride()], [answered]);
        expect(merged.sources).toContain('adherence');
        expect(merged.intensity).toBe('easy');
        expect(merged.estimatedCost).toEqual(alone.estimatedCost);
    });

    it('lets an athlete reclassification take precedence over both dimensions', () => {
        const override: ActivityOverride = {
            activityId: 'ride-809', userId: 'athlete', date: '2026-09-20', originalType: 'cycling',
            originalIntensityTag: 'easy', overriddenModality: 'Cycling', overriddenIntensity: 'moderate',
            createdAt: '', updatedAt: '',
        };
        const [event] = reconcileCompletedTrainingEvents([ride()], [], { activityOverrides: { 'ride-809': override } });
        expect(event.intensity).toBe('moderate');
        expect(event.sources).toEqual(['garmin', 'manual']);
        const [moderateRide] = reconcileCompletedTrainingEvents([ride({ intensityTag: 'moderate', sessionCost: 'moderate' })], []);
        expect(event.estimatedCost).toEqual(moderateRide.estimatedCost);
    });

    it('renders stimulus and cost separately in the context brief intensity cell', () => {
        expect(formatIntensityCell(ride())).toBe('easy (endurance, cost high)');
        expect(formatIntensityCell(ride({ intensityTag: 'hard', stimulusDomain: 'vo2', sessionCost: 'very_high' }))).toBe('hard (vo2, cost very high)');
        expect(formatIntensityCell(ride({ stimulusDomain: undefined, sessionCost: undefined }))).toBe('easy');
    });
});
