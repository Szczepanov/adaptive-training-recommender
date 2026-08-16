import { describe, expect, it } from 'vitest';
import {
    computeSubjectiveBaseline,
    REFERENCE_SUBJECTIVE_BASELINE_POLICY,
    SUBJECTIVE_BASELINE_METRICS,
    type SubjectiveBaselinePolicy,
} from './subjectiveBaseline';
import type { DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

const AS_OF = '2026-08-16';

function completeCheckin(date: string, values: Partial<Record<typeof SUBJECTIVE_BASELINE_METRICS[number], number>> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1', date,
        readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, mentalStress: 4, motivation: 6,
        ...values,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: `${date}T06:00:00Z`, updatedAt: `${date}T06:00:00Z`,
    };
}

function partialSafetyCheckin(date: string): DailySubjectiveCheckin {
    return {
        userId: 'u1', date,
        readiness: null, sleepQuality: null, fatigue: null, soreness: null, mentalStress: null, motivation: null,
        painOrInjury: true, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: false, missingFields: ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation', 'timeAvailableMin'] },
        schemaVersion: 1, createdAt: `${date}T06:00:00Z`, updatedAt: `${date}T06:00:00Z`,
    };
}

/** 40 consecutive complete check-ins ending the day before `asOfDate`, so both the
 *  7-day recent window and the 28-day long window clear the reference policy's coverage
 *  floors with room to spare. */
function fullHistory(asOfDate: string, values: Partial<Record<typeof SUBJECTIVE_BASELINE_METRICS[number], number>> = {}): DailySubjectiveCheckin[] {
    return Array.from({ length: 40 }, (_, i) => completeCheckin(addDaysToLocalDateString(asOfDate, -(40 - i)), values));
}

