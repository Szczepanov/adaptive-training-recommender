import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity } from '../engine/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { compareActivitiesReadModels } from './activitiesReadModelDiagnostics';

function activity(id: string): NormalizedGarminActivity {
    return { activityId: id, date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' };
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

describe('compareActivitiesReadModels', () => {
    it('reports a positive duplicateDelta when two raw Garmin rows collapse into one matched canonical row', () => {
        // Only act-1 is actually hydrated as the canonical row's Garmin source -- act-2
        // (e.g. a duplicate provider import Adaptive matched away) still counts as
        // "collapsed" because it's absent from the canonical Garmin-id set.
        const current = [activity('act-1'), activity('act-2')];
        const canonical = [workout({ sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] }, garmin: activity('act-1') })];

        const comparison = compareActivitiesReadModels(current, canonical);

        expect(comparison.currentRowCount).toBe(2);
        expect(comparison.canonicalRowCount).toBe(1);
        expect(comparison.rowCountDelta).toBe(-1);
        expect(comparison.matchedCount).toBe(1);
        expect(comparison.duplicateDelta).toBe(1);
    });

    it('reports zero duplicateDelta when nothing was deduplicated', () => {
        const current = [activity('act-1')];
        const canonical = [workout({ garmin: activity('act-1') })];

        const comparison = compareActivitiesReadModels(current, canonical);

        expect(comparison.duplicateDelta).toBe(0);
        expect(comparison.garminOnlyCount).toBe(1);
    });

    it('does not count an adjacent-day hydrated Garmin activity as a duplicate of an unrelated current-range row', () => {
        // The canonical row's Garmin source (act-adjacent) falls outside the exact
        // current-range fetch entirely -- it must never be treated as accounting for
        // act-1, which is a completely different, unrelated activity.
        const current = [activity('act-1')];
        const canonical = [workout({ localDate: '2026-08-20', garmin: { ...activity('act-adjacent'), date: '2026-08-19' } })];

        const comparison = compareActivitiesReadModels(current, canonical);

        expect(comparison.duplicateDelta).toBe(1); // act-1 unaccounted for by any in-range canonical Garmin id
    });

    it('does not let a generic non-Garmin provider row account for a current-range Garmin activity', () => {
        const current = [activity('act-1')];
        const canonical = [workout({ sourceBadge: { hasStructured: false, hasProvider: true, providers: ['polar'] } })]; // no .garmin hydrated
        const comparison = compareActivitiesReadModels(current, canonical);
        expect(comparison.duplicateDelta).toBe(1);
    });

    it('counts structured-only and ambiguous occurrences correctly', () => {
        const canonical = [
            workout({ performedOccurrenceId: 'pto-structured', sourceBadge: { hasStructured: true, hasProvider: false, providers: [] } }),
            workout({ performedOccurrenceId: 'pto-ambiguous', reconciliation: { state: 'ambiguous' } }),
        ];

        const comparison = compareActivitiesReadModels([], canonical);

        expect(comparison.structuredOnlyCount).toBe(1);
        expect(comparison.ambiguousCount).toBe(1);
    });
});
