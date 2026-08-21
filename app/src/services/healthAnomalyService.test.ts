import { describe, expect, it, vi } from 'vitest';
import type { DataState } from '../engine/dataState';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../engine/models';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import { HealthAnomalyService } from './healthAnomalyService';

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
        expect(store.persistImmutable).not.toHaveBeenCalled();
    });

    it('persists a deterministic shadow revision from canonical sources', async () => {
        const current = day('2026-08-21');
        const history = Array.from({ length: 20 }, (_, index) => {
            const date = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
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
        expect(result?.revision.source).toMatchObject({
            recoverySnapshotRevision: 'current-rev',
            checkinRevision: 'checkin-rev',
            historyWindowEndExclusive: '2026-08-21',
            travelContextRevision: 'travel-rev',
        });
        expect(result?.revision.revisionId).toMatch(/^ha-[0-9a-f]{16}$/);
        expect(store.persistImmutable).toHaveBeenCalledTimes(1);
    });

    it('degrades missing optional history to a one-day assessment rather than failing composition', async () => {
        const recovery = {
            getRecoverySnapshotState: vi.fn().mockResolvedValue(available(day('2026-08-21'))),
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
        };
        const checkins = { getCheckinState: vi.fn().mockResolvedValue({ status: 'MISSING' }) };
        const blocks = { getBlocksInRangeState: vi.fn().mockResolvedValue({ status: 'UNAVAILABLE', operation: 'travel', retryable: true }) };
        const store = {
            getLatestForDate: vi.fn().mockRejectedValue(new Error('history unavailable')),
            persistImmutable: vi.fn().mockImplementation(async (value: HealthAnomalyAssessmentRevision) => value),
        };
        const service = new HealthAnomalyService(recovery as never, checkins as never, blocks as never, store as never);

        const result = await service.assessAndPersist('u1', '2026-08-21', 'shadow-v1');
        expect(result).not.toBeNull();
        expect(result?.assessment.coreSignals.every(signal => signal.status === 'unavailable')).toBe(true);
        expect(result?.revision.source.travelContextRevision).toBeNull();
    });
});
