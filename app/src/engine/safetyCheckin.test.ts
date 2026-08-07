import { describe, expect, it } from 'vitest';
import type { DailySubjectiveCheckin } from './models';
import {
    canGenerateNormalRecommendation,
    createProvisionalSafetyRecommendation,
    getMinimumSafetyCheckinStatus,
} from './safetyCheckin';

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete',
        date: '2026-08-07',
        readiness: null,
        sleepQuality: null,
        fatigue: 5,
        soreness: null,
        mentalStress: null,
        motivation: null,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: '2026-08-07T06:00:00.000Z',
        dataQuality: { isComplete: false, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-08-07T06:00:00.000Z',
        updatedAt: '2026-08-07T06:00:00.000Z',
        ...overrides,
    };
}

describe('minimum safety check-in', () => {
    it('requires an existing check-in', () => {
        expect(getMinimumSafetyCheckinStatus(null)).toBe('missing');
    });

    it('permits normal engine evaluation from the minimum safety subset without requiring the full survey', () => {
        const status = getMinimumSafetyCheckinStatus(checkin());
        expect(status).toBe('complete');
        expect(canGenerateNormalRecommendation(status)).toBe(true);
    });

    it('does not mistake omitted safety booleans for false', () => {
        const status = getMinimumSafetyCheckinStatus(checkin({ alreadyTrainedToday: undefined as unknown as boolean }));
        expect(status).toBe('incomplete');
        expect(canGenerateNormalRecommendation(status)).toBe(false);
    });

    it('requires either fatigue or soreness to be an in-range answer', () => {
        expect(getMinimumSafetyCheckinStatus(checkin({ fatigue: null, soreness: null }))).toBe('incomplete');
        expect(getMinimumSafetyCheckinStatus(checkin({ fatigue: null, soreness: 7 }))).toBe('complete');
    });

    it('returns an unpersisted rest-only fallback while safety state is unknown', () => {
        const recommendation = createProvisionalSafetyRecommendation('missing');
        expect(recommendation.template.category).toBe('Rest');
        expect(recommendation.mode).toBe('recover');
        expect(recommendation.envelopes?.plan.maxAllowableTier).toBe('Rest');
    });
});
