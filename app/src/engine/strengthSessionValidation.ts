import type { IntensityGauge, LoggedExercise, LoggedSet } from './models';

/** Shared persisted/UI bounds for ADR-0021 strength-session data. Keeping these in the
 * engine layer prevents the form, parser, and estimators from accepting different values. */
export const MAX_STRENGTH_EXERCISES = 30;
export const MAX_SETS_PER_EXERCISE = 50;
export const MAX_REPS_PER_SET = 1000;
export const MAX_WEIGHT_KG = 1000;
export const MAX_RIR = 10;
export const MIN_RPE_RTS = 1;
export const MAX_RPE_RTS = 10;
export const MAX_VELOCITY_LOSS_PERCENT = 100;

export function isValidIntensityGauge(gauge: IntensityGauge): boolean {
    switch (gauge.scale) {
        case 'rir':
            return Number.isFinite(gauge.value) && gauge.value >= 0 && gauge.value <= MAX_RIR;
        case 'rpe_rts':
            return Number.isFinite(gauge.value) && gauge.value >= MIN_RPE_RTS && gauge.value <= MAX_RPE_RTS;
        case 'velocity_loss':
            return Number.isFinite(gauge.percent)
                && gauge.percent >= 0
                && gauge.percent <= MAX_VELOCITY_LOSS_PERCENT;
        case 'technical':
            return typeof gauge.met === 'boolean'
                && (gauge.note === undefined || (gauge.note.length > 0 && gauge.note.length <= 2000));
    }
}

export function isValidStrengthInstant(value: string): boolean {
    return value.trim() !== '' && Number.isFinite(Date.parse(value));
}

export function isValidLoggedSet(set: LoggedSet): boolean {
    return Number.isInteger(set.setIndex)
        && set.setIndex >= 1
        && set.setIndex <= MAX_SETS_PER_EXERCISE
        && Number.isInteger(set.reps)
        && set.reps >= 1
        && set.reps <= MAX_REPS_PER_SET
        && (set.weightKg === null || (Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= MAX_WEIGHT_KG))
        && isValidStrengthInstant(set.completedAt)
        && (set.gauge === undefined || isValidIntensityGauge(set.gauge))
        && (set.notes === undefined || (set.notes.length > 0 && set.notes.length <= 2000));
}

export function areValidLoggedExercises(exercises: readonly LoggedExercise[]): boolean {
    if (exercises.length > MAX_STRENGTH_EXERCISES) return false;
    return exercises.every(exercise => {
        if (exercise.sets.length > MAX_SETS_PER_EXERCISE) return false;
        if (exercise.freeTextName !== undefined && (exercise.freeTextName.length === 0 || exercise.freeTextName.length > 200)) return false;
        const indices = new Set<number>();
        return exercise.sets.every(set => {
            if (!isValidLoggedSet(set) || indices.has(set.setIndex)) return false;
            indices.add(set.setIndex);
            return true;
        });
    });
}
