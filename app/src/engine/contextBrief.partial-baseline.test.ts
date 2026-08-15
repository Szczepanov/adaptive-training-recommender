import { describe, expect, it } from 'vitest';
import { buildContextBrief, type ContextBriefInput } from './contextBrief';
import type { DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

const AS_OF = '2026-08-15';

function partialCheckin(date: string): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness: null,
        sleepQuality: null,
        fatigue: null,
        soreness: null,
        mentalStress: null,
        motivation: null,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: {
            timeAvailableMin: null,
            preferredModalityToday: null,
            indoorOnly: false,
        },
        notes: null,
        submittedAt: `${date}T06:30:00Z`,
        dataQuality: {
            isComplete: false,
            missingFields: ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'],
        },
        schemaVersion: 1,
        createdAt: `${date}T06:30:00Z`,
        updatedAt: `${date}T06:30:00Z`,
    };
}

describe('context brief subjective baseline coverage', () => {
    it('does not mature a scored baseline from partial safety-only check-ins', () => {
        const checkins = Array.from(
            { length: 10 },
            (_, offset) => partialCheckin(addDaysToLocalDateString(AS_OF, -offset)),
        );
        const input: ContextBriefInput = {
            asOfDate: AS_OF,
            windowDays: 14,
            snapshots: [],
            checkins,
            activities: [],
            recommendations: [],
            trainingSettings: null,
            preferences: null,
            intentProfile: null,
        };

        const text = buildContextBrief(input);

        expect(text).toContain('No 28-day subjective baseline: only 0 of 28 days recorded (minimum 10)');
        expect(text).not.toContain('trailing 28-day baseline (10 of 28 days recorded)');
    });
});
