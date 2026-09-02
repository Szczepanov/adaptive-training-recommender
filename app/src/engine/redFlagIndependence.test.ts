import { describe, expect, it } from 'vitest';
import { mapCheckinToSubjectiveInput } from './adapters';
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
        alreadyTrainedToday: false,
        availability: {
            timeAvailableMin: 60,
            preferredModalityToday: null,
            indoorOnly: false,
        },
        notes: null,
        submittedAt: '2026-09-01T06:00:00.000Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-09-01T06:00:00.000Z',
        updatedAt: '2026-09-01T06:00:00.000Z',
        ...overrides,
    } as DailySubjectiveCheckin;
}

describe('SEP-C4 red flags are independent from pain/injury', () => {
    it('maps an explicit red flag even when painOrInjury is false', () => {
        const input = mapCheckinToSubjectiveInput(checkin({
            painOrInjury: false,
            redFlags: { present: true, categories: ['neurological'] },
        }));

        expect(input.clinicalEnvelopeSources).toContain('red_flag');
        expect(input.clinicalEnvelopeSources).not.toContain('pain_or_injury');
        expect(input.redFlagFindings).toHaveLength(1);
        expect(input.redFlagFindings?.[0]?.category).toBe('neurological');
        expect(input.painFlag).toBe(true);
    });
});
