import { describe, expect, it } from 'vitest';
import { summarizeManualTrainingMeasurement } from './manualTrainingMeasurement';
import type { StrengthSession } from '../engine/models';

function session(overrides: Partial<StrengthSession> = {}): StrengthSession {
    return {
        userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
        completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z', state: 'completed',
        exercises: [], schemaVersion: 1,
        ...overrides,
    };
}

describe('summarizeManualTrainingMeasurement', () => {
    it('reports an empty summary for no sessions -- the actual state today', () => {
        const summary = summarizeManualTrainingMeasurement([]);
        expect(summary).toEqual({
            sessionCount: 0, exposureCount: 0, skippedSessionCount: 0,
            totalCostByAxis: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            totalStimulus: { maxStrength: 0, hypertrophy: 0 },
            confidenceCounts: { inferred: 0, unknown: 0 },
        });
    });

    it('counts a session with no admissible exposure as skipped, not zero-contributing', () => {
        const inProgress = session({ state: 'in_progress' });
        const summary = summarizeManualTrainingMeasurement([inProgress]);
        expect(summary.sessionCount).toBe(1);
        expect(summary.skippedSessionCount).toBe(1);
        expect(summary.exposureCount).toBe(0);
    });

    it('aggregates cost and stimulus across multiple sessions', () => {
        const identified = session({
            sessionId: 's1',
            exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: 2 } }] }],
        });
        const summary = summarizeManualTrainingMeasurement([identified, identified]);
        expect(summary.exposureCount).toBe(2);
        expect(summary.totalCostByAxis.lowerBody).toBeGreaterThan(0);
        expect(summary.totalStimulus.maxStrength).toBeGreaterThan(0);
    });

    it('separately counts inferred (fully identified) vs unknown (free-text) confidence', () => {
        const identified = session({
            sessionId: 's1',
            exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: 2 } }] }],
        });
        const freeText = session({
            sessionId: 's2',
            exercises: [{ exerciseId: null, freeTextName: 'Sled push', sets: [{ setIndex: 1, weightKg: 90, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: 2 } }] }],
        });
        const summary = summarizeManualTrainingMeasurement([identified, freeText]);
        expect(summary.confidenceCounts).toEqual({ inferred: 1, unknown: 1 });
    });
});
