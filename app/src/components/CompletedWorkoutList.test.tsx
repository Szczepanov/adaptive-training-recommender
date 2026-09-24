import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { CompletedWorkoutList } from './CompletedWorkoutList';

const structuredOnly: CompletedWorkoutView = {
    performedOccurrenceId: 'pto-1',
    sourceKeys: ['structured_execution:exec-1'],
    localDate: '2026-08-26',
    modality: 'strength',
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
        steps: [
            {
                stepId: 's1', title: 'Back Squat', isOptional: false,
                prescribed: { sets: 5, reps: 5, load: { kind: 'mass', kg: 120 }, effort: { rir: 2 }, restSeconds: 180 },
                sets: [
                    { entryId: 'w1', setNumber: 1, isWarmup: true, completedAt: '2026-08-26T06:55:00.000Z', payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 60, isWarmup: true } },
                    {
                        entryId: 'e1', setNumber: 1, isWarmup: false, completedAt: '2026-08-26T07:00:00.000Z',
                        payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 120, gauge: { scale: 'rir', value: 2 } },
                        rest: { prescribedSeconds: 180, actualSeconds: 205, endReason: 'next_set_started' },
                    },
                    {
                        entryId: 'e2', setNumber: 2, isWarmup: false, completedAt: '2026-08-26T07:04:00.000Z',
                        payload: { kind: 'repetition', setIndex: 2, reps: 4, weightKg: 120 },
                        rest: { prescribedSeconds: 180, actualSeconds: 1500, endReason: 'session_ended' },
                    },
                ],
            },
        ],
        hasPerformedRest: true,
    },
    garminExerciseSetsAreDiagnosticOnly: true,
};

const matched: CompletedWorkoutView = {
    ...structuredOnly,
    performedOccurrenceId: 'pto-2',
    sourceKeys: ['structured_execution:exec-1', 'provider_activity:garmin:act-1'],
    sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] },
    reconciliation: { state: 'matched', matcherVersion: 'matcher-v1', confidence: 0.9 },
    garmin: {
        activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40,
        trainingEffectAerobic: 2.1, trainingEffectAnaerobic: 1.0, averageHr: 120, maxHr: 158,
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

    it('renders the prescription, every logged set with load and effort, and actual vs target rest', () => {
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[structuredOnly]} />);
        expect(html).toContain('Target: 5 × 5 @ 120 kg · RIR 2 · rest 3:00');
        expect(html).toContain('Warm-up 1');
        expect(html).toContain('5 × 60 kg');
        expect(html).toContain('5 × 120 kg · RIR 2');
        expect(html).toContain('Rest 3:25 (target 3:00)');
        expect(html).toContain('4 × 120 kg');
        // Rest that ran into the end of the session is not between-set rest.
        expect(html).not.toContain('Rest 25:00');
        expect(html).not.toContain('actual rest not recorded');
    });

    it('says actual rest was not recorded instead of implying zero rest', () => {
        const legacy: CompletedWorkoutView = { ...structuredOnly, structured: { ...structuredOnly.structured!, hasPerformedRest: false } };
        expect(renderToStaticMarkup(<CompletedWorkoutList workouts={[legacy]} />)).toContain('actual rest not recorded for this session');
    });

    it('shows watch heart rate next to the structured sets and collapses Garmin-detected sets', () => {
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[matched]} />);
        expect(html).toContain('Avg 120 bpm · Max 158 bpm · 40 min recorded on watch');
        expect(html).toMatch(/<details class="activity-exercise-sets completed-workout-diagnostics"><summary>Garmin-detected sets \(diagnostic only\)<\/summary>/);
        expect(html.indexOf('Sets, reps &amp; rest')).toBeLessThan(html.indexOf('Heart rate'));
    });

    it('keeps Garmin sets as the primary listing for a Garmin-only strength workout', () => {
        const garminOnly: CompletedWorkoutView = {
            ...matched,
            performedOccurrenceId: 'pto-garmin',
            structured: undefined,
            sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
            garminExerciseSetsAreDiagnosticOnly: false,
        };
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[garminOnly]} />);
        expect(html).toContain('Strength sets &amp; reps');
        expect(html).not.toContain('diagnostic only');
    });

    it('offers a manual link from a structured-only workout to a same-day Garmin-only recording', () => {
        const garminOnly: CompletedWorkoutView = {
            ...matched,
            performedOccurrenceId: 'pto-garmin',
            sourceKeys: ['provider_activity:garmin:act-1'],
            structured: undefined,
            sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
            reconciliation: { state: 'ambiguous' },
            garminExerciseSetsAreDiagnosticOnly: false,
        };
        const link = vi.fn();
        const html = renderToStaticMarkup(<CompletedWorkoutList workouts={[structuredOnly, garminOnly]} onLinkSources={link} />);
        expect(html.match(/Link Garmin strength training/g)?.length).toBe(1);
        expect(html).toContain('40 min');
        expect(renderToStaticMarkup(<CompletedWorkoutList workouts={[structuredOnly, garminOnly]} />)).not.toContain('Link Garmin');
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
