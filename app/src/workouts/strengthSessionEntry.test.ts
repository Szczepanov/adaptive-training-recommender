import { describe, expect, it } from 'vitest';
import {
    appendSetToExercise,
    buildLoggedSet,
    extractPlannedStrengthExercises,
    nextSetIndex,
    prefillNextSet,
    upsertExercise,
} from './strengthSessionEntry';
import type { LoggedExercise, LoggedSet } from '../engine/models';
import type { WorkoutPrescription } from './models';

function loggedSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return { setIndex: 1, weightKg: 80, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:02:00Z', ...overrides };
}

describe('extractPlannedStrengthExercises', () => {
    function prescriptionWithBlocks(blocks: WorkoutPrescription['adjustedBlocks']): WorkoutPrescription {
        return { adjustedBlocks: blocks } as WorkoutPrescription;
    }

    it('returns an empty plan for manual entry (no prescription)', () => {
        expect(extractPlannedStrengthExercises(undefined)).toEqual([]);
        expect(extractPlannedStrengthExercises(null)).toEqual([]);
    });

    it('extracts exerciseId, sets and reps from adjustedBlocks, not displayBlocks', () => {
        const prescription = prescriptionWithBlocks([{
            id: 'main', name: 'Upper-body strength', role: 'main',
            steps: [{ id: 'upper_bench', exerciseId: 'bench_press', name: 'Bench press', duration: { type: 'repetitions', repetitions: 6 }, sets: 3, target: { type: 'reps_in_reserve', min: 3, max: 6 } }],
        }]);
        const planned = extractPlannedStrengthExercises(prescription);
        expect(planned).toEqual([{ exerciseId: 'bench_press', name: 'Bench press', targetSets: 3, targetReps: 6, targetGauge: { scale: 'rir', value: 5 }, optional: false }]);
    });

    it('maps a technical_quality target to a suggested technical gauge', () => {
        const prescription = prescriptionWithBlocks([{
            id: 'main', name: 'Trunk', role: 'main',
            steps: [{ id: 'trunk', exerciseId: 'dead_bug', name: 'Dead bug', duration: { type: 'repetitions', repetitions: 8 }, target: { type: 'technical_quality', cue: 'No trunk compensation.' } }],
        }]);
        const planned = extractPlannedStrengthExercises(prescription);
        expect(planned[0]?.targetGauge).toEqual({ scale: 'technical', met: true });
    });

    it('degrades a non-strength target (e.g. ftp_percent) to no suggestion rather than a guess', () => {
        const prescription = prescriptionWithBlocks([{
            id: 'main', name: 'Odd', role: 'main',
            steps: [{ id: 'odd', exerciseId: 'front_squat', name: 'Front squat', duration: { type: 'repetitions', repetitions: 5 }, target: { type: 'ftp_percent', min: 80, max: 90 } }],
        }]);
        expect(extractPlannedStrengthExercises(prescription)[0]?.targetGauge).toBeNull();
    });

    it('defaults targetSets to 1 and optional to false when absent', () => {
        const prescription = prescriptionWithBlocks([{
            id: 'main', name: 'Main', role: 'main',
            steps: [{ id: 'step', exerciseId: 'goblet_squat', name: 'Goblet squat', duration: { type: 'repetitions', repetitions: 10 } }],
        }]);
        expect(extractPlannedStrengthExercises(prescription)[0]).toMatchObject({ targetSets: 1, optional: false, targetReps: 10 });
    });
});

describe('prefillNextSet', () => {
    it('prefills from the literal previous set, weight and reps carried forward', () => {
        const draft = prefillNextSet([loggedSet({ reps: 3, weightKg: 80, gauge: { scale: 'rir', value: 3 } })]);
        expect(draft).toEqual({ reps: 3, weightKg: 80, gauge: { scale: 'rir', value: 3 }, isWarmup: false });
    });

    it('always defaults isWarmup to false on prefill, even if the previous set was a warm-up', () => {
        const draft = prefillNextSet([loggedSet({ isWarmup: true })]);
        expect(draft.isWarmup).toBe(false);
    });

    it('falls back to the prescribed target when no set has been logged yet', () => {
        const draft = prefillNextSet([], { exerciseId: 'bench_press', name: 'Bench press', targetSets: 3, targetReps: 6, targetGauge: { scale: 'rir', value: 4 }, optional: false });
        expect(draft).toEqual({ reps: 6, weightKg: null, gauge: { scale: 'rir', value: 4 }, isWarmup: false });
    });

    it('falls back to a bare default with no prescription and no history at all', () => {
        expect(prefillNextSet([])).toEqual({ reps: 1, weightKg: null, isWarmup: false });
    });
});

