import { describe, expect, it } from 'vitest';
import {
    appendSetToExercise,
    amendLoggedSet,
    buildLoggedSet,
    extractPlannedStrengthExercises,
    nextSetIndex,
    prefillNextSet,
    reindexSets,
    removeSetFromExercise,
    replaceSetInExercise,
    resolveInitialExerciseIndex,
    resolveStepNavigation,
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

describe('amendLoggedSet', () => {
    it('changes only the entry fields and preserves historical set metadata', () => {
        const existing = loggedSet({
            setIndex: 2,
            reps: 3,
            weightKg: 70,
            isWarmup: true,
            completedAt: '2026-08-17T18:02:00Z',
            gauge: { scale: 'rir', value: 4 },
        });

        expect(amendLoggedSet(existing, { reps: 5, weightKg: 72.5, isWarmup: false })).toEqual({
            ok: true,
            set: {
                setIndex: 2,
                reps: 5,
                weightKg: 72.5,
                isWarmup: true,
                completedAt: '2026-08-17T18:02:00Z',
                gauge: { scale: 'rir', value: 4 },
            },
        });
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

describe('replaceSetInExercise and removeSetFromExercise (M1.2 / ADR-0023)', () => {
    it('replaces a targeted set preserving its setIndex', () => {
        const exercises: LoggedExercise[] = [{
            exerciseId: 'bench_press',
            sets: [loggedSet({ setIndex: 1, weightKg: 70 }), loggedSet({ setIndex: 2, weightKg: 725 })],
        }];
        const corrected = replaceSetInExercise(exercises, 0, 2, loggedSet({ setIndex: 2, weightKg: 72.5 }));
        expect(corrected[0]?.sets[1]).toEqual(loggedSet({ setIndex: 2, weightKg: 72.5 }));
    });

    it('removes a targeted set and reindexes subsequent sets', () => {
        const exercises: LoggedExercise[] = [{
            exerciseId: 'bench_press',
            sets: [
                loggedSet({ setIndex: 1, weightKg: 70 }),
                loggedSet({ setIndex: 2, weightKg: 75 }),
                loggedSet({ setIndex: 3, weightKg: 80 }),
            ],
        }];
        const afterRemoval = removeSetFromExercise(exercises, 0, 2);
        expect(afterRemoval[0]?.sets).toHaveLength(2);
        expect(afterRemoval[0]?.sets[0]).toMatchObject({ setIndex: 1, weightKg: 70 });
        expect(afterRemoval[0]?.sets[1]).toMatchObject({ setIndex: 2, weightKg: 80 });
    });

    it('reindexes arbitrary sets strictly 1..N', () => {
        const rawSets: LoggedSet[] = [
            loggedSet({ setIndex: 4, reps: 5 }),
            loggedSet({ setIndex: 9, reps: 3 }),
        ];
        expect(reindexSets(rawSets)).toEqual([
            loggedSet({ setIndex: 1, reps: 5 }),
            loggedSet({ setIndex: 2, reps: 3 }),
        ]);
    });
});

describe('resolveStepNavigation (M1.1)', () => {
    it('merges planned exercises with logged exercises and marks completion', () => {
        const planned = [
            { exerciseId: 'bench_press', name: 'Bench Press', targetSets: 2, targetReps: 5, targetGauge: null, optional: false },
            { exerciseId: 'pull_up', name: 'Pull Up', targetSets: 2, targetReps: 8, targetGauge: null, optional: true },
        ];
        const logged: LoggedExercise[] = [
            { exerciseId: 'bench_press', sets: [loggedSet({ setIndex: 1 }), loggedSet({ setIndex: 2 })] },
            { exerciseId: null, freeTextName: 'Custom Curl', sets: [loggedSet({ setIndex: 1 })] },
        ];

        const nav = resolveStepNavigation(logged, planned);
        expect(nav).toHaveLength(3);

        // First step: Bench Press (planned, 2/2 completed)
        expect(nav[0]).toMatchObject({
            exerciseIndex: 0,
            exerciseId: 'bench_press',
            displayName: 'Bench Press',
            isPlanned: true,
            optional: false,
            loggedSetsCount: 2,
            isComplete: true,
        });

        // Second step: Pull Up (planned, 0/2 not yet started in logged)
        expect(nav[1]).toMatchObject({
            exerciseIndex: null,
            exerciseId: 'pull_up',
            displayName: 'Pull Up',
            isPlanned: true,
            optional: true,
            loggedSetsCount: 0,
            isComplete: false,
        });

        // Third step: Custom Curl (ad-hoc logged)
        expect(nav[2]).toMatchObject({
            exerciseIndex: 1,
            displayName: 'Custom Curl',
            isPlanned: false,
            loggedSetsCount: 1,
            isComplete: true,
        });
    });
});

describe('resolveInitialExerciseIndex (M1.1)', () => {
    it('returns null when no exercises exist in session', () => {
        expect(resolveInitialExerciseIndex([])).toBeNull();
    });

    it('returns first incomplete step index when resuming session', () => {
        const planned = [
            { exerciseId: 'bench_press', name: 'Bench Press', targetSets: 2, targetReps: 5, targetGauge: null, optional: false },
            { exerciseId: 'pull_up', name: 'Pull Up', targetSets: 2, targetReps: 8, targetGauge: null, optional: false },
        ];
        const logged: LoggedExercise[] = [
            { exerciseId: 'bench_press', sets: [loggedSet({ setIndex: 1 }), loggedSet({ setIndex: 2 })] },
            { exerciseId: 'pull_up', sets: [] },
        ];

        expect(resolveInitialExerciseIndex(logged, planned)).toBe(1);
    });

    it('returns first empty exercise index when unplanned exercises exist', () => {
        const logged: LoggedExercise[] = [
            { exerciseId: 'bench_press', sets: [loggedSet({ setIndex: 1 })] },
            { exerciseId: 'pull_up', sets: [] },
        ];
        expect(resolveInitialExerciseIndex(logged, [])).toBe(1);
    });

    it('returns last touched exercise index when all exercises have sets', () => {
        const logged: LoggedExercise[] = [
            { exerciseId: 'bench_press', sets: [loggedSet({ setIndex: 1 })] },
            { exerciseId: 'pull_up', sets: [loggedSet({ setIndex: 1 })] },
        ];
        expect(resolveInitialExerciseIndex(logged, [])).toBe(1);
    });
});
