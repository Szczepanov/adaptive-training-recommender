import { describe, expect, it } from 'vitest';
import { parseRecoverySnapshot, parseSubjectiveCheckin } from './decisionInputs';

const recovery = {
    userId: 'u1', date: '2026-08-07',
    source: { garminSyncedAt: '2026-08-07T06:00:00Z', sourceSchemaVersion: 3 },
    raw: {
        sleepScore: 80, sleepDurationSec: 27000, restingHr: 50, hrvOvernightAvg: 55,
        hrvStatus: 'balanced', respirationAvg: 14, bodyBatteryWake: 75, bodyBatteryChange: 55,
        totalSteps: 7000, last3DaysHardSessionsCount: 1, yesterdayTraining: null,
    },
    derived: {
        baselineComputationVersion: 2, sleepScore7dAvg: 78, sleepScore28dAvg: 77,
        restingHr7dAvg: 51, restingHr28dAvg: 52, hrv7dAvg: 54, hrv28dAvg: 53,
        respiration7dAvg: 14, respiration28dAvg: 14,
        deltas: { sleepScoreVs7d: 2, sleepScoreVs28d: 3, restingHrVs7d: -1, restingHrVs28d: -2, hrvVs7d: 1, hrvVs28d: 2, respirationVs7d: 0, respirationVs28d: 0 },
    },
    dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
    updatedAt: '2026-08-07T06:00:00Z',
};

const checkin = {
    userId: 'u1', date: '2026-08-07', readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 3, mentalStress: 3, motivation: 7,
    painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
    availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
    notes: null, submittedAt: '2026-08-07T07:00:00Z', dataQuality: { isComplete: true, missingFields: [] }, schemaVersion: 1,
    createdAt: '2026-08-07T07:00:00Z', updatedAt: '2026-08-07T07:00:00Z',
};

describe('decision-input parsers', () => {
    it('accepts a complete recovery snapshot needed by the engine', () => {
        expect(parseRecoverySnapshot(recovery, 'users/u1/daily_recovery_snapshots/2026-08-07', 'u1', '2026-08-07'))
            .toMatchObject({ status: 'AVAILABLE', revision: '2026-08-07T06:00:00Z' });
    });

    it('rejects malformed recovery metrics rather than supplying neutral values', () => {
        expect(parseRecoverySnapshot({ ...recovery, raw: { ...recovery.raw, sleepScore: '80' } }, 'path', 'u1', '2026-08-07'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-engine-metric' }] });
    });

    it('rejects an unknown future recovery schema', () => {
        expect(parseRecoverySnapshot({ ...recovery, source: { ...recovery.source, sourceSchemaVersion: 4 } }, 'path', 'u1', '2026-08-07'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-source', field: 'source' }] });
    });

    it('requires explicit check-in safety flags', () => {
        expect(parseSubjectiveCheckin(checkin, 'users/u1/daily_subjective_checkins/2026-08-07', 'u1', '2026-08-07'))
            .toMatchObject({ status: 'AVAILABLE' });
        const missingSafety = { ...checkin, alreadyTrainedToday: undefined };
        expect(parseSubjectiveCheckin(missingSafety, 'path', 'u1', '2026-08-07'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-safety-flag' }] });
    });
});
