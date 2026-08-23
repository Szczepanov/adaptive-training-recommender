import { describe, expect, it } from 'vitest';
import { buildContextBrief, type ContextBriefInput } from './contextBrief';
import type { DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

const AS_OF = '2026-08-15';

function checkin(date: string, readiness: number): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness,
        sleepQuality: 7,
        fatigue: 4,
        soreness: 3,
        mentalStress: 4,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 75, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${date}T06:30:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T06:30:00Z`,
        updatedAt: `${date}T06:30:00Z`,
    };
}

function input(checkins: DailySubjectiveCheckin[]): ContextBriefInput {
    return {
        asOfDate: AS_OF,
        windowDays: 2,
        snapshots: [],
        checkins,
        activities: [],
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        intentProfile: null,
    };
}

describe('daily context brief subjective baseline', () => {
    it('uses the latest check-in as the point reading instead of averaging today with D-1', () => {
        const checkins = Array.from({ length: 28 }, (_, offset) => {
            const date = addDaysToLocalDateString(AS_OF, -offset);
            const readiness = offset === 0 ? 2 : offset === 1 ? 10 : 7;
            return checkin(date, readiness);
        });

        const text = buildContextBrief(input(checkins));

        expect(text).toContain('This is a single reading, not a trend');
        expect(text).toContain('Readiness: 2 vs 6.9 (-4.9, worse than baseline)');
        expect(text).not.toContain('Readiness: 6 vs 6.9');
    });

    it('labels the actual check-in date when the current day has no subjective check-in', () => {
        const checkins = Array.from({ length: 28 }, (_, offset) => {
            const date = addDaysToLocalDateString(AS_OF, -(offset + 1));
            return checkin(date, 7);
        });

        const text = buildContextBrief(input(checkins));

        expect(text).toContain('Most recent check-in (2026-08-14) vs this athlete\'s own trailing 28-day baseline');
        expect(text).not.toContain('Today vs this athlete\'s own trailing 28-day baseline');
    });
});
