import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';
import { renderHealthAnomalyReplayMarkdown, runHealthAnomalyReplay } from './healthAnomalyReplay';
import { addDaysToLocalDateString } from '../utils/localDate';

function snapshot(date: string, rhr = 50, hrv = 60, respiration = 14): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: {
            garminSyncedAt: `${date}T06:00:00Z`,
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
            metricDates: { sleep: date },
        },
        raw: {
            sleepScore: 85,
            sleepDurationSec: 8 * 3600,
            restingHr: rhr,
            hrvOvernightAvg: hrv,
            hrvStatus: null,
            respirationAvg: respiration,
            bodyBatteryWake: 70,
            bodyBatteryChange: 35,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
            stress: { avg: 25, max: 55 },
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 85,
            sleepScore28dAvg: 85,
            restingHr7dAvg: 50,
            restingHr28dAvg: 50,
            hrv7dAvg: 60,
            hrv28dAvg: 60,
            respiration7dAvg: 14,
            respiration28dAvg: 14,
            hrv28dStdev: 4,
            restingHr28dStdev: 2,
            sleepScore28dStdev: 4,
            respiration28dMad: 0.4,
            restingHr28dMedian: 50,
            restingHr28dMad: 2,
            hrv28dMedian: 60,
            hrv28dMad: 4,
            deltas: {
                sleepScoreVs7d: 0,
                sleepScoreVs28d: 0,
                restingHrVs7d: rhr - 50,
                restingHrVs28d: rhr - 50,
                hrvVs7d: hrv - 60,
                hrvVs28d: hrv - 60,
                respirationVs7d: respiration - 14,
                respirationVs28d: respiration - 14,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    } as DailyRecoverySnapshot;
}

function checkin(date: string, symptoms = false): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: symptoms,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${date}T06:05:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T06:05:00Z`,
        updatedAt: `${date}T06:05:00Z`,
    };
}

function dateAt(index: number): string {
    return addDaysToLocalDateString('2026-07-25', index);
}

describe('health anomaly replay', () => {
    it('keeps future symptoms as labels and never leaks them into the prior-day assessment', () => {
        const history = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 3), 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const watchDate = '2026-08-14';
        const symptomDate = '2026-08-15';
        const report = runHealthAnomalyReplay({
            days: [
                ...history,
                { date: watchDate, recoverySnapshot: snapshot(watchDate, 56, 48, 15.2), subjectiveCheckin: checkin(watchDate) },
                { date: symptomDate, recoverySnapshot: snapshot(symptomDate, 56, 48, 15.2), subjectiveCheckin: checkin(symptomDate, true) },
            ],
        });

        const prior = report.rows.find(row => row.date === watchDate);
        const symptomatic = report.rows.find(row => row.date === symptomDate);
        expect(prior?.symptomsReported).toBe(false);
        expect(prior?.futureSymptoms24h).toBe(true);
        expect(Object.values(prior?.assessmentStates ?? {}).every(result => result.state !== 'symptoms_reported')).toBe(true);
        expect(Object.values(symptomatic?.assessmentStates ?? {})[0]?.state).toBe('symptoms_reported');
    });

    it('does not count unusually high HRV as adverse corroboration for elevated respiration', () => {
        const history = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 50, 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const elevatedDate = dateAt(20);
        const report = runHealthAnomalyReplay({
            days: [
                ...history,
                {
                    date: elevatedDate,
                    recoverySnapshot: snapshot(elevatedDate, 50, 95, 15.5),
                    subjectiveCheckin: checkin(elevatedDate),
                },
            ],
        });

        const elevated = report.rows.find(row => row.date === elevatedDate);
        expect(elevated?.respirationElevation?.status).toBe('elevated');
        expect(elevated?.coreEvidence.find(item => item.signal === 'hrv')).toMatchObject({
            status: 'strong_anomaly',
            direction: 'two_sided',
        });
        expect(report.respirationElevationSummary).toMatchObject({
            elevatedOrStrongDays: 1,
            corroboratedDays: 0,
            isolatedDays: 1,
            robustDeviation: {
                elevatedAvailableDays: 1,
                elevatedMedian: expect.any(Number),
                elevatedMin: expect.any(Number),
                elevatedMax: expect.any(Number),
            },
        });
    });

    it('fails respiration closed when the selected sleep record belongs to another date', () => {
        const history = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 50, 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const targetDate = dateAt(20);
        const stale = snapshot(targetDate, 50, 60, 15.5);
        stale.source.metricDates = { sleep: dateAt(19) };
        const report = runHealthAnomalyReplay({
            days: [
                ...history,
                { date: targetDate, recoverySnapshot: stale, subjectiveCheckin: checkin(targetDate) },
            ],
        });

        const row = report.rows.find(item => item.date === targetDate);
        expect(row?.respirationElevation).toMatchObject({
            status: 'unavailable',
            reasonCodes: ['DATE_PROVENANCE_MISMATCH'],
        });
        expect(row?.coreEvidence.find(item => item.signal === 'respiration')?.status).toBe('unavailable');
        expect(report.respirationElevationSummary.elevatedOrStrongDays).toBe(0);
        expect(report.respirationElevationSummary.unavailableDays).toBeGreaterThan(0);
        expect(report.respirationElevationSummary.unavailableRate).toBeGreaterThan(0);
        expect(report.respirationElevationSummary.unavailableReasonCounts.DATE_PROVENANCE_MISMATCH).toBe(1);
    });

    it('exports estimator candidates, context and machine-readable plus markdown states', () => {
        const days = Array.from({ length: 21 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 4), 57 + (index % 7), 13.8 + (index % 5) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
            authoredTravelActive: index === 20,
        }));
        const report = runHealthAnomalyReplay({ userId: 'u1', days });
        const last = report.rows.at(-1);
        expect(report.candidatePolicyVersions).toHaveLength(1);
        expect(last?.candidateEstimators.map(item => item.signal)).toEqual(['rhr', 'respiration', 'hrv']);
        expect(last?.respirationElevation).toMatchObject({
            status: expect.stringMatching(/^(normal|elevated|strongly_elevated|resolving)$/),
            policyVersion: 'respiration-elevation/shadow-e2-s1-v1',
        });
        expect(last?.healthContext.authoredTravelActive).toBe(true);
        expect(Object.keys(last?.assessmentStates ?? {})).toEqual(report.candidatePolicyVersions);
        expect(report.respirationElevationSummary.statusCounts).toBeDefined();
        expect(report.respirationElevationSummary.elevatedOrStrongDays).toBeGreaterThanOrEqual(0);
        expect(report.respirationElevationSummary.robustDeviation.availableDays).toBeGreaterThan(0);

        const markdown = renderHealthAnomalyReplayMarkdown(report);
        expect(markdown).toContain('# Health anomaly shadow replay');
        expect(markdown).toContain('| Date | RHR | Respiration | Resp. delta status | HRV |');
        expect(markdown).toContain('retrospective labels');
        expect(markdown).toContain('Respiration elevation statuses:');
        expect(markdown).toContain('Respiration unavailable:');
        expect(markdown).toContain('MAD-normalized respiration deviation:');
    });
});
