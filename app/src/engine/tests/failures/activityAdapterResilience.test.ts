import { describe, it, expect } from 'vitest';
import { mapSnapshotToEngineInput } from '../../adapters';
import type { DailyRecoverySnapshot } from '../../models';

describe('Legacy activity-summary adapter resilience', () => {
    it('preserves a finite zero Training Effect from a manual activity', () => {
        const snapshot: DailyRecoverySnapshot = {
            date: '2026-08-26',
            schemaVersion: 3,
            raw: {
                totalSteps: 5000,
                restingHr: 50,
                yesterdayTraining: {
                    activityCount: 1,
                    totalDurationMin: 45,
                    hardActivityCount: 0,
                    primaryActivity: {
                        activityId: 'manual_123',
                        type: 'running',
                        durationMin: 45,
                        trainingEffect: 0, // Manual activity has 0 TE
                        intensityTag: 'moderate/easy',
                    },
                },
                todayTraining: null,
                last3DaysHardSessionsCount: 0,
            },
            derived: {
                baselineComputationVersion: 3,
                deltas: {},
            },
        } as unknown as DailyRecoverySnapshot;

        const engineInput = mapSnapshotToEngineInput(snapshot);
        expect(engineInput.yesterday_training).not.toBeNull();
        expect(engineInput.yesterday_training?.training_effect).toBe(0);
        expect(Number.isFinite(engineInput.yesterday_training?.training_effect)).toBe(true);
    });

    it('safely normalizes activities with null duration or missing primary activity', () => {
        const snapshot: DailyRecoverySnapshot = {
            date: '2026-08-26',
            schemaVersion: 3,
            raw: {
                totalSteps: 5000,
                yesterdayTraining: {
                    activityCount: 2,
                    totalDurationMin: 10,
                    hardActivityCount: 0,
                    primaryActivity: null,
                },
                todayTraining: null,
                last3DaysHardSessionsCount: 0,
            },
            derived: {
                baselineComputationVersion: 3,
                deltas: {},
            },
        } as unknown as DailyRecoverySnapshot;

        const engineInput = mapSnapshotToEngineInput(snapshot);
        expect(engineInput.yesterday_training).toBeNull();
    });
});