describe('nextSetIndex', () => {
    it('starts at 1 for an exercise with no logged sets', () => {
        expect(nextSetIndex([])).toBe(1);
    });

    it('continues from the highest existing setIndex, not the array length', () => {
        expect(nextSetIndex([loggedSet({ setIndex: 1 }), loggedSet({ setIndex: 3 })])).toBe(4);
    });
});

describe('buildLoggedSet', () => {
    it('builds a valid set with the next sequential index', () => {
        const result = buildLoggedSet({ reps: 3, weightKg: 82.5, isWarmup: false }, [loggedSet({ setIndex: 1 })], '2026-08-17T18:04:00Z');
        expect(result).toEqual({ ok: true, set: { setIndex: 2, weightKg: 82.5, reps: 3, isWarmup: false, completedAt: '2026-08-17T18:04:00Z' } });
    });

    it('rejects zero or negative reps with an inline error rather than building a set', () => {
        expect(buildLoggedSet({ reps: 0, weightKg: 80, isWarmup: false }, [], '2026-08-17T18:04:00Z')).toEqual({ ok: false, error: expect.stringMatching(/reps/i) });
        expect(buildLoggedSet({ reps: -3, weightKg: 80, isWarmup: false }, [], '2026-08-17T18:04:00Z').ok).toBe(false);
    });

    it('accepts null weight as bodyweight', () => {
        const result = buildLoggedSet({ reps: 10, weightKg: null, isWarmup: false }, [], '2026-08-17T18:04:00Z');
        expect(result).toMatchObject({ ok: true, set: { weightKg: null } });
    });

    it('rejects a negative weight rather than silently clamping it', () => {
        expect(buildLoggedSet({ reps: 5, weightKg: -10, isWarmup: false }, [], '2026-08-17T18:04:00Z').ok).toBe(false);
    });

    it('carries the gauge through untouched when present', () => {
        const result = buildLoggedSet({ reps: 3, weightKg: 85, gauge: { scale: 'velocity_loss', percent: 18 }, isWarmup: false }, [], '2026-08-17T18:04:00Z');
        expect(result).toMatchObject({ ok: true, set: { gauge: { scale: 'velocity_loss', percent: 18 } } });
    });
});

describe('upsertExercise', () => {
    it('adds a new exercise by exerciseId', () => {
        expect(upsertExercise([], 'bench_press')).toEqual([{ exerciseId: 'bench_press', sets: [] }]);
    });

    it('is a no-op re-adding the same exerciseId (confirm-or-amend on a prescribed exercise)', () => {
        const existing: LoggedExercise[] = [{ exerciseId: 'bench_press', sets: [loggedSet()] }];
        expect(upsertExercise(existing, 'bench_press')).toEqual(existing);
    });

    it('treats every free-text exercise as a distinct entry, even with the same name', () => {
        const withFirst = upsertExercise([], null, 'Farmer carry');
        const withSecond = upsertExercise(withFirst, null, 'Farmer carry');
        expect(withSecond).toHaveLength(2);
    });
});

describe('appendSetToExercise', () => {
    it('appends a set to the exercise at the given index and leaves others untouched', () => {
        const exercises: LoggedExercise[] = [{ exerciseId: 'bench_press', sets: [] }, { exerciseId: 'pull_up', sets: [loggedSet()] }];
        const updated = appendSetToExercise(exercises, 0, loggedSet({ setIndex: 1, weightKg: 60 }));
        expect(updated[0]?.sets).toEqual([loggedSet({ setIndex: 1, weightKg: 60 })]);
        expect(updated[1]).toBe(exercises[1]);
    });
});
