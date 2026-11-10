import { describe, expect, it } from 'vitest';
import type { SessionStep } from './models';
import { EXERCISES_BY_ID } from '../workouts/exercises';
import { adaptPrescriptionToExercise, buildCatalogReplacement } from './swapAdaptation';
import { validateSessionDefinition } from './validation';

function exercise(id: string) {
    const found = EXERCISES_BY_ID.get(id);
    if (!found) throw new Error(`missing catalog exercise ${id}`);
    return found;
}

const benchStep: SessionStep = {
    id: 'press',
    kind: 'exercise',
    title: 'Bench Press',
    exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
    dose: { kind: 'repetition', sets: 4, reps: 6 },
    load: { kind: 'mass', kg: 80 },
    laterality: 'bilateral',
    tempo: '3-1-1-0',
    notes: 'Retract shoulder blades and touch the chest.',
    stopConditions: ['Bar path drifts'],
};

describe('adaptPrescriptionToExercise', () => {
    it('makes a single-arm replacement per-side and keeps a compatible rep dose and mass load', () => {
        const patch = adaptPrescriptionToExercise(benchStep, exercise('single_arm_dumbbell_floor_press'));
        expect(patch.laterality).toBe('per_side');
        expect(patch.dose).toBeUndefined();
        expect(patch.load).toBeUndefined();
        expect(patch.tempo).toBeNull();
        expect(patch.stopConditions).toBeNull();
    });

    it('turns a rep prescription into a distance dose with the same set count for a carry', () => {
        const patch = adaptPrescriptionToExercise(benchStep, exercise('farmer_carry'));
        expect(patch.dose).toEqual({ kind: 'distance', sets: 4, meters: 100 });
        expect(patch.load).toBeUndefined();
    });

    it('produces a definition the session validator accepts after converting to a carry', () => {
        const step: SessionStep = { ...benchStep, effort: { rir: 2 } };
        const patch = adaptPrescriptionToExercise(step, exercise('farmer_carry'));
        const swapped: SessionStep = {
            id: step.id, kind: step.kind, title: 'Farmer Carry',
            exerciseRef: { kind: 'catalog', exerciseId: 'farmer_carry' },
            ...(patch.dose ? { dose: patch.dose } : {}),
            ...(step.load ? { load: step.load } : {}),
        };
        expect(patch.effort).toBeNull();
        const result = validateSessionDefinition({
            schemaVersion: 1, id: 'custom-1', revision: 1, title: 'Upper', intent: 'training',
            blocks: [{ id: 'b1', role: 'main', executionMode: 'sequential', steps: [swapped] }],
        });
        expect(result.ok ? [] : result.issues).toEqual([]);
    });

    it('clears a bodyweight load the replacement cannot take', () => {
        const pushUp: SessionStep = { ...benchStep, load: { kind: 'bodyweight' } };
        expect(adaptPrescriptionToExercise(pushUp, exercise('farmer_carry')).load).toBeNull();
    });

    it('gives a dose-less added step a dose only when the exercise is not rep-based', () => {
        const blank: SessionStep = { id: 'new', kind: 'exercise' };
        expect(adaptPrescriptionToExercise(blank, exercise('bench_press')).dose).toBeUndefined();
        expect(adaptPrescriptionToExercise(blank, exercise('farmer_carry')).dose).toEqual({ kind: 'distance', sets: 1, meters: 100 });
    });
});

describe('buildCatalogReplacement', () => {
    it('replaces the old exercise notes with the new instruction when the athlete typed nothing', () => {
        const floorPress = exercise('single_arm_dumbbell_floor_press');
        const replacement = buildCatalogReplacement(benchStep, floorPress, {});
        expect(replacement.title).toBe('Single-arm Dumbbell Floor Press');
        expect(replacement.notes).toBe(floorPress.instruction);
        expect(replacement.tempo).toBeNull();
        expect(replacement.exerciseRef).toEqual({ kind: 'catalog', exerciseId: 'single_arm_dumbbell_floor_press' });
    });

    it('keeps notes and tempo the athlete typed', () => {
        const replacement = buildCatalogReplacement(benchStep, exercise('dumbbell_floor_press'), {
            tempo: ' 2-0-1-0 ',
            notes: ' Single 24 kg dumbbell ',
        });
        expect(replacement.tempo).toBe('2-0-1-0');
        expect(replacement.notes).toBe('Single 24 kg dumbbell');
    });
});
