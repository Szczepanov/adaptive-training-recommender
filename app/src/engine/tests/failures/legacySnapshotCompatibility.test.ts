import { describe, it, expect } from 'vitest';
import { mapSnapshotToEngineInput } from '../../adapters';
import type { DailyRecoverySnapshot } from '../../models';

describe('Legacy recovery-snapshot schema compatibility', () => {
    it('gracefully handles legacy schema version documents missing modern fields', () => {
        // v1 document missing 28d stdev and respiration MAD
        const legacySnapshot: DailyRecoverySnapshot = {
            date: '2026-08-26',
            schemaVersion: 1,
            raw: {
                totalSteps: 6000,
                restingHr: 52,
                hrvOvernightAvg: 58,
                sleepScore: 80,
                sleepDurationSec: 27000,
            },
            derived: {
                baselineComputationVersion: 1,
                hrv7dAvg: 60,
                restingHr7dAvg: 50,
                deltas: { hrvVs7d: -2, restingHrVs7d: 2 },
            },
        } as unknown as DailyRecoverySnapshot;

        const engineInput = mapSnapshotToEngineInput(legacySnapshot);
        expect(engineInput.total_steps).toBe(6000);
        expect(engineInput.hrv_delta).toBe(-2);
        expect(engineInput.hrv_stdev_28d).toBeNull();
        expect(engineInput.respiration_mad_28d).toBeNull();
    });
});
