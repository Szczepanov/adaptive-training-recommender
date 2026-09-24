import { describe, expect, it } from 'vitest';
import { manualLinkCandidatesFor, sourceBadgeFor, type CompletedWorkoutView } from './completedWorkoutView';

describe('sourceBadgeFor', () => {
    it('reports structured-only', () => {
        const badge = sourceBadgeFor({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }] });
        expect(badge).toEqual({ hasStructured: true, hasProvider: false, providers: [] });
    });

    it('reports provider-only with a deduped provider list', () => {
        const badge = sourceBadgeFor({
            sourceRefs: [
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-2' },
            ],
        });
        expect(badge).toEqual({ hasStructured: false, hasProvider: true, providers: ['garmin'] });
    });

    it('reports matched (both) sources', () => {
        const badge = sourceBadgeFor({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        });
        expect(badge).toEqual({ hasStructured: true, hasProvider: true, providers: ['garmin'] });
    });
});

describe('manualLinkCandidatesFor', () => {
    const garminActivity = { activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 45, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: 118, activityTrainingLoad: null, intensityTag: 'moderate' };
    const structured: CompletedWorkoutView = {
        performedOccurrenceId: 'pto-structured',
        sourceKeys: ['structured_execution:exec-1'],
        localDate: '2026-08-26',
        modality: 'strength',
        sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
        reconciliation: { state: 'single_source' },
        garminExerciseSetsAreDiagnosticOnly: true,
    };
    const garminOnly: CompletedWorkoutView = {
        performedOccurrenceId: 'pto-garmin',
        sourceKeys: ['provider_activity:garmin:act-1'],
        localDate: '2026-08-26',
        modality: 'strength',
        sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
        reconciliation: { state: 'ambiguous' },
        garmin: garminActivity,
        garminExerciseSetsAreDiagnosticOnly: false,
    };

    it('offers a same-day Garmin-only workout for a structured-only workout', () => {
        expect(manualLinkCandidatesFor(structured, [structured, garminOnly])).toEqual([
            { providerOccurrenceId: 'pto-garmin', activity: garminActivity },
        ]);
    });

    it('offers nothing on the Garmin row itself, on another day, or across a known modality conflict', () => {
        expect(manualLinkCandidatesFor(garminOnly, [structured, garminOnly])).toEqual([]);
        expect(manualLinkCandidatesFor(structured, [structured, { ...garminOnly, localDate: '2026-08-25' }])).toEqual([]);
        expect(manualLinkCandidatesFor(structured, [structured, { ...garminOnly, modality: 'cycling' }])).toEqual([]);
    });

    it('never re-offers a pair the athlete previously unlinked (sticky exclusion on either side)', () => {
        const unlinkedOnStructured = { ...structured, reconciliation: { state: 'single_source' as const, excludedSourceKeys: ['provider_activity:garmin:act-1'] } };
        const unlinkedOnGarmin = { ...garminOnly, reconciliation: { state: 'single_source' as const, excludedSourceKeys: ['structured_execution:exec-1'] } };
        expect(manualLinkCandidatesFor(unlinkedOnStructured, [unlinkedOnStructured, garminOnly])).toEqual([]);
        expect(manualLinkCandidatesFor(structured, [structured, unlinkedOnGarmin])).toEqual([]);
    });
});
