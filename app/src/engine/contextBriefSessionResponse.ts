import type { ActivityExerciseSet, DailySubjectiveCheckin, NormalizedGarminActivity } from './models';
import type { Insufficient } from './contextBriefResponseFeatures';
import { addDaysToLocalDateString } from '../utils/localDate';

/* Issue #814: strength-progression and next-day response features for the context brief.
 * Pure and display-only (no recommendation authority). Strength output is emitted only when
 * every working set carries an exercise identity; next-day linkage is observational. */

export interface ExerciseTopSet {
    exercise: string;
    workingSets: number;
    topWeightKg?: number;
    topReps?: number;
    prior?: { date: string; topWeightKg?: number; topReps?: number };
}

export type StrengthProgression =
    | { state: 'available'; exercises: ExerciseTopSet[] }
    | Insufficient;

const UNIDENTIFIED = new Set(['', 'UNKNOWN']);

function workingSets(activity: NormalizedGarminActivity): ActivityExerciseSet[] {
    return (activity.exerciseSets ?? []).filter(set => (set.setType ?? 'ACTIVE').toUpperCase() !== 'REST');
}

function identityOf(set: ActivityExerciseSet): string | null {
    const name = set.exerciseName?.trim().toUpperCase() ?? '';
    return UNIDENTIFIED.has(name) ? null : name;
}

/** Heaviest set, ties broken by more reps; bodyweight sets rank by reps alone. */
function topSet(sets: readonly ActivityExerciseSet[]): { topWeightKg?: number; topReps?: number } | null {
    const ranked = sets
        .filter(set => set.weightKg !== undefined || set.repetitionCount !== undefined)
        .sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.repetitionCount ?? 0) - (a.repetitionCount ?? 0));
    if (ranked.length === 0) return null;
    const best = ranked[0];
    return {
        ...(best.weightKg !== undefined && best.weightKg > 0 ? { topWeightKg: best.weightKg } : {}),
        ...(best.repetitionCount !== undefined ? { topReps: best.repetitionCount } : {}),
    };
}

function setsByExercise(activity: NormalizedGarminActivity): Map<string, ActivityExerciseSet[]> {
    const grouped = new Map<string, ActivityExerciseSet[]>();
    for (const set of workingSets(activity)) {
        const identity = identityOf(set);
        if (identity) grouped.set(identity, [...(grouped.get(identity) ?? []), set]);
    }
    return grouped;
}

/** Top-set load/reps per identified exercise, against the most recent prior session in
 * `history` with the same exercise identity. No estimated 1RM: the canonical estimator
 * (`workouts/oneRepMax.ts`) needs near-failure effort evidence that device sets lack. */
export function deriveStrengthProgression(
    activity: NormalizedGarminActivity,
    history: readonly NormalizedGarminActivity[],
): StrengthProgression {
    const sets = workingSets(activity);
    if (sets.length === 0) return { state: 'insufficient_evidence', reason: 'no working sets recorded' };
    const unidentified = sets.filter(set => identityOf(set) === null).length;
    if (unidentified > 0) {
        return { state: 'insufficient_evidence', reason: `${unidentified} of ${sets.length} working sets lack an exercise identity` };
    }
    const priors = history
        .filter(item => item.activityId !== activity.activityId && item.date < activity.date)
        .sort((a, b) => b.date.localeCompare(a.date) || a.activityId.localeCompare(b.activityId));
    const exercises: ExerciseTopSet[] = [];
    for (const [exercise, exerciseSets] of setsByExercise(activity)) {
        const top = topSet(exerciseSets);
        if (!top) continue;
        const priorSession = priors
            .map(prior => ({ prior, top: topSet(setsByExercise(prior).get(exercise) ?? []) }))
            .find(entry => entry.top !== null);
        exercises.push({
            exercise,
            workingSets: exerciseSets.length,
            ...top,
            ...(priorSession ? { prior: { date: priorSession.prior.date, ...priorSession.top } } : {}),
        });
    }
    if (exercises.length === 0) return { state: 'insufficient_evidence', reason: 'no load or repetitions recorded' };
    return { state: 'available', exercises: exercises.sort((a, b) => a.exercise.localeCompare(b.exercise)) };
}

export interface CheckinReading {
    soreness: number | null;
    fatigue: number | null;
    painOrInjury: boolean;
}

export type NextDayResponse =
    | {
        state: 'available';
        sessionDay: CheckinReading | null;
        nextDay: CheckinReading;
        otherActivitiesSameDay: number;
    }
    | Insufficient;

function reading(checkin: DailySubjectiveCheckin): CheckinReading {
    return { soreness: checkin.soreness, fatigue: checkin.fatigue, painOrInjury: checkin.painOrInjury };
}

/** Check-ins as read for the brief: `unreadableDates` are dates whose stored record failed
 * validation and was dropped — unreadable, which is not the same as "not recorded". */
export interface CheckinHistory {
    records: readonly DailySubjectiveCheckin[];
    unreadableDates: readonly string[];
    /** Invalid records whose date itself could not be read; any of them may be the one. */
    undatedUnreadable?: number;
}

/** Observational link from a session to the following morning's check-in. `checkins`
 * `null` means the check-in history could not be read, which is not the same as "none". */
export function deriveNextDayResponse(
    activity: NormalizedGarminActivity,
    checkins: CheckinHistory | null,
    sameWindowActivities: readonly NormalizedGarminActivity[],
    asOfDate: string,
): NextDayResponse {
    if (checkins === null) return { state: 'insufficient_evidence', reason: 'check-in history unavailable' };
    const nextDate = addDaysToLocalDateString(activity.date, 1);
    if (nextDate > asOfDate) return { state: 'insufficient_evidence', reason: 'next morning not yet reached' };
    const next = checkins.records.find(checkin => checkin.date === nextDate);
    if (!next) {
        if (checkins.unreadableDates.includes(nextDate)) {
            return { state: 'insufficient_evidence', reason: 'next-morning check-in unreadable (invalid stored record)' };
        }
        return (checkins.undatedUnreadable ?? 0) > 0
            ? { state: 'insufficient_evidence', reason: 'next-morning check-in possibly unreadable (an invalid stored record has no readable date)' }
            : { state: 'insufficient_evidence', reason: 'no next-morning check-in recorded' };
    }
    const sessionDay = checkins.records.find(checkin => checkin.date === activity.date);
    return {
        state: 'available',
        sessionDay: sessionDay ? reading(sessionDay) : null,
        nextDay: reading(next),
        otherActivitiesSameDay: sameWindowActivities
            .filter(item => item.date === activity.date && item.activityId !== activity.activityId).length,
    };
}
