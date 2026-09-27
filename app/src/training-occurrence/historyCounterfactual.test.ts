import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from '../engine/trainingHistory';
import { compareCompletedExposureSets, compareRecommendationOutputs } from './historyCounterfactual';

function exposure(overrides: Partial<CompletedExposure> = {}): CompletedExposure {
    return {
        occurrenceKey: 'occ-1',
        date: '2026-09-01',
        costProfile: { systemic: 0.4, cardiovascular: 0.2, lowerBody: 0.5, upperBody: 0.1, impactTissue: 0.3, neuromuscular: 0.2 },
        trainingRecordLike: { type: 'Strength', duration_min: 45, training_effect: 0, intensity_tag: 'hard' },
        deliveredDose: { plannedDurationMin: 45, completedDurationMin: 40, completionRatio: 0.89 },
        stimulusProfile: { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.7, hypertrophy: 0.5 },
        stimulusConfidence: 'exact',
        templateId: 'strength-heavy',
        modality: 'Strength',
        ...overrides,
    };
}

describe('compareCompletedExposureSets', () => {
    it('compares all cost and stimulus dimensions and reports unknown canonical rows without inventing values', () => {
        const result = compareCompletedExposureSets(
            [exposure()],
            [exposure({ occurrenceKey: 'occ-2', costProfile: { systemic: 0.5, cardiovascular: 0.2, lowerBody: 0.5, upperBody: 0.1, impactTissue: 0.3, neuromuscular: 0.2 }, deliveredDose: undefined, stimulusConfidence: 'inferred' })],
            ['occ-unknown'],
        );

        expect(result.countDelta).toBe(0);
        expect(result.costTotals.systemic.delta).toBeCloseTo(0.1);
        expect(result.deliveredDose).toEqual({
            liveKnown: 1, canonicalKnown: 0,
            livePlannedMinutesKnown: 1, canonicalPlannedMinutesKnown: 0,
            livePlannedMinutes: 45, canonicalPlannedMinutes: 0, deltaPlannedMinutes: null,
            liveCompletedMinutesKnown: 1, canonicalCompletedMinutesKnown: 0,
            liveCompletedMinutes: 40, canonicalCompletedMinutes: 0, deltaCompletedMinutes: null,
            liveCompletionRatioKnown: 1, canonicalCompletionRatioKnown: 0,
            liveMeanCompletionRatio: 0.89, canonicalMeanCompletionRatio: null, deltaMeanCompletionRatio: null,
        });
        expect(result.stimulusTotals.maxStrength.delta).toBe(0);
        expect(result.stimulusConfidence).toEqual({ live: { exact: 1 }, canonical: { inferred: 1 } });
        expect(result.unknownCanonicalOccurrenceCount).toBe(1);
    });

    it('counts a matched physical occurrence once when each input set has one exposure', () => {
        const result = compareCompletedExposureSets([exposure()], [exposure()]);
        expect(result.liveCount).toBe(1);
        expect(result.canonicalCount).toBe(1);
        expect(result.countDelta).toBe(0);
    });

    it('keeps partially populated delivered-dose facts unknown instead of treating them as zero', () => {
        const result = compareCompletedExposureSets(
            [exposure()],
            [exposure({ deliveredDose: { plannedDurationMin: 45 } })],
        );

        expect(result.deliveredDose).toMatchObject({
            liveCompletedMinutesKnown: 1,
            canonicalCompletedMinutesKnown: 0,
            liveCompletedMinutes: 40,
            canonicalCompletedMinutes: 0,
            deltaCompletedMinutes: null,
            liveCompletionRatioKnown: 1,
            canonicalCompletionRatioKnown: 0,
            liveMeanCompletionRatio: 0.89,
            canonicalMeanCompletionRatio: null,
            deltaMeanCompletionRatio: null,
        });
        expect(result.perOccurrence[0]).toMatchObject({
            deliveredDosePlannedMinutesDelta: 0,
            deliveredDoseCompletedMinutesDelta: null,
            deliveredDoseCompletionRatioDelta: null,
        });
    });

    it('reports mean completion ratio rather than summing ratios across occurrences', () => {
        const result = compareCompletedExposureSets(
            [
                exposure({ occurrenceKey: 'occ-a', deliveredDose: { plannedDurationMin: 60, completedDurationMin: 30, completionRatio: 0.5 } }),
                exposure({ occurrenceKey: 'occ-b', deliveredDose: { plannedDurationMin: 60, completedDurationMin: 60, completionRatio: 1 } }),
            ],
            [
                exposure({ occurrenceKey: 'occ-a', deliveredDose: { plannedDurationMin: 60, completedDurationMin: 45, completionRatio: 0.75 } }),
                exposure({ occurrenceKey: 'occ-b', deliveredDose: { plannedDurationMin: 60, completedDurationMin: 60, completionRatio: 1 } }),
            ],
        );

        expect(result.deliveredDose).toMatchObject({
            livePlannedMinutes: 120,
            canonicalPlannedMinutes: 120,
            deltaPlannedMinutes: 0,
            liveCompletedMinutes: 90,
            canonicalCompletedMinutes: 105,
            deltaCompletedMinutes: 15,
            liveMeanCompletionRatio: 0.75,
            canonicalMeanCompletionRatio: 0.875,
            deltaMeanCompletionRatio: 0.125,
        });
    });

    it('treats workout and template identity as different evidence tiers even when the raw id string matches', () => {
        const result = compareCompletedExposureSets(
            [exposure({ workoutId: 'same-id', templateId: undefined })],
            [exposure({ workoutId: undefined, templateId: 'same-id' })],
        );

        expect(result.perOccurrence[0]).toMatchObject({
            status: 'matched',
            identityChanged: true,
        });
    });

    it('keeps missing recovery and stimulus dimensions unknown instead of reporting a zero delta', () => {
        const result = compareCompletedExposureSets(
            [exposure({ recoveryHours: undefined, stimulusProfile: undefined })],
            [exposure({ recoveryHours: undefined, stimulusProfile: undefined })],
        );

        expect(result.recoveryHours).toMatchObject({ liveKnown: 0, canonicalKnown: 0, delta: null });
        expect(result.stimulusTotals.aerobicEndurance).toMatchObject({ liveKnown: 0, canonicalKnown: 0, delta: null });
    });

    it('preserves per-occurrence cost and date deltas when equal aggregate totals hide a temporal swap', () => {
        const live = [
            exposure({ occurrenceKey: 'occ-early', date: '2026-08-01', costProfile: { systemic: 0.2, cardiovascular: 0.2, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.2, neuromuscular: 0.2 } }),
            exposure({ occurrenceKey: 'occ-late', date: '2026-08-08', costProfile: { systemic: 0.8, cardiovascular: 0.2, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.2, neuromuscular: 0.2 } }),
        ];
        const canonical = [
            exposure({ occurrenceKey: 'occ-early', date: '2026-08-01', costProfile: { systemic: 0.8, cardiovascular: 0.2, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.2, neuromuscular: 0.2 } }),
            exposure({ occurrenceKey: 'occ-late', date: '2026-08-08', costProfile: { systemic: 0.2, cardiovascular: 0.2, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.2, neuromuscular: 0.2 } }),
        ];

        const result = compareCompletedExposureSets(live, canonical);
        expect(result.costTotals.systemic.delta).toBe(0);
        expect(result.perOccurrence[0].costDelta?.systemic).toBeCloseTo(0.6);
        expect(result.perOccurrence[1].costDelta?.systemic).toBeCloseTo(-0.6);
        expect(result.duplicateOccurrenceKeys).toEqual({ live: 0, canonical: 0 });
    });
});

