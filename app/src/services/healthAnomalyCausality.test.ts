import { describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type {
    CoreSignalEvidence,
    HealthAnomalyAssessmentRevision,
    PhysiologicalAnomalyAssessment,
} from '../engine/healthAnomalyModels';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../engine/models';
import { HealthAnomalyService } from './healthAnomalyService';

function available<T>(data: T, revision = 'rev'): DataState<T> {
    return { status: 'AVAILABLE', data, revision };
}

function snapshot(date: string, rhr: number): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: { garminSyncedAt: `${date}T06:00:00Z`, sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
        raw: {
            sleepScore: 85,
            sleepDurationSec: 8 * 3600,
            restingHr: rhr,
            hrvOvernightAvg: 60,
            hrvStatus: null,
            respirationAvg: 14,
            bodyBatteryWake: 70,
            bodyBatteryChange: 35,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 85,
            sleepScore28dAvg: 84,
            restingHr7dAvg: 50,
            restingHr28dAvg: 50,
            hrv7dAvg: 60,
            hrv28dAvg: 60,
            respiration7dAvg: 14,
            respiration28dAvg: 14,
            hrv28dStdev: 5,
            restingHr28dStdev: 2,
            sleepScore28dStdev: 5,
            respiration28dMad: 0.5,
            restingHr28dMedian: 50,
            restingHr28dMad: 2,
            hrv28dMedian: 60,
            hrv28dMad: 5,
            deltas: {
                sleepScoreVs7d: 0,
                sleepScoreVs28d: 1,
                restingHrVs7d: rhr - 50,
                restingHrVs28d: rhr - 50,
                hrvVs7d: 0,
                hrvVs28d: 0,
                respirationVs7d: 0,
                respirationVs28d: 0,
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

function checkin(date: string): DailySubjectiveCheckin {
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
        illnessSymptoms: false,
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

function adverseRhr(): CoreSignalEvidence {
    return {
        signal: 'rhr',
        status: 'strong_anomaly',
        direction: 'high',
        currentValue: 56,
        baselineValue: 50,
        scaleValue: 2,
        standardizedDeviation: 3,
        estimator: 'mean-stdev-28d',
        baselineVersion: 5,
    };
}

function previousAssessment(): HealthAnomalyAssessmentRevision {
    const assessment: PhysiologicalAnomalyAssessment = {
        state: 'explained_recovery_strain',
        evidenceLevel: 'moderate',
        coreSignals: [
            adverseRhr(),
            { ...adverseRhr(), signal: 'respiration', status: 'normal', direction: null, standardizedDeviation: 0 },
            { ...adverseRhr(), signal: 'hrv', status: 'normal', direction: null, standardizedDeviation: 0 },
        ],
        supportingSignals: [],
        explanations: [{ kind: 'hard_training', strength: 'strong', explainsSignals: ['rhr', 'hrv'], evidence: ['YESTERDAY_HARD_SESSION'] }],
        unexplainedEvidence: [],
        persistenceDays: 2,
        episodeId: 'health-anomaly:2026-08-19',
        episodeDay: 2,
        dataQuality: [],
        rationale: { facts: [], explanations: ['HARD_TRAINING'], cautions: ['NOT_A_DIAGNOSIS'] },
        policyVersion: 'health-anomaly/ha3-v1',
        thresholdPolicyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
        mode: 'shadow-v1',
    };
    return {
        userId: 'u1',
        date: '2026-08-20',
        revisionId: 'ha-prev',
        idempotencyKey: 'prev',
        computedAt: '2026-08-20T06:30:00Z',
        policyVersion: 'health-anomaly/ha3-v1',
        thresholdPolicy: {
            policyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
            moderateDeviation: 1.5,
            strongDeviation: 2.5,
            minimumCoreSignalsForMultiSignal: 2,
            persistenceDaysForEscalation: 2,
            minimumHistoryCount: 14,
            minimumRecentDayCoverage: 4 / 7,
            maxBaselineAgeDays: 3,
            estimatorBySignal: { rhr: 'mean-stdev-28d', respiration: 'median-mad-28d', hrv: 'log-mean-stdev-28d' },
        },
        mode: 'shadow-v1',
        source: {
            timezone: 'Europe/Warsaw',
            recoverySnapshotRevision: 'snapshot-prev',
            checkinRevision: 'checkin-prev',
            historyWindowStart: '2026-07-23',
            historyWindowEndExclusive: '2026-08-20',
            historySnapshotRevisions: [],
            travelContextRevision: null,
            persistenceLookbackStart: '2026-08-19',
        },
        assessment,
        schemaVersion: 1,
    };
}

describe('HealthAnomalyService causality and persistence', () => {
    it('carries adverse physiology persistence through a prior strongly explained day', async () => {
        const current = snapshot('2026-08-21', 56);
        const history = Array.from({ length: 20 }, (_, index) => {
            const day = String(index + 1).padStart(2, '0');
            return snapshot(`2026-08-${day}`, 48 + (index % 5));
        });
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(current, 'current')),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue(available(history, 'history')),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue(available(checkin('2026-08-21'), 'checkin')) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const persisted: HealthAnomalyAssessmentRevision[] = [];
        const store = {
            getLatestForDate: vi.fn().mockResolvedValue(previousAssessment()),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => {
                persisted.push(value);
                return value;
            }),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1');

        expect(result).not.toBeNull();
        expect(result?.assessment.coreSignals.find(signal => signal.signal === 'rhr')?.direction).toBe('high');
        expect(result?.assessment.persistenceDays).toBe(3);
        expect(result?.assessment.episodeId).toBe('health-anomaly:2026-08-19');
        expect(persisted).toHaveLength(1);
    });
});
