import type { LoggedExercise, LoggedSet, StrengthSession } from '../engine/models';

/**
 * Per-exercise progressive-overload aggregation (S1.7, ADR-0021). Reads the raw per-set
 * log directly (D-SETLOG) -- this is the goal that needed nothing from Step B or C, and
 * nothing here is derived from or dependent on S2.1's 1RM estimator, which does not exist
 * yet at this point in the plan. "Heaviest set" below is a deliberately plain heuristic
 * (greatest weight moved), not an estimated max -- conflating the two would quietly
 * anticipate a formula this plan explicitly defers to a later, measured decision.
 */

export interface ExerciseIdentity {
    exerciseId: string | null;
    freeTextName?: string;
}

/** A bare `exerciseId` is not identity on its own: two different free-text lifts both have
 *  `exerciseId: null`, and matching on `null` alone would silently merge their history.
 *  Every lookup in this module goes through this key. */
export function exerciseIdentityKey(identity: ExerciseIdentity): string {
    return identity.exerciseId !== null
        ? `catalog:${identity.exerciseId}`
        : `free:${identity.freeTextName?.trim().toLocaleLowerCase() ?? ''}`;
}

function matchesIdentity(exercise: LoggedExercise, identity: ExerciseIdentity): boolean {
    return exerciseIdentityKey({ exerciseId: exercise.exerciseId, freeTextName: exercise.freeTextName }) === exerciseIdentityKey(identity);
}

export interface ExerciseSessionSummary {
    date: string;
    sessionId: string;
    setCount: number;
    workingSetCount: number;
    totalReps: number;
    /** Sum of reps x weightKg across working (non-warm-up) sets only -- warm-up sets are
     *  recorded (D-SETLOG retains them) but excluded here, matching S1.2's rationale for
     *  why `isWarmup` exists: they would otherwise inflate the trend with sets that were
     *  never meant to represent the day's real work. A bodyweight set contributes 0 kg of
     *  tonnage (it still did real reps, counted in `totalReps`) rather than being dropped
     *  from the summary entirely. */
    tonnageKg: number;
    /** The working set with the greatest `weightKg`, ties broken by more reps. `null` when
     *  every set was bodyweight-only or the exercise had no working sets this session. */
    heaviestSet: LoggedSet | null;
}

function isHeavier(candidate: LoggedSet, current: LoggedSet): boolean {
    const candidateWeight = candidate.weightKg ?? 0;
    const currentWeight = current.weightKg ?? 0;
    if (candidateWeight !== currentWeight) return candidateWeight > currentWeight;
    return candidate.reps > current.reps;
}

export function summarizeExerciseSession(session: StrengthSession, identity: ExerciseIdentity): ExerciseSessionSummary | null {
    const sets = session.exercises
        .filter(candidate => matchesIdentity(candidate, identity))
        .flatMap(exercise => exercise.sets);
    if (sets.length === 0) return null;

    const workingSets = sets.filter(set => !set.isWarmup);
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const tonnageKg = workingSets.reduce((sum, set) => sum + set.reps * (set.weightKg ?? 0), 0);
    const heaviestSet = workingSets.reduce<LoggedSet | null>(
        (best, set) => (best === null || isHeavier(set, best) ? set : best),
        null,
    );

    return {
        date: session.date,
        sessionId: session.sessionId,
        setCount: sets.length,
        workingSetCount: workingSets.length,
        totalReps,
        tonnageKg,
        heaviestSet,
    };
}

/** One entry per session that actually logged this exercise, oldest first -- a session
 *  that never touched the exercise contributes nothing (not a zero row). Every session
 *  state is included, not only `completed`: D-SETLOG's raw log is the source of truth
 *  regardless of whether the session was ever formally closed, and an `abandoned` session
 *  still did real work (S1.4's rationale for never deleting one). */
export function summarizeExerciseAcrossSessions(sessions: readonly StrengthSession[], identity: ExerciseIdentity): ExerciseSessionSummary[] {
    return [...sessions]
        .sort((a, b) => a.date.localeCompare(b.date)
            || a.startedAt.localeCompare(b.startedAt)
            || a.sessionId.localeCompare(b.sessionId))
        .map(session => summarizeExerciseSession(session, identity))
        .filter((summary): summary is ExerciseSessionSummary => summary !== null);
}

/** Distinct exercises logged across a set of sessions, in first-seen order -- the input to
 *  an exercise picker that only ever offers exercises the athlete has actually logged. */
export function distinctLoggedExercises(sessions: readonly StrengthSession[]): ExerciseIdentity[] {
    const seen = new Map<string, ExerciseIdentity>();
    for (const session of sessions) {
        for (const exercise of session.exercises) {
            if (exercise.sets.length === 0) continue;
            const identity: ExerciseIdentity = { exerciseId: exercise.exerciseId, ...(exercise.freeTextName ? { freeTextName: exercise.freeTextName } : {}) };
            const key = exerciseIdentityKey(identity);
            if (!seen.has(key)) seen.set(key, identity);
        }
    }
    return [...seen.values()];
}