describe('computeSubjectiveBaseline', () => {
    it('is a pure function -- same inputs produce a deep-equal result and never mutate the input', () => {
        const checkins = fullHistory(AS_OF);
        const snapshot = JSON.stringify(checkins);
        const first = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        const second = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(first).toEqual(second);
        expect(JSON.stringify(checkins)).toBe(snapshot);
    });

    it('excludes a check-in dated exactly asOfDate (D-SUBJHIST)', () => {
        const checkins = fullHistory(AS_OF);
        // A wildly different value dated exactly asOfDate must not move the baseline at all.
        checkins.push(completeCheckin(AS_OF, { readiness: 1, sleepQuality: 1, fatigue: 10, soreness: 10, mentalStress: 10, motivation: 1 }));
        const withoutToday = computeSubjectiveBaseline(fullHistory(AS_OF), AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        const withToday = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(withToday).toEqual(withoutToday);
        expect(withToday!.recentRecordedDays).toBe(withoutToday!.recentRecordedDays);
    });

    it('excludes check-ins dated on or after asOfDate from lastObservationDate too', () => {
        const checkins = [...fullHistory(AS_OF), completeCheckin(AS_OF), completeCheckin(addDaysToLocalDateString(AS_OF, 1))];
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result!.lastObservationDate).toBe(addDaysToLocalDateString(AS_OF, -1));
    });

    it('duplicate documents for the same date collapse to one and cannot inflate coverage', () => {
        const checkins = fullHistory(AS_OF);
        const duplicated = [...checkins, ...checkins, ...checkins]; // triplicate every date
        const result = computeSubjectiveBaseline(duplicated, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        const baseline = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result!.recentRecordedDays).toBe(baseline!.recentRecordedDays);
        expect(result!.longRecordedDays).toBe(baseline!.longRecordedDays);
    });

    it('partial safety-only check-ins do not count toward coverage or inflate it', () => {
        // Fewer complete days than the coverage floor requires, padded with partial
        // safety-only submissions on every other day -- if these counted, coverage would
        // look satisfied when the athlete has barely scored anything.
        const checkins: DailySubjectiveCheckin[] = [];
        for (let i = 1; i <= 28; i++) {
            const date = addDaysToLocalDateString(AS_OF, -i);
            checkins.push(i % 4 === 0 ? completeCheckin(date) : partialSafetyCheckin(date));
        }
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result).toBeNull();
    });

    it('returns null when recent coverage is insufficient even if long coverage is not', () => {
        const checkins = fullHistory(AS_OF);
        // Remove every complete check-in from the most recent 7 days, leaving the 28-day
        // long window well covered but the 7-day recent window empty.
        const withoutRecent = checkins.filter(c => c.date < addDaysToLocalDateString(AS_OF, -7));
        const result = computeSubjectiveBaseline(withoutRecent, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result).toBeNull();
    });

    it('returns null when long coverage is insufficient even if recent coverage is not', () => {
        // Only the 7 most recent days are recorded -- clears the recent floor (4) but not
        // the long floor (10).
        const checkins = Array.from({ length: 7 }, (_, i) => completeCheckin(addDaysToLocalDateString(AS_OF, -(7 - i))));
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result).toBeNull();
    });

    it('floors zero-variance history at the policy variability floor rather than reporting zero', () => {
        const checkins = fullHistory(AS_OF); // every day identical -> population stdev is exactly 0
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        for (const metric of SUBJECTIVE_BASELINE_METRICS) {
            expect(result!.metrics[metric].variability).toBe(REFERENCE_SUBJECTIVE_BASELINE_POLICY.variabilityFloor);
        }
    });

    it('reports genuine variability above the floor when the history actually varies', () => {
        const checkins = fullHistory(AS_OF).map((c, i) => ({ ...c, readiness: i % 2 === 0 ? 4 : 8 }));
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result!.metrics.readiness.variability).toBeGreaterThan(REFERENCE_SUBJECTIVE_BASELINE_POLICY.variabilityFloor);
    });

    it('computes recentAvg and longAvg correctly from known fixture values', () => {
        // Long window (28d): all days at readiness 6, except the recent window (7d) is
        // overridden to readiness 8.
        const checkins = fullHistory(AS_OF).map(c => {
            const isRecent = c.date >= addDaysToLocalDateString(AS_OF, -7);
            return isRecent ? { ...c, readiness: 8 } : c;
        });
        const result = computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result!.metrics.readiness.recentAvg).toBeCloseTo(8, 5);
        // The long window includes the 7 recent (readiness 8) days plus 21 older (readiness
        // 6) days: (7*8 + 21*6) / 28 = 6.5.
        expect(result!.metrics.readiness.longAvg).toBeCloseTo(6.5, 5);
    });

    it('restates estimatorId and the exclusive history boundary on the output', () => {
        const result = computeSubjectiveBaseline(fullHistory(AS_OF), AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(result!.estimatorId).toBe(REFERENCE_SUBJECTIVE_BASELINE_POLICY.estimatorId);
        expect(result!.historyThroughDateExclusive).toBe(AS_OF);
    });

    it('returns null with no history at all rather than a neutral/default baseline', () => {
        expect(computeSubjectiveBaseline([], AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY)).toBeNull();
    });

    it("respects a custom policy's window/coverage parameters, not hardcoded reference values", () => {
        const tightPolicy: SubjectiveBaselinePolicy = {
            estimatorId: 'test-tight', recentWindowDays: 3, longWindowDays: 5,
            minRecentRecordedDays: 3, minLongRecordedDays: 5,
            variabilityFloor: 0.5, contributionCap: 1.0,
        };
        // Reference policy would fail (only 5 days of history); the tight policy should not.
        const checkins = Array.from({ length: 5 }, (_, i) => completeCheckin(addDaysToLocalDateString(AS_OF, -(5 - i))));
        expect(computeSubjectiveBaseline(checkins, AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY)).toBeNull();
        const result = computeSubjectiveBaseline(checkins, AS_OF, tightPolicy);
        expect(result).not.toBeNull();
        expect(result!.recentRecordedDays).toBe(3);
        expect(result!.longRecordedDays).toBe(5);
    });

    it('computes all six subjective dimensions, not only readiness', () => {
        const result = computeSubjectiveBaseline(fullHistory(AS_OF), AS_OF, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
        expect(Object.keys(result!.metrics).sort()).toEqual([...SUBJECTIVE_BASELINE_METRICS].sort());
    });
});

describe('REFERENCE_SUBJECTIVE_BASELINE_POLICY', () => {
    it('matches the reference values documented in phase-9-subjective-baselines.md 9.1', () => {
        expect(REFERENCE_SUBJECTIVE_BASELINE_POLICY.recentWindowDays).toBe(7);
        expect(REFERENCE_SUBJECTIVE_BASELINE_POLICY.longWindowDays).toBe(28);
        expect(REFERENCE_SUBJECTIVE_BASELINE_POLICY.variabilityFloor).toBe(1.0);
        expect(REFERENCE_SUBJECTIVE_BASELINE_POLICY.contributionCap).toBe(2.0);
    });
});
