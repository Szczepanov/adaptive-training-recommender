import type { SessionDose, SessionLoad, SessionStep, StepLaterality } from './models';
import type { ExerciseDefinition, ExerciseLoadKind } from '../workouts/models';

/** Everything a swap writes onto the step. For every optional field, `undefined` leaves the
 * step's current value untouched and `null` explicitly clears it. */
export interface StepExerciseReplacement {
    exerciseRef: SessionStep['exerciseRef'];
    title?: string;
    dose?: SessionDose;
    tempo?: string | null;
    rest?: SessionStep['rest'];
    notes?: string | null;
    compositionPatterns?: SessionStep['compositionPatterns'];
    load?: SessionLoad | null;
    laterality?: StepLaterality;
    stopConditions?: null;
    effort?: null;
}

/** Prescription fields a swap must replace so the step matches the new exercise. `null`
 * explicitly clears a field; `undefined` leaves the step's current value in place. */
export interface SwapPrescriptionPatch {
    dose?: SessionDose;
    load?: SessionLoad | null;
    laterality?: StepLaterality;
    tempo?: null;
    stopConditions?: null;
    /** An RIR/RPE target written for reps does not carry over to a converted dose. */
    effort?: null;
}

function doseSets(dose: SessionDose | undefined): number | undefined {
    if (!dose) return undefined;
    if (dose.kind === 'checkoff') return dose.rounds;
    return dose.sets;
}

/** The new exercise's dose when the old kind is not supported, keeping the planned set count.
 * Targets the catalog cannot supply use the app's existing defaults (100 m, 30 s hold, 8 reps);
 * the athlete logs what they actually did. */
function convertDose(dose: SessionDose | undefined, kind: SessionDose['kind']): SessionDose {
    const sets = doseSets(dose) ?? (kind === 'distance' || kind === 'checkoff' ? 1 : 3);
    switch (kind) {
        case 'repetition': return { kind: 'repetition', sets, reps: 8 };
        case 'duration': return { kind: 'duration', sets, seconds: 30 };
        // The definition validator requires a metres target; 100 m matches the distance card's
        // own fallback and the manual builder's default.
        case 'distance': return { kind: 'distance', sets, meters: 100 };
        case 'checkoff': return { kind: 'checkoff', rounds: sets };
    }
}

function loadKindOf(load: SessionLoad): ExerciseLoadKind {
    // A relative-step load resolves to a mass at execution time.
    return load.kind === 'relative_step' ? 'mass' : load.kind;
}

/**
 * What else must change when a step's exercise is swapped for a catalog exercise: a carry
 * cannot keep a bench press's rep dose, a single-arm press must become per-side, and a
 * bodyweight prescription does not apply to a loaded carry. Fields the new exercise supports
 * are kept as authored so a like-for-like swap keeps its prescription. Tempo and stop
 * conditions were written for the replaced movement, so they are always cleared; the swap
 * dialog re-applies a tempo the athlete typed in.
 */
export function adaptPrescriptionToExercise(step: SessionStep, exercise: ExerciseDefinition): SwapPrescriptionPatch {
    const facets = exercise.facets;
    const patch: SwapPrescriptionPatch = { tempo: null, stopConditions: null };
    if (!facets) return patch;

    const doseKind = step.dose?.kind;
    if (doseKind && doseKind !== 'checkoff' && !facets.allowedDoseKinds.includes(doseKind)) {
        patch.dose = convertDose(step.dose, facets.allowedDoseKinds[0]);
        if (step.effort) patch.effort = null;
    } else if (!step.dose && facets.allowedDoseKinds[0] !== 'repetition') {
        // No dose falls back to rep logging; a hold or carry needs its own input card.
        patch.dose = convertDose(undefined, facets.allowedDoseKinds[0]);
    }

    const laterality = step.laterality ?? 'bilateral';
    if (!facets.allowedLaterality.includes(laterality)) {
        patch.laterality = facets.allowedLaterality[0];
    }

    if (step.load && !facets.allowedLoadKinds.includes(loadKindOf(step.load))) {
        patch.load = null;
    }
    return patch;
}

/**
 * The full replacement for a catalog swap. `typed` holds only what the athlete actually typed
 * in the dialog: the replaced exercise's notes are pre-filled there for reference, and copying
 * them unedited would describe the old movement under the new name. Without typed notes the
 * new exercise's own catalog instruction is used.
 */
export function buildCatalogReplacement(
    step: SessionStep,
    exercise: ExerciseDefinition,
    typed: { tempo?: string; notes?: string },
): StepExerciseReplacement {
    const tempo = typed.tempo?.trim() ?? '';
    const notes = typed.notes?.trim() ?? '';
    return {
        ...adaptPrescriptionToExercise(step, exercise),
        exerciseRef: { kind: 'catalog', exerciseId: exercise.id },
        ...(exercise.compositionPatterns ? { compositionPatterns: exercise.compositionPatterns } : {}),
        title: exercise.name,
        tempo: tempo || null,
        notes: notes || exercise.instruction || null,
    };
}
