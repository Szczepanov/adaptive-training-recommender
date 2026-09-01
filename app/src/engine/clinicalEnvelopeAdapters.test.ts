import { describe, expect, it } from 'vitest';
import {
    mapCheckinToSubjectiveInput,
    resolveClinicalEnvelopeSources,
    resolvePainOrInjuryRegionFamilies,
} from './adapters';
import type { DailySubjectiveCheckin } from './models';

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete',
        date: '2026-09-01',
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: '2026-09-01T06:00:00.000Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-09-01T06:00:00.000Z',
        updatedAt: '2026-09-01T06:00:00.000Z',
        ...overrides,
    };
}

describe('SEP-C1 clinical-envelope normalization', () => {
    it('maps today\'s shoulder tissue response to upper-limb current-pain context', () => {
        const today = checkin({
            painOrInjury: true,
            tissueResponses: {
                shoulder: { region: 'shoulder', morningState: 'moderate' },
            },
        });

        expect(resolvePainOrInjuryRegionFamilies(today)).toEqual(['upper_limb_loading']);
        expect(mapCheckinToSubjectiveInput(today)).toMatchObject({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: ['upper_limb_loading'],
        });
    });

    it('deduplicates and sorts mixed current pain region families deterministically', () => {
        const today = checkin({
            painOrInjury: true,
            tissueResponses: {
                shoulder: { region: 'shoulder', morningState: 'mild' },
                wrist: { region: 'wrist', morningState: 'mild' },
                knee: { region: 'knee', morningState: 'moderate' },
            },
        });

        expect(resolvePainOrInjuryRegionFamilies(today)).toEqual([
            'lower_limb_impact',
            'upper_limb_loading',
        ]);
    });

    it('keeps unstructured pain location explicitly unknown', () => {
        const today = checkin({ painOrInjury: true });
        const mapped = mapCheckinToSubjectiveInput(today);

        expect(mapped.clinicalEnvelopeSources).toEqual(['pain_or_injury']);
        expect(mapped.painOrInjuryRegionFamilies).toEqual([]);
    });

    it('ignores stale tissue-response detail when painOrInjury is false', () => {
        const today = checkin({
            painOrInjury: false,
            tissueResponses: {
                shoulder: { region: 'shoulder', morningState: 'mild' },
            },
        });

        expect(resolvePainOrInjuryRegionFamilies(today)).toEqual([]);
        expect(mapCheckinToSubjectiveInput(today).painOrInjuryRegionFamilies).toEqual([]);
    });

    it('does not create pain location from illness-only input', () => {
        const today = checkin({ illnessSymptoms: true });

        expect(resolveClinicalEnvelopeSources(today)).toEqual(['non_allergy_illness']);
        expect(resolvePainOrInjuryRegionFamilies(today)).toEqual([]);
        expect(mapCheckinToSubjectiveInput(today)).toMatchObject({
            painFlag: true,
            clinicalEnvelopeSources: ['non_allergy_illness'],
            painOrInjuryRegionFamilies: [],
        });
    });

    it('normalizes a missing check-in to no clinical source and no pain region context', () => {
        expect(mapCheckinToSubjectiveInput(null)).toMatchObject({
            painFlag: false,
            clinicalEnvelopeSources: [],
            painOrInjuryRegionFamilies: [],
        });
    });
});
