import type { IntensityGauge, LoggedExercise, LoggedSet } from '../engine/models';
import {
    MAX_REPS_PER_SET,
    MAX_SETS_PER_EXERCISE,
    MAX_WEIGHT_KG,
    isValidIntensityGauge,
    isValidStrengthInstant,
} from '../engine/strengthSessionValidation';
import type { IntensityTarget, WorkoutPrescription } from './models';

/**
 * Confirm-or-amend set entry logic for the S1.5 session runner (ADR-0021). Deliberately
 * framework-free -- this repo has no `@testing-library/react` (component tests here are
 * `renderToStaticMarkup` smoke tests, e.g. `GarminSyncBadge.test.tsx`, and no hook has ever
 * had its own test file), so every rule that needs real unit coverage lives here as a plain
 * function, and the React hook/component are thin orchestration over it.
 */

export interface PlannedStrengthExercise {
    exerciseId: string;
    name: string;
    targetSets: number;
    targetReps: number | null;
    targetGauge: IntensityGauge | null;
    optional: boolean;
}

/** Maps a prescribed `IntensityTarget` to a *suggested* `IntensityGauge` for prefill only.
 *  This is not the D-GAUGE conversion the parser forbids (rir <-> rpe_rts on write) -- it
 *  never touches persisted data, only seeds the entry form's initial value, which the
 *  athlete confirms or amends before anything is logged. Only the two target types the
 *  strength catalog actually uses for strength steps (verified against
 *  `catalog/support-strength.ts`) map to a suggestion; everything else (rpe, ftp_percent,
 *  heart_rate_zone, cadence, pace, estimated_1rm_percent) is a cycling/running target or a
 *  target this repo's strength catalog doesn't emit, and degrades to no suggestion rather
 *  than a guessed one. */
function mapIntensityTargetToGauge(target: IntensityTarget | undefined): IntensityGauge | null {
    if (!target) return null;
    switch (target.type) {
        case 'reps_in_reserve':
            return { scale: 'rir', value: Math.round((target.min + target.max) / 2) };
        case 'technical_quality':
            return { scale: 'technical', met: true };
        default:
            return null;
    }
}

/** Reads the structured `adjustedBlocks` (not `displayBlocks`, which is rendered text for
 *  display and cannot be parsed back into structured targets) off a prescribed session, so
 *  the entry form can seed each exercise with its target reps/gauge before any set is
 *  logged. Returns `[]` for a session with no prescription (manual entry) or a non-strength
 *  prescription -- never throws; a shape this can't extract from is simply not planned. */
export function extractPlannedStrengthExercises(prescription: WorkoutPrescription | null | undefined): PlannedStrengthExercise[] {
    if (!prescription?.adjustedBlocks) return [];
    const planned: PlannedStrengthExercise[] = [];
    for (const block of prescription.adjustedBlocks) {
        for (const step of block.steps) {
            const targetReps = step.duration.type === 'repetitions' ? step.duration.repetitions : null;
            planned.push({
                exerciseId: step.exerciseId,
                name: step.name,
                targetSets: step.sets ?? 1,
                targetReps,
                targetGauge: mapIntensityTargetToGauge(step.target),
                optional: step.optional ?? false,
            });
        }
    }
    return planned;
}

export interface SetEntryDraft {
    reps: number;
    weightKg: number | null;
    gauge?: IntensityGauge;
    isWarmup: boolean;
}

/** The dominant pattern is same exercise, same reps, ascending load -- the athlete should
 *  change one field (weight), not four. Prefills from the literal previous set for this
 *  exercise, warm-up or working, matching what was actually just logged; with no previous
 *  set, falls back to the prescribed target reps/gauge (still just a suggestion). */
export function prefillNextSet(loggedSets: readonly LoggedSet[], planned?: PlannedStrengthExercise): SetEntryDraft {
    const previous = loggedSets[loggedSets.length - 1];
    if (previous) {
        return { reps: previous.reps, weightKg: previous.weightKg, gauge: previous.gauge, isWarmup: false };
    }
    return { reps: planned?.targetReps ?? 1, weightKg: null, ...(planned?.targetGauge ? { gauge: planned.targetGauge } : {}), isWarmup: false };
}

export function nextSetIndex(loggedSets: readonly LoggedSet[]): number {
    return loggedSets.length > 0 ? Math.max(...loggedSets.map(set => set.setIndex)) + 1 : 1;
}

export type BuildSetResult = { ok: true; set: LoggedSet } | { ok: false; error: string };

/** Validates and constructs the next `LoggedSet` from form input. Mirrors the read-side
 *  parser's bounds (reps > 0; weight null or a non-negative number) so a set that would be
 *  rejected on read is never offered for write in the first place -- but this is a UX
 *  convenience, not the enforcement point; `parseStrengthSession` (S1.2) and the Firestore
 *  rules (S1.3) remain the real gates. */
export function buildLoggedSet(draft: SetEntryDraft, loggedSets: readonly LoggedSet[], completedAtIso: string): BuildSetResult {
    if (!Number.isInteger(draft.reps) || draft.reps <= 0 || draft.reps > MAX_REPS_PER_SET) {
        return { ok: false, error: `Enter whole-number reps between 1 and ${MAX_REPS_PER_SET}` };
    }
    if (draft.weightKg !== null && (!Number.isFinite(draft.weightKg) || draft.weightKg < 0 || draft.weightKg > MAX_WEIGHT_KG)) {
        return { ok: false, error: 'Enter a valid weight, or leave it blank for bodyweight' };
    }
    if (draft.gauge && !isValidIntensityGauge(draft.gauge)) {
        return { ok: false, error: 'Enter a valid intensity gauge value' };
    }
    if (loggedSets.length >= MAX_SETS_PER_EXERCISE) {
        return { ok: false, error: `An exercise cannot contain more than ${MAX_SETS_PER_EXERCISE} sets` };
    }
    if (!isValidStrengthInstant(completedAtIso)) {
        return { ok: false, error: 'Could not determine when the set was completed' };
    }
    return {
        ok: true,
        set: {
            setIndex: nextSetIndex(loggedSets),
            weightKg: draft.weightKg,
            reps: draft.reps,
            isWarmup: draft.isWarmup,
            completedAt: completedAtIso,
            ...(draft.gauge ? { gauge: draft.gauge } : {}),
        },
    };
}

/** Adds a new exercise to the session if one matching this identity isn't already present
 *  (confirm-or-amend re-adding the same prescribed exercise is a no-op, not a duplicate
 *  entry). Two free-text exercises are distinct entries even with the same name -- there is
 *  no identity to dedupe against without an `exerciseId`. */
export function upsertExercise(exercises: readonly LoggedExercise[], exerciseId: string | null, freeTextName?: string): LoggedExercise[] {
    if (exerciseId !== null) {
        const alreadyPresent = exercises.some(exercise => exercise.exerciseId === exerciseId);
        if (alreadyPresent) return [...exercises];
    }
    return [...exercises, { exerciseId, sets: [], ...(freeTextName ? { freeTextName } : {}) }];
}

export function appendSetToExercise(exercises: readonly LoggedExercise[], exerciseIndex: number, set: LoggedSet): LoggedExercise[] {
    return exercises.map((exercise, index) => (index === exerciseIndex ? { ...exercise, sets: [...exercise.sets, set] } : exercise));
}