describe('compareRecommendationOutputs', () => {
    it('is deterministic and names every changed decision projection field', () => {
        const live = { mode: 'train', selectedTemplate: 'easy-ride', dose: { minutes: 45 }, coverage: ['a'], sequence: 'endurance', fatigue: 0.4, guardrails: [] };
        const canonical = { mode: 'modify', selectedTemplate: 'recovery-ride', dose: { minutes: 30 }, coverage: ['a'], sequence: 'endurance', fatigue: 0.7, guardrails: ['fatigue'] };

        const first = compareRecommendationOutputs(live, canonical);
        expect(first).toEqual(compareRecommendationOutputs(live, canonical));
        expect(first).toMatchObject({ verdict: true, mode: true, selectedTemplate: true, dose: true, fatigue: true, guardrails: true, classification: 'unresolved' });
        expect(first.changedFields).toEqual(['dose', 'fatigue', 'guardrails', 'mode', 'selectedTemplate']);
    });

    it('reports an unchanged replay when only object key order differs', () => {
        expect(compareRecommendationOutputs({ dose: { min: 1, max: 2 } }, { dose: { max: 2, min: 1 } }).classification).toBe('unchanged');
    });

    it('maps explicit verdict and coverage projection changes to their decision categories', () => {
        expect(compareRecommendationOutputs({ verdict: 'train', coverage: ['strength'] }, { verdict: 'modify', coverage: ['endurance'] })).toMatchObject({
            verdict: true,
            coverage: true,
            changedFields: ['coverage', 'verdict'],
        });
    });
});
