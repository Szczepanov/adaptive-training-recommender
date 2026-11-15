import { describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../engine/models';
import type { HealthAnomalyAssessmentRevision } from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import { VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS } from '../derived/flags/illnessAnomaly/healthAnomaly';
import type { HealthAnomalyEpisodeOutcome } from '../derived/flags/illnessAnomaly/healthAnomalyOutcome';
import { HealthAnomalyService } from './healthAnomalyService';
import { addDaysToLocalDateString } from '../utils/localDate';

function day(date: string, rhr = 50, hrv = 60, respiration = 14): DailyRecoverySnapshot {
    return {
        userId: 'u1', date,
        source: { garminSyncedAt: `${date}T06:00:00Z`, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
        raw: {
            sleepScore: 85, sleepDurationSec: 8 * 3600, restingHr: rhr, hrvOvernightAvg: hrv,
            hrvStatus: null, respirationAvg: respiration, bodyBatteryWake: 70, bodyBatteryChange: 35,
            totalSteps: 8000, last3DaysHardSessionsCount: 0, yesterdayTraining: null, todayTraining: null,
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 85, sleepScore28dAvg: 84,
            restingHr7dAvg: 50, restingHr28dAvg: 50,
            hrv7dAvg: 60, hrv28dAvg: 60,
            respiration7dAvg: 14, respiration28dAvg: 14,
            hrv28dStdev: 5, restingHr28dStdev: 2, sleepScore28dStdev: 5, respiration28dMad: 0.5,
            restingHr28dMedian: 50, restingHr28dMad: 2,
            hrv28dMedian: 60, hrv28dMad: 5,
            deltas: {
                sleepScoreVs7d: 0, sleepScoreVs28d: 1, restingHrVs7d: rhr - 50, restingHrVs28d: rhr - 50,
                hrvVs7d: hrv - 60, hrvVs28d: hrv - 60, respirationVs7d: respiration - 14, respirationVs28d: respiration - 14,
            },
        },
        dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
    } as DailyRecoverySnapshot;
}

function checkin(): DailySubjectiveCheckin {
    return {
        userId: 'u1', date: '2026-08-21', readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2,
        mentalStress: 2, motivation: 8, painOrInjury: false, illnessSymptoms: false,
        unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: '2026-08-21T06:05:00Z', dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: '2026-08-21T06:05:00Z', updatedAt: '2026-08-21T06:05:00Z',
    };
}

function available<T>(data: T, revision = 'rev'): DataState<T> {
    return { status: 'AVAILABLE', data, revision };
}

describe('HealthAnomalyService composition', () => {
    it('does absolutely no reads or writes when policy is off', async () => {
        const recovery = { getRecoverySnapshotState: vi.fn(), getRecoverySnapshotsInRangeState: vi.fn() };
        const checkins = { getCheckinState: vi.fn() };
        const blocks = { getBlocksInRangeState: vi.fn() };
        const store = { getLatestForDate: vi.fn(), persistImmutable: vi.fn() };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        expect(await service.assessAndPersist('u1', '2026-08-21', 'off')).toBeNull();
        expect(recovery.getRecoverySnapshotState).not.toHaveBeenCalled();
        expect(recovery.getRecoverySnapshotsInRangeState).not.toHaveBeenCalled();
        expect(checkins.getCheckinState).not.toHaveBeenCalled();
        expect(blocks.getBlocksInRangeState).not.toHaveBeenCalled();
        expect(store.getLatestForDate).not.toHaveBeenCalled();
        expect(store.persistImmutable).not.toHaveBeenCalled();
    });

    it('persists a deterministic shadow revision from canonical sources', async () => {
        const current = day('2026-08-21');
        const history = Array.from({ length: 20 }, (_, index) => {
            const date = addDaysToLocalDateString('2026-08-01', index);
            return day(date, 49 + (index % 4), 56 + (index % 8), 13.8 + (index % 5) * 0.1);
        });
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(current, 'current-rev')),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue(available(history, 'history-rev')),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue(available(checkin(), 'checkin-rev')) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue(available([], 'travel-rev')) };
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(null),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1', undefined, '2026-08-21T06:30:00Z');
        expect(result?.revision.source.recoverySnapshotRevision).toMatch(/^snapshot:current-rev:[0-9a-f]{16}$/);
        expect(result?.revision.source.checkinRevision).toMatch(/^checkin:checkin-rev:[0-9a-f]{16}$/);
        expect(result?.revision.source).toMatchObject({
            historyWindowEndExclusive: '2026-08-21',
            travelContextRevision: 'travel-rev',
        });
        expect(result?.revision.revisionId).toMatch(/^ha-[0-9a-f]{16}$/);
        expect(store.persistImmutable).toHaveBeenCalledTimes(1);
    });

    it('changes immutable identity when canonical content changes despite an unchanged external revision', async () => {
        const current = day('2026-08-21');
        const recovery = {
            getRecoverySnapshotState: vi.fn()
                .mockResolvedValueOnce(available(current, 'same-rev'))
                .mockResolvedValueOnce(available({ ...current, raw: { ...current.raw, restingHr: 54 } }, 'same-rev')),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue(available(checkin(), 'same-checkin-rev')) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const persisted: HealthAnomalyAssessmentRevision[] = [];
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(null),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => {
                persisted.push(value);
                return value;
            }),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1', undefined, '2026-08-21T06:30:00Z');
        await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1', undefined, '2026-08-21T06:31:00Z');

        expect(persisted).toHaveLength(2);
        expect(persisted[0].source.recoverySnapshotRevision).not.toBe(persisted[1].source.recoverySnapshotRevision);
        expect(persisted[0].revisionId).not.toBe(persisted[1].revisionId);
    });

    it('degrades missing optional history to a one-day assessment rather than failing composition', async () => {
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(day('2026-08-21'))),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'UNAVAILABLE', operation: 'travel', retryable: true }) };
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(null),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1');
        expect(result).not.toBeNull();
        expect(result?.assessment.coreSignals.every(signal => signal.status === 'unavailable')).toBe(true);
        expect(result?.revision.source.travelContextRevision).toBeNull();
        expect(store.persistImmutable).toHaveBeenCalledTimes(1);
    });

    it('does not persist when previous assessment history cannot be read', async () => {
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(day('2026-08-21'))),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const store = {
            getLatestForDate: vi.fn().mockRejectedValue(new Error('previous assessment unavailable')),
            persistImmutable: vi.fn(),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        await expect(service.assessAndPersist('u1', '2026-08-21', 'shadow-v1'))
            .rejects.toThrow('previous assessment unavailable');
        expect(store.persistImmutable).not.toHaveBeenCalled();
    });

    it('uses visible-v1 thresholds by default and persists insufficient_evidence when history is missing', async () => {
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(day('2026-08-21', 50, 60, 14))),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue(available(checkin())) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(null),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'visible-v1', undefined, '2026-08-21T06:30:00Z');
        expect(result).not.toBeNull();
        expect(result?.revision.mode).toBe('visible-v1');
        expect(result?.revision.thresholdPolicy).toEqual(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS);
        expect(result?.assessment.state).toBe('insufficient_evidence');
        expect(result?.assessment.earlyResponse).toBeDefined();
    });

    it('carries persistenceDays for physiological trace while keeping priorUnexplainedDays at zero after an explained strain day', async () => {
        const current = day('2026-08-21', 56, 60, 14);
        const history = Array.from({ length: 20 }, (_, index) => {
            const date = addDaysToLocalDateString('2026-08-01', index);
            return day(date, 49 + (index % 4), 56 + (index % 8), 13.8 + (index % 5) * 0.1);
        });
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(current, 'current-rev')),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue(available(history, 'history-rev')),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue(available(checkin(), 'checkin-rev')) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue(available([], 'travel-rev')) };
        const priorExplained: HealthAnomalyAssessmentRevision = {
            schemaVersion: 1,
            userId: 'u1',
            date: '2026-08-20',
            revisionId: 'ha-0123456789abcdef',
            idempotencyKey: '2026-08-20:0123456789abcdef',
            computedAt: '2026-08-20T06:30:00Z',
            policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
            thresholdPolicy: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
            mode: 'visible-v1',
            source: {
                timezone: 'Europe/Warsaw',
                recoverySnapshotRevision: 'r1',
                checkinRevision: 'c1',
                historyWindowStart: '2026-07-23',
                historyWindowEndExclusive: '2026-08-20',
                historySnapshotRevisions: [],
                travelContextRevision: null,
                persistenceLookbackStart: '2026-08-19',
            },
            assessment: {
                state: 'explained_recovery_strain',
                evidenceLevel: 'moderate',
                coreSignals: [
                    { signal: 'rhr', estimator: 'mean-stdev-28d', direction: 'high', status: 'moderate_anomaly', currentValue: 55, baselineValue: 50, scaleValue: 2.5, standardizedDeviation: 2.0, baselineVersion: 5 },
                    { signal: 'respiration', estimator: 'median-mad-28d', direction: 'high', status: 'normal', currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, baselineVersion: 5 },
                    { signal: 'hrv', estimator: 'log-mean-stdev-28d', direction: 'low', status: 'normal', currentValue: 60, baselineValue: 60, scaleValue: 5, standardizedDeviation: 0, baselineVersion: 5 },
                ],
                supportingSignals: [],
                explanations: [{ kind: 'hard_training', strength: 'strong', explainsSignals: ['rhr'], evidence: ['hard session yesterday'] }],
                unexplainedEvidence: [],
                persistenceDays: 1,
                unexplainedPersistenceDays: 0,
                episodeId: 'ep-1',
                episodeDay: 1,
                dataQuality: [],
                rationale: { facts: [], explanations: [], cautions: [] },
                policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
                thresholdPolicyVersion: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion,
                mode: 'visible-v1',
            },
        };
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(priorExplained),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'visible-v1', undefined, '2026-08-21T06:30:00Z');
        expect(result?.assessment.persistenceDays).toBe(2);
        expect(result?.assessment.unexplainedPersistenceDays).toBe(1);
        expect(result?.assessment.state).toBe('watch_unexplained');
    });

    it('excludes prior symptomatic dates from live baselines, applies causal personal calibration, and tracks previousAssessmentRevisionId', async () => {
        const current = day('2026-08-21', 56, 40, 15.5);
        const history = Array.from({ length: 20 }, (_, index) => {
            const date = addDaysToLocalDateString('2026-08-01', index);
            const snap = day(date, 49 + (index % 4), 56 + (index % 8), 13.8 + (index % 5) * 0.1);
            return {
                ...snap,
                source: { ...snap.source, metricDates: { sleep: date } },
            };
        });
        const symptomaticPriorDate = '2026-08-10';
        const priorCheckin: DailySubjectiveCheckin = {
            ...checkin(),
            date: symptomaticPriorDate,
            illnessSymptoms: true,
        };
        const priorOutcomes: HealthAnomalyEpisodeOutcome[] = [
            {
                userId: 'u1', episodeId: 'health-anomaly:2026-07-01',
                sourceAssessment: { date: '2026-07-01', revisionId: 'ha-0000000000000001' },
                explanation: 'illness_symptoms', symptomOnset: { date: '2026-07-02', precision: 'day' },
                respiratoryTest: null, note: null,
                createdAt: '2026-07-02T08:00:00Z', updatedAt: '2026-07-02T08:00:00Z', schemaVersion: 1,
            },
            {
                userId: 'u1', episodeId: 'health-anomaly:2026-07-15',
                sourceAssessment: { date: '2026-07-15', revisionId: 'ha-0000000000000002' },
                explanation: 'hard_training_recovery', symptomOnset: null,
                respiratoryTest: null, note: null,
                createdAt: '2026-07-16T08:00:00Z', updatedAt: '2026-07-16T08:00:00Z', schemaVersion: 1,
            },
            {
                userId: 'u1', episodeId: 'health-anomaly:2026-08-01',
                sourceAssessment: { date: '2026-08-01', revisionId: 'ha-0000000000000003' },
                explanation: 'nothing_obvious', symptomOnset: null,
                respiratoryTest: null, note: null,
                createdAt: '2026-08-04T08:00:00Z', updatedAt: '2026-08-04T08:00:00Z', schemaVersion: 1,
            },
        ];

        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(current, 'current-rev')),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue(available(history, 'history-rev')),
        };
        const checkins = {
            getCheckinState: vi.fn().mockResolvedValue(available(checkin(), 'checkin-rev')),
            getCheckinsInRangeState: vi.fn().mockResolvedValue(available([priorCheckin], 'checkin-hist-rev')),
        };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue(available([], 'travel-rev')) };
        const priorA = {
            schemaVersion: 1 as const, userId: 'u1', date: '2026-08-20',
            revisionId: 'ha-aaaaaaaaaaaaaaaa', idempotencyKey: '2026-08-20:aaaaaaaaaaaaaaaa',
            computedAt: '2026-08-20T06:30:00Z', policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
            thresholdPolicy: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS, mode: 'visible-v1' as const,
            source: {
                timezone: 'Europe/Warsaw' as const, recoverySnapshotRevision: 'r0', checkinRevision: null,
                historyWindowStart: '2026-07-23', historyWindowEndExclusive: '2026-08-20',
                historySnapshotRevisions: [], travelContextRevision: null, persistenceLookbackStart: '2026-08-19',
            },
            assessment: {
                state: 'watch_unexplained' as const, evidenceLevel: 'moderate' as const,
                coreSignals: [
                    { signal: 'rhr' as const, estimator: 'mean-stdev-28d' as const, direction: 'high' as const, status: 'moderate_anomaly' as const, currentValue: 55, baselineValue: 50, scaleValue: 2, standardizedDeviation: 2.5, baselineVersion: 5 },
                    { signal: 'respiration' as const, estimator: 'median-mad-28d' as const, direction: null, status: 'normal' as const, currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, baselineVersion: 5 },
                    { signal: 'hrv' as const, estimator: 'log-mean-stdev-28d' as const, direction: null, status: 'normal' as const, currentValue: 4, baselineValue: 4, scaleValue: 0.1, standardizedDeviation: 0, baselineVersion: 5 },
                ],
                supportingSignals: [], explanations: [], unexplainedEvidence: ['rhr:moderate_anomaly:high'],
                persistenceDays: 1, unexplainedPersistenceDays: 1, episodeId: 'health-anomaly:2026-08-20', episodeDay: 1,
                dataQuality: [], rationale: { facts: [], explanations: [], cautions: [] },
                policyVersion: 'health-anomaly/ha9-respiration-shadow-v1',
                thresholdPolicyVersion: VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.policyVersion, mode: 'visible-v1' as const,
            },
        };
        const priorB = { ...priorA, revisionId: 'ha-bbbbbbbbbbbbbbbb', idempotencyKey: '2026-08-20:bbbbbbbbbbbbbbbb' };
        const store = {
            getLatestForDate: vi.fn().mockResolvedValueOnce(priorA).mockResolvedValueOnce(priorB),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const outcomes = { listForUser: vi.fn().mockResolvedValue(priorOutcomes) };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never, outcomes as never);

        const first = await service.assessAndPersist('u1', '2026-08-21', 'visible-v1', undefined, '2026-08-21T06:30:00Z');
        const second = await service.assessAndPersist('u1', '2026-08-21', 'visible-v1', undefined, '2026-08-21T06:31:00Z');

        expect(first?.assessment.dataQuality.every(q => q.contaminatedDaysExcluded === 1)).toBe(true);
        expect(first?.assessment.calibrationStage).toBe('outcome_calibrated');
        expect(first?.assessment.personalCalibration?.calibrationEligible).toBe(true);
        expect(first?.revision.source.contaminatedDates).toEqual([symptomaticPriorDate]);
        expect(first?.revision.source.personalCalibrationRevision).toMatch(/^[0-9a-f]{16}$/);
        expect(first?.revision.source.previousAssessmentRevisionId).toBe('ha-aaaaaaaaaaaaaaaa');
        expect(second?.revision.source.previousAssessmentRevisionId).toBe('ha-bbbbbbbbbbbbbbbb');
        expect(second?.revision.revisionId).not.toBe(first?.revision.revisionId);
    });
});
