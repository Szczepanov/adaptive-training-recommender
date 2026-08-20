import { describe, expect, it } from 'vitest';
import { buildContextBrief, type ContextBriefInput } from './contextBrief';
import type { DailyRecoverySnapshot } from './models';

const DATE = '2026-08-20';

function recoverySnapshot(version: number): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: DATE,
        source: { garminSyncedAt: `${DATE}T06:00:00Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: 80,
            sleepDurationSec: 27_000,
            restingHr: 50,
            hrvOvernightAvg: 60,
            hrvStatus: 'balanced',
            respirationAvg: 15,
            bodyBatteryWake: 70,
            bodyBatteryChange: 35,
            totalSteps: 10_000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            stress: { avg: 25, max: 50 },
            trainingReadiness: { score: 80, level: 'high' },
        },
        derived: {
            baselineComputationVersion: version,
            sleepScore7dAvg: 76,
            sleepScore28dAvg: 74,
            restingHr7dAvg: 51,
            restingHr28dAvg: 52,
            hrv7dAvg: 58,
            hrv28dAvg: 56,
            respiration7dAvg: 14,
            respiration28dAvg: 13.5,
            respiration28dMad: version >= 3 ? 0.7 : undefined,
            steps7dAvg: 9_000,
            steps28dAvg: 8_500,
            sleepScore7dMedian: version >= 4 ? 77 : undefined,
            sleepScore28dMedian: version >= 4 ? 75 : undefined,
            sleepScore28dMad: version >= 4 ? 3 : undefined,
            restingHr7dMedian: version >= 4 ? 50 : undefined,
            restingHr28dMedian: version >= 4 ? 51 : undefined,
            restingHr28dMad: version >= 4 ? 1.5 : undefined,
            hrv7dMedian: version >= 4 ? 59 : undefined,
            hrv28dMedian: version >= 4 ? 57 : undefined,
            hrv28dMad: version >= 4 ? 5 : undefined,
            steps7dMedian: version >= 4 ? 8_800 : undefined,
            steps28dMedian: version >= 4 ? 8_200 : undefined,
            steps28dMad: version >= 4 ? 1_200 : undefined,
            bodyBatteryWake7dMedian: version >= 5 ? 68 : undefined,
            bodyBatteryWake28dMedian: version >= 5 ? 65 : undefined,
            bodyBatteryWake28dMad: version >= 5 ? 8 : undefined,
            stressAvg7dMedian: version >= 5 ? 22 : undefined,
            stressAvg28dMedian: version >= 5 ? 20 : undefined,
            stressAvg28dMad: version >= 5 ? 5 : undefined,
            stressMax7dMedian: version >= 5 ? 46 : undefined,
            stressMax28dMedian: version >= 5 ? 43 : undefined,
            stressMax28dMad: version >= 5 ? 7 : undefined,
            trainingReadinessScore7dMedian: version >= 5 ? 75 : undefined,
            trainingReadinessScore28dMedian: version >= 5 ? 72 : undefined,
            trainingReadinessScore28dMad: version >= 5 ? 9 : undefined,
            deltas: {
                sleepScoreVs7d: 4,
                sleepScoreVs28d: 6,
                restingHrVs7d: -1,
                restingHrVs28d: -2,
                hrvVs7d: 2,
                hrvVs28d: 4,
                respirationVs7d: 1,
                respirationVs28d: 1.5,
                stepsVs7d: 1_000,
                stepsVs28d: 1_500,
                sleepScoreVs7dMedian: version >= 4 ? 3 : undefined,
                sleepScoreVs28dMedian: version >= 4 ? 5 : undefined,
                restingHrVs7dMedian: version >= 4 ? 0 : undefined,
                restingHrVs28dMedian: version >= 4 ? -1 : undefined,
                hrvVs7dMedian: version >= 4 ? 1 : undefined,
                hrvVs28dMedian: version >= 4 ? 3 : undefined,
                stepsVs7dMedian: version >= 4 ? 1_200 : undefined,
                stepsVs28dMedian: version >= 4 ? 1_800 : undefined,
                bodyBatteryWakeVs7dMedian: version >= 5 ? 2 : undefined,
                bodyBatteryWakeVs28dMedian: version >= 5 ? 5 : undefined,
                stressAvgVs7dMedian: version >= 5 ? 3 : undefined,
                stressAvgVs28dMedian: version >= 5 ? 5 : undefined,
                stressMaxVs7dMedian: version >= 5 ? 4 : undefined,
                stressMaxVs28dMedian: version >= 5 ? 7 : undefined,
                trainingReadinessScoreVs7dMedian: version >= 5 ? 5 : undefined,
                trainingReadinessScoreVs28dMedian: version >= 5 ? 8 : undefined,
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

function brief(snapshot: DailyRecoverySnapshot): string {
    const input: ContextBriefInput = {
        asOfDate: DATE,
        windowDays: 14,
        snapshots: [snapshot],
        checkins: [],
        activities: [],
        recommendations: [],
        trainingSettings: null,
        preferences: null,
        intentProfile: null,
    };
    return buildContextBrief(input);
}

describe('context brief biometric observability export', () => {
    it('exports robust respiration and v4/v5 candidate baselines with non-additive warnings', () => {
        const text = brief(recoverySnapshot(5));

        expect(text).toContain('Respiration robust baseline: 15 br/min (7d median 14, 28d median 13.5, 28d MAD 0.7) — +1 vs 7d median, +1.5 vs 28d median');
        expect(text).toContain('production respiration strain scoring is currently OFF by default');
        expect(text).toContain('Observation-only candidate baselines (not independent engine inputs)');
        expect(text).toContain('Sleep score candidate: 80 pts (7d median 77, 28d median 75, 28d MAD 3)');
        expect(text).toContain('HRV candidate: 60 ms (7d median 59, 28d median 57, 28d MAD 5)');
        expect(text).toContain('Steps candidate (yesterday D-1): 10000 steps');
        expect(text).toContain('Body Battery wake candidate: 70 pts');
        expect(text).toContain('Stress avg candidate: 25 pts');
        expect(text).toContain('Training Readiness score candidate: 80 pts');
        expect(text).toContain('Treat them as correlated observations, not independent additive evidence');
    });

    it('does not mislabel pre-v3 respiration mean baselines as robust medians', () => {
        const text = brief(recoverySnapshot(2));

        expect(text).toContain('Respiration: 15 br/min (legacy pre-v3 baseline fields use mean; robust median/MAD unavailable)');
        expect(text).not.toContain('Respiration robust baseline:');
        expect(text).not.toContain('Observation-only candidate baselines');
    });
});
