import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../../ledger/models';
import {
    CANDIDATE_HEALTH_ANOMALY_REPLAY_POLICIES,
    renderHealthAnomalyReplayMarkdown,
    runHealthAnomalyReplay,
} from './healthAnomalyReplay';
import {
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
} from './healthAnomaly';
import { addDaysToLocalDateString } from '../../../utils/localDate';

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
        expect(markdown).toContain('## Policy comparison summary');
    });

    it('compares CANDIDATE_HEALTH_ANOMALY_REPLAY_POLICIES and computes policySummaries lead time & false-alarm metrics', () => {
        const baselineDays = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 3), 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const preDay1 = dateAt(20);
        const symptomDay = dateAt(21);
        const falseAlarmDay = dateAt(25);
        const days = [
            ...baselineDays,
            // Strong multi-domain signal 1 day before symptom onset -> visible-v1 escalates Night 1, shadow-v1 stays watch
            { date: preDay1, recoverySnapshot: snapshot(preDay1, 56, 36, 15.8), subjectiveCheckin: checkin(preDay1) },
            { date: symptomDay, recoverySnapshot: snapshot(symptomDay, 58, 34, 16.0), subjectiveCheckin: checkin(symptomDay, true) },
            { date: dateAt(22), recoverySnapshot: snapshot(dateAt(22), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(22)) },
            { date: dateAt(23), recoverySnapshot: snapshot(dateAt(23), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(23)) },
            { date: dateAt(24), recoverySnapshot: snapshot(dateAt(24), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(24)) },
            // Isolated watch day with complete +72h asymptomatic follow-up
            { date: falseAlarmDay, recoverySnapshot: snapshot(falseAlarmDay, 55, 60, 14.0), subjectiveCheckin: checkin(falseAlarmDay) },
            { date: dateAt(26), recoverySnapshot: snapshot(dateAt(26), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(26)) },
            { date: dateAt(27), recoverySnapshot: snapshot(dateAt(27), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(27)) },
            { date: dateAt(28), recoverySnapshot: snapshot(dateAt(28), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(28)) },
        ];

        const report = runHealthAnomalyReplay({ userId: 'u1', days }, CANDIDATE_HEALTH_ANOMALY_REPLAY_POLICIES);
        expect(report.candidatePolicyVersions).toHaveLength(3);

        const visibleSummary = report.policySummaries[VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion]!;
        const shadowSummary = report.policySummaries[SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion]!;

        expect(visibleSummary.preSymptomaticEscalation72hHits).toBe(1);
        expect(shadowSummary.preSymptomaticEscalation72hHits).toBe(0);
        expect(visibleSummary.detectionRateBeforeSymptoms72h).toBe(1);
        expect(visibleSummary.nonSymptomaticPreSymptomLeadTimeDaysMedian).toBe(1);
        expect(visibleSummary.asymptomaticAlertDays).toBe(1);
        expect(visibleSummary.falseAlarmRateWithout72hSymptoms).toBeCloseTo(0.5, 5);
        expect(visibleSummary.episodeCount).toBe(2);

        // Prior symptomatic day (dateAt(21)) must be excluded from later days' baseline calculation
        const recoveryRow = report.rows.find(row => row.date === dateAt(22));
        expect(recoveryRow?.candidateEstimators.find(s => s.signal === 'rhr')?.dataQuality.contaminatedDaysExcluded).toBe(1);

        const markdown = renderHealthAnomalyReplayMarkdown(report);
        expect(markdown).toContain(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion);
    });

    it('does not count a symptomatic day as an onset when its previous-day row is absent', () => {
        const baselineDays = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 3), 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const preDay1 = dateAt(20);
        const symptomDay = dateAt(21);
        const midIllnessAfterGap = dateAt(24); // dateAt(23) is absent from the replay
        const days = [
            // Replay starts mid-illness: no previous-day row exists for the first day.
            { ...baselineDays[0]!, subjectiveCheckin: checkin(dateAt(0), true) },
            ...baselineDays.slice(1),
            { date: preDay1, recoverySnapshot: snapshot(preDay1, 56, 36, 15.8), subjectiveCheckin: checkin(preDay1) },
            { date: symptomDay, recoverySnapshot: snapshot(symptomDay, 58, 34, 16.0), subjectiveCheckin: checkin(symptomDay, true) },
            { date: dateAt(22), recoverySnapshot: snapshot(dateAt(22), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(22), true) },
            { date: midIllnessAfterGap, recoverySnapshot: snapshot(midIllnessAfterGap, 50, 60, 14.0), subjectiveCheckin: checkin(midIllnessAfterGap, true) },
        ];

        const report = runHealthAnomalyReplay({ userId: 'u1', days }, CANDIDATE_HEALTH_ANOMALY_REPLAY_POLICIES);
        const visibleSummary = report.policySummaries[VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion]!;
        // Only dateAt(21) is a known onset (dateAt(20) known and symptom-free), and it was detected.
        expect(visibleSummary.detectionRateBeforeSymptoms72h).toBe(1);
    });

    it('resets unexplainedPersistenceDays after explained_recovery_strain in replay sequence', () => {
        const baselineDays = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 3), 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const day1Snap = snapshot(dateAt(20), 56, 40, 14.0);
        day1Snap.raw.yesterdayTraining = {
            hardActivityCount: 1,
            primaryActivity: { activityId: 1, type: 'Running', durationMin: 60, trainingEffect: 4.1, intensityTag: 'hard' },
        };
        day1Snap.raw.last3DaysHardSessionsCount = 1;
        const day2Snap = snapshot(dateAt(21), 56, 40, 14.0);

        const report = runHealthAnomalyReplay({
            days: [
                ...baselineDays,
                { date: dateAt(20), recoverySnapshot: day1Snap, subjectiveCheckin: checkin(dateAt(20)) },
                { date: dateAt(21), recoverySnapshot: day2Snap, subjectiveCheckin: checkin(dateAt(21)) },
            ],
        }, [SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS]);

        const day1State = report.rows.find(r => r.date === dateAt(20))?.assessmentStates[SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion];
        const day2State = report.rows.find(r => r.date === dateAt(21))?.assessmentStates[SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion];
        expect(day1State?.state).toBe('explained_recovery_strain');
        expect(day1State?.unexplainedPersistenceDays).toBe(0);
        expect(day2State?.persistenceDays).toBe(2);
        expect(day2State?.unexplainedPersistenceDays).toBe(1);
        expect(day2State?.state).toBe('watch_unexplained');
    });

    it('excludes right-censored alerts with incomplete 72h follow-up from falseAlarmRateWithout72hSymptoms', () => {
        const baselineDays = Array.from({ length: 20 }, (_, index) => ({
            date: dateAt(index),
            recoverySnapshot: snapshot(dateAt(index), 49 + (index % 3), 58 + (index % 5), 13.8 + (index % 4) * 0.1),
            subjectiveCheckin: checkin(dateAt(index)),
        }));
        const preDay1 = dateAt(20);
        const symptomDay = dateAt(21);
        const censoredAlertDay = dateAt(25);
        const days = [
            ...baselineDays,
            { date: preDay1, recoverySnapshot: snapshot(preDay1, 56, 36, 15.8), subjectiveCheckin: checkin(preDay1) },
            { date: symptomDay, recoverySnapshot: snapshot(symptomDay, 58, 34, 16.0), subjectiveCheckin: checkin(symptomDay, true) },
            { date: dateAt(22), recoverySnapshot: snapshot(dateAt(22), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(22)) },
            { date: dateAt(23), recoverySnapshot: snapshot(dateAt(23), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(23)) },
            { date: dateAt(24), recoverySnapshot: snapshot(dateAt(24), 50, 60, 14.0), subjectiveCheckin: checkin(dateAt(24)) },
            // Final day in replay: no +1/+2/+3 check-in days exist -> incomplete 72h follow-up
            { date: censoredAlertDay, recoverySnapshot: snapshot(censoredAlertDay, 55, 60, 14.0), subjectiveCheckin: checkin(censoredAlertDay) },
        ];

        const report = runHealthAnomalyReplay({ userId: 'u1', days }, [VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS]);
        const summary = report.policySummaries[VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion]!;
        expect(summary.asymptomaticAlertDays).toBe(0);
        expect(summary.falseAlarmRateWithout72hSymptoms).toBe(0);
    });
});
