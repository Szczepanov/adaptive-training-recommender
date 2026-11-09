import type { IntensityGauge, LoggedExercise, LoggedSet, StrengthSession } from './models';
import { isValidDate } from './validationCore';

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

export interface StrengthSessionIssue {
    path: string;
    message: string;
}

const STRENGTH_STATES: readonly string[] = ['in_progress', 'completed', 'abandoned'];

/**
 * Write-side validator for a whole `StrengthSession` (issue #1202, ADR-0053). The rules keep
 * ownership, the sessionId binding, key allow-lists, the `state` enum and its `completedAt`
 * coupling, the `exercises`/`notes` caps and the update pins; this owns `date`,
 * `sourceRecommendationDate`, `schemaVersion`, the `completedAt` type and `sessionRpe`.
 * `StrengthSessionService.startSession` runs it on the new document and `transitionState` on
 * the post-transition document, so the later merge writes (which only touch lifecycle fields,
 * `sessionRpe`, `notes`, `exercises` and `updatedAt`) never introduce an unchecked value.
 */
export function validateStrengthSession(session: StrengthSession): StrengthSessionIssue[] {
    const issues: StrengthSessionIssue[] = [];
    if (typeof session.date !== 'string' || !isValidDate(session.date)) {
        issues.push({ path: 'date', message: 'date must be a real YYYY-MM-DD calendar date' });
    }
    if (session.sourceRecommendationDate !== undefined
        && (typeof session.sourceRecommendationDate !== 'string' || !isValidDate(session.sourceRecommendationDate))) {
        issues.push({ path: 'sourceRecommendationDate', message: 'sourceRecommendationDate must be a real YYYY-MM-DD calendar date' });
    }
    if (session.schemaVersion !== 1) {
        issues.push({ path: 'schemaVersion', message: 'schemaVersion must be 1' });
    }
    if (!STRENGTH_STATES.includes(session.state)) {
        issues.push({ path: 'state', message: 'state is not a recognised strength session state' });
    }
    if (session.completedAt !== undefined && (typeof session.completedAt !== 'string' || !isValidStrengthInstant(session.completedAt))) {
        issues.push({ path: 'completedAt', message: 'completedAt must be a valid instant' });
    }
    // Number.isFinite rejects NaN explicitly, matching the old rule's `>= 0 && <= 10` range,
    // which also rejected it.
    if (session.sessionRpe !== undefined
        && !(typeof session.sessionRpe === 'number' && Number.isFinite(session.sessionRpe) && session.sessionRpe >= 0 && session.sessionRpe <= 10)) {
        issues.push({ path: 'sessionRpe', message: 'sessionRpe must be a finite number between 0 and 10' });
    }
    if (session.notes !== undefined && (typeof session.notes !== 'string' || session.notes.length > 2000)) {
        issues.push({ path: 'notes', message: 'notes must be a string of at most 2000 characters' });
    }
    if (!Array.isArray(session.exercises) || !areValidLoggedExercises(session.exercises)) {
        issues.push({ path: 'exercises', message: 'exercises exceed schema bounds or contain invalid sets' });
    }
    return issues;
}

export function assertValidStrengthSession(session: StrengthSession): void {
    const issues = validateStrengthSession(session);
    if (issues.length > 0) {
        throw new Error(`Invalid strength session: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
    }
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
