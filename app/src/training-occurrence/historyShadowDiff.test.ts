import { describe, expect, it } from 'vitest';
import type { CompletedTrainingEvent } from '../engine/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { diffCompletedTrainingHistory, estimateCanonicalEvidenceTier } from './historyShadowDiff';

function liveEvent(overrides: Partial<CompletedTrainingEvent> = {}): CompletedTrainingEvent {
    return {
        id: 'evt-1',
        date: '2026-08-26',
        durationMin: 40,
        modality: 'Strength',
        intensity: 'hard',
        trainingEffect: 3,
        estimatedCost: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        estimatedStimulus: {},
        exactTemplateMatch: false,
        sources: ['garmin'],
        confidence: 'medium',
        evidenceTier: 'garminTrainingEffect',
        linkedActivityId: null,
        linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
        ...overrides,
    };
}

function workout(overrides: Partial<CompletedWorkoutView> = {}): CompletedWorkoutView {
    return {
        performedOccurrenceId: 'pto-1',
        sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
        reconciliation: { state: 'single_source' },
        garminExerciseSetsAreDiagnosticOnly: false,
        ...overrides,
    };
}

describe('estimateCanonicalEvidenceTier', () => {
    it('floors a structured workout at completedStructuredWorkout regardless of Garmin telemetry richness', () => {
        const withGarmin = workout({
            structured: { title: 'Squat Day', comparison: { definitionId: 'd', revision: 1, title: 't', totalPlannedSteps: 1, completedStepsCount: 1, missingRequiredStepsCount: 0, stepComparisons: [], summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 } } },
            garmin: { activityId: 'a1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' },
        });
        expect(estimateCanonicalEvidenceTier(withGarmin)).toBe('completedStructuredWorkout');
    });

    it('uses the exact same tier classifier as the live pipeline for Garmin-only evidence', () => {
        const garminOnly = workout({
            modality: 'strength',
            garmin: { activityId: 'a1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 120, activityTrainingLoad: 80, intensityTag: 'hard' },
        });
        expect(estimateCanonicalEvidenceTier(garminOnly)).toBe('measuredEffort');
    });

    it('returns null when neither structured nor Garmin evidence is present', () => {
        expect(estimateCanonicalEvidenceTier(workout())).toBeNull();
    });
});

describe('diffCompletedTrainingHistory', () => {
    it('reports zero delta when live and canonical agree', () => {
        const diff = diffCompletedTrainingHistory([liveEvent()], [workout()]);
        expect(diff.liveExposureCount).toBe(1);
        expect(diff.canonicalExposureCount).toBe(1);
        expect(diff.exposureCountDelta).toBe(0);
    });

    it('shows a negative delta (canonical collapsed duplicates) when two live events correspond to one matched canonical occurrence', () => {
        const diff = diffCompletedTrainingHistory(
            [liveEvent({ id: 'evt-1' }), liveEvent({ id: 'evt-2' })],
            [workout({ sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] } })],
        );
        expect(diff.exposureCountDelta).toBe(-1);
        expect(diff.matchedOccurrenceCount).toBe(1);
    });

    it('counts ambiguous occurrences separately from matched, since they are deliberately not merged', () => {
        const diff = diffCompletedTrainingHistory([], [
            workout({ performedOccurrenceId: 'pto-a', reconciliation: { state: 'ambiguous' } }),
            workout({ performedOccurrenceId: 'pto-b', sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] } }),
        ]);
        expect(diff.ambiguousOccurrenceCount).toBe(1);
        expect(diff.matchedOccurrenceCount).toBe(1);
    });

    it('tallies evidence tiers on both sides independently', () => {
        const diff = diffCompletedTrainingHistory(
            [liveEvent({ evidenceTier: 'garminTrainingEffect' }), liveEvent({ evidenceTier: 'durationIntensity' })],
            [workout({ structured: { title: 't', comparison: { definitionId: 'd', revision: 1, title: 't', totalPlannedSteps: 0, completedStepsCount: 0, missingRequiredStepsCount: 0, stepComparisons: [], summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 } } } })],
        );
        expect(diff.liveEvidenceTierCounts).toEqual({ garminTrainingEffect: 1, durationIntensity: 1 });
        expect(diff.canonicalEvidenceTierCounts).toEqual({ completedStructuredWorkout: 1 });
    });

    it('flags a live-linked activity that no canonical occurrence attaches as a source', () => {
        const diff = diffCompletedTrainingHistory(
            [liveEvent({ linkedActivityId: 'act-orphan' })],
            [],
        );
        expect(diff.liveActivityIdsMissingFromCanonical).toEqual(['act-orphan']);
        expect(diff.canonicalActivityIdsMissingFromLive).toEqual([]);
    });

    it('flags a canonical provider activity that no live event linked at all', () => {
        const diff = diffCompletedTrainingHistory(
            [],
            [workout({ garmin: { activityId: 'act-canonical-only', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' } })],
        );
        expect(diff.canonicalActivityIdsMissingFromLive).toEqual(['act-canonical-only']);
        expect(diff.liveActivityIdsMissingFromCanonical).toEqual([]);
    });

    it('does not flag an activity id both sides agree on', () => {
        const diff = diffCompletedTrainingHistory(
            [liveEvent({ linkedActivityId: 'act-1' })],
            [workout({ garmin: { activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' } })],
        );
        expect(diff.liveActivityIdsMissingFromCanonical).toEqual([]);
        expect(diff.canonicalActivityIdsMissingFromLive).toEqual([]);
    });
});
