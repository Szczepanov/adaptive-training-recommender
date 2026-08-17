import { describe, expect, it } from 'vitest';
import { applyOneRepMaxDerivation, deriveOneRepMaxUpdatesForSession } from './oneRepMaxWriteback';
import type { OneRepMaxEstimate } from './oneRepMax';
import type { LoggedSet, StrengthSession } from '../engine/models';

function estimate(overrides: Partial<OneRepMaxEstimate> = {}): OneRepMaxEstimate {
    const set: LoggedSet = { setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', gauge: { scale: 'rir', value: 2 } };
    return { estimatedOneRmKg: 116.7, fromSet: set, formula: 'epley', ...overrides };
}

describe('applyOneRepMaxDerivation', () => {
    it('populates an absent value', () => {
        const result = applyOneRepMaxDerivation(undefined, undefined, estimate(), '2026-08-17T18:05:00Z');
        expect(result).toEqual({ updated: true, estimatedOneRmKg: 116.7, source: 'derived', computedAt: '2026-08-17T18:05:00Z' });
    });

    it('replaces a stale derived value, even when the new estimate is lower', () => {
        const lowerEstimate = estimate({ estimatedOneRmKg: 110 });
        const result = applyOneRepMaxDerivation(120, 'derived', lowerEstimate, '2026-08-17T18:05:00Z');
        expect(result).toMatchObject({ updated: true, estimatedOneRmKg: 110, source: 'derived' });
    });

    it('never overwrites a manual value, even one the new estimate would raise', () => {
        const higherEstimate = estimate({ estimatedOneRmKg: 200 });
        const result = applyOneRepMaxDerivation(100, 'manual', higherEstimate, '2026-08-17T18:05:00Z');
        expect(result).toEqual({ updated: false, estimatedOneRmKg: 100, source: 'manual', reason: expect.stringMatching(/protected/i) });
    });

    it('never overwrites a coach value', () => {
        const result = applyOneRepMaxDerivation(100, 'coach', estimate(), '2026-08-17T18:05:00Z');
        expect(result.updated).toBe(false);
    });

    it('writes over an existing value that has no recorded source, per ADR-0021\'s literal text', () => {
        const result = applyOneRepMaxDerivation(100, undefined, estimate(), '2026-08-17T18:05:00Z');
        expect(result).toEqual({ updated: true, estimatedOneRmKg: 116.7, source: 'derived', computedAt: '2026-08-17T18:05:00Z' });
    });
});

describe('deriveOneRepMaxUpdatesForSession', () => {
    function session(overrides: Partial<StrengthSession> = {}): StrengthSession {
        return {
            userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
            updatedAt: '2026-08-17T18:00:00Z', state: 'in_progress', exercises: [], schemaVersion: 1,
            ...overrides,
        };
    }

    it('produces one outcome per exercise with an admissible near-failure set', () => {
        const s = session({ exercises: [
            { exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', gauge: { scale: 'rir', value: 2 } }] },
        ] });
        const outcomes = deriveOneRepMaxUpdatesForSession(s, undefined, undefined, '2026-08-17T18:05:00Z');
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]).toMatchObject({ exerciseId: 'front_squat', result: { updated: true, source: 'derived' } });
    });

    it('produces no outcome for an exercise with no admissible sets (e.g. velocity_loss only)', () => {
        const s = session({ exercises: [
            { exerciseId: 'hang_power_clean', sets: [{ setIndex: 1, weightKg: 80, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', gauge: { scale: 'velocity_loss', percent: 15 } }] },
        ] });
        expect(deriveOneRepMaxUpdatesForSession(s, undefined, undefined, '2026-08-17T18:05:00Z')).toEqual([]);
    });

    it('produces no outcome for a free-text exercise -- no stable key into estimated1RmKg', () => {
        const s = session({ exercises: [
            { exerciseId: null, freeTextName: 'Trap bar deadlift', sets: [{ setIndex: 1, weightKg: 150, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', gauge: { scale: 'rir', value: 1 } }] },
        ] });
        expect(deriveOneRepMaxUpdatesForSession(s, undefined, undefined, '2026-08-17T18:05:00Z')).toEqual([]);
    });

    it('respects existing manual protection per exercise, independently across a multi-exercise session', () => {
        const s = session({ exercises: [
            { exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', gauge: { scale: 'rir', value: 2 } }] },
            { exerciseId: 'bench_press', sets: [{ setIndex: 1, weightKg: 80, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: 1 } }] },
        ] });
        const outcomes = deriveOneRepMaxUpdatesForSession(
            s,
            { bench_press: 90 },
            { bench_press: { source: 'manual' } },
            '2026-08-17T18:15:00Z',
        );
        const frontSquat = outcomes.find(o => o.exerciseId === 'front_squat');
        const benchPress = outcomes.find(o => o.exerciseId === 'bench_press');
        expect(frontSquat?.result.updated).toBe(true);
        expect(benchPress?.result.updated).toBe(false);
        expect(benchPress?.result.estimatedOneRmKg).toBe(90);
    });
});
