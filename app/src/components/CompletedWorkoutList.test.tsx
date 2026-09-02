import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { CompletedWorkoutList } from './CompletedWorkoutList';

const structuredOnly: CompletedWorkoutView = {
    performedOccurrenceId: 'pto-1',
    localDate: '2026-08-26',
    startedAt: '2026-08-26T06:52:00.000Z',
    endedAt: '2026-08-26T07:32:00.000Z',
    sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
    reconciliation: { state: 'single_source' },
    structured: {
        title: 'Heavy Squat Day',
        comparison: {
            definitionId: 'w-1', revision: 1, title: 'Heavy Squat Day',
            totalPlannedSteps: 2, completedStepsCount: 2, missingRequiredStepsCount: 0,
            stepComparisons: [
                { stepId: 's1', blockId: 'b1', stepTitle: 'Back Squat', isOptional: false, targetSets: 5, completedSets: 5, isComplete: true, entries: [] },
            ],
            summary: { totalReps: 25, totalTonnageKg: 3000, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        },
    },
    garminExerciseSetsAreDiagnosticOnly: true,
};

const matched: CompletedWorkoutView = {
    ...structuredOnly,
    performedOccurrenceId: 'pto-2',
    sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] },
    reconciliation: { state: 'matched', matcherVersion: 'matcher-v1', confidence: 0.9 },
    garmin: {
        activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40,
        trainingEffectAerobic: 2.1, trainingEffectAnaerobic: 1.0, averageHr: 120,
        activityTrainingLoad: 90, intensityTag: 'moderate',
        exerciseSets: [{ setOrder: 0, setType: 'active', exerciseName: 'wrong_exercise_guess', repetitionCount: 3, weightKg: 40 }],
    },
};

describe('CompletedWorkoutList', () => {
    it('shows a loading state', () => {
        expect(renderToStaticMarkup(<CompletedWorkoutList workouts={null} />)).toContain('Loading');
    });

    it('shows an empty state', () => {
        expect(renderToStaticMarkup(<CompletedWorkoutList workouts={[]} />)).toContain('No workouts');
    });

    it('renders a structured-only workout with the Adaptive Coach badge and step comparison', () => {
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[structuredOnly]} />);
        expect(html).toContain('Heavy Squat Day');
        expect(html).toContain('Adaptive Coach');
        expect(html).toContain('Back Squat');
        expect(html).not.toContain('Adaptive Coach +');
    });

    it('renders a matched workout once, with the combined source badge, and marks Garmin exercise sets as diagnostic-only', () => {
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[matched]} />);
        expect(html.match(/activity-telemetry-card/g)?.length).toBe(1); // one card, not two
        expect(html).toContain('Adaptive Coach + Garmin');
        expect(html).toContain('Garmin-detected sets (diagnostic only)');
        expect(html).not.toContain('>Strength sets & reps<');
    });

    it('surfaces the ambiguous state for provenance inspection instead of hiding it', () => {
        const ambiguous: CompletedWorkoutView = { ...structuredOnly, reconciliation: { state: 'ambiguous' } };
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[ambiguous]} />);
        expect(html).toContain('Ambiguous match');
    });

    it('shows the Garmin unlink affordance only when an actual Garmin source is hydrated', () => {
        const unlink = vi.fn();
        const garminHtml = renderToStaticMarkup(<CompletedWorkoutList workouts={[matched]} onUnlinkSource={unlink} />);
        expect(garminHtml).toContain('Unlink Garmin source');

        const nonGarminMatched: CompletedWorkoutView = {
            ...structuredOnly,
            performedOccurrenceId: 'pto-nongarmin',
            sourceBadge: { hasStructured: true, hasProvider: true, providers: ['polar'] },
            reconciliation: { state: 'matched' },
        };
        const nonGarminHtml = renderToStaticMarkup(<CompletedWorkoutList workouts={[nonGarminMatched]} onUnlinkSource={unlink} />);
        expect(nonGarminHtml).not.toContain('Unlink Garmin source');
    });
});
