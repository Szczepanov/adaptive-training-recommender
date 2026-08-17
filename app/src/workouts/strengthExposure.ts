import type { CompletedExposure } from '../engine/trainingHistory';
import type { EvidenceTier, LoggedExercise, LoggedSet, StrengthSession, TrainingRecord, WorkoutStimulusProfile } from '../engine/models';
import type { StimulusConfidence } from '../engine/stimulus';
import { DEFAULT_COST_BY_MODALITY, DEFAULT_STIMULUS_BY_MODALITY, ZERO_STIMULUS, stimulusConfidenceForTier } from '../engine/completedTraining';
import { EXERCISES } from './exercises';
import type { ExerciseDefinition } from './models';
import { isNearFailureGauge } from './oneRepMax';

/**
 * Set log -> `CompletedExposure` (S3.1, ADR-0021 D-STRCOST). **This module has no effect on
 * any recommendation until Step C's `manualTraining` source (S3.2) is wired in behind a
 * default-off selector and measured (S3.3)** -- building it does not enable it.
 *
 * The magnitudes here are NOT new invented numbers. The overall session cost/stimulus
 * budget is read from the existing, already-in-production `DEFAULT_COST_BY_MODALITY.Strength`
 * / `DEFAULT_STIMULUS_BY_MODALITY.Strength` tables in `completedTraining.ts` -- the same
 * tables a Garmin-detected strength activity is costed against today, looked up **once per
 * session** at the hardest exercise's intensity. What this module adds is a *redistribution*
 * of that one budget's flat `lowerBody`/`upperBody` split, weighted by which exercises were
 * actually logged (`exercises.ts` `primaryMuscles`, weighted by working-set count) -- it does
 * not sum a full session-sized budget once per exercise, which would make a single hard
 * exercise indistinguishable from five (a real defect caught by this module's own tests
 * before it shipped, not a hypothetical). This is a deliberately small, legible change over
 * the existing calibration, not a new formula -- and per D-STRCOST, even this remains a
 * **measured candidate**, not an assertion that the redistribution is correct.
 */

type StrengthIntensity = 'easy' | 'moderate' | 'hard' | 'unknown';

const LOWER_BODY_MUSCLES = new Set(['quadriceps', 'glutes', 'hamstrings', 'calves', 'adductors', 'hip_flexors', 'soleus', 'gastrocnemius', 'tibialis_anterior']);
const UPPER_BODY_MUSCLES = new Set(['chest', 'triceps', 'shoulders', 'lats', 'biceps', 'upper_back', 'traps']);

const INTENSITY_RANK: Record<StrengthIntensity, number> = { easy: 0, unknown: 1, moderate: 2, hard: 3 };

/** No gauge at all on any working set -> `unknown`, matching the existing table's own
 *  `unknown` row rather than guessing `moderate`. A majority of gauged working sets near
 *  failure (S2.1's definition, reused rather than redefined) -> `hard`; otherwise
 *  `moderate`. An exercise with only warm-up sets logged (no working sets yet) -> `easy`. */
function classifyExerciseIntensity(sets: readonly LoggedSet[]): StrengthIntensity {
    const workingSets = sets.filter(set => !set.isWarmup);
    if (workingSets.length === 0) return 'easy';
    const gaugedSets = workingSets.filter(set => set.gauge !== undefined);
    if (gaugedSets.length === 0) return 'unknown';
    const nearFailureCount = gaugedSets.filter(set => isNearFailureGauge(set.gauge)).length;
    return nearFailureCount / gaugedSets.length >= 0.5 ? 'hard' : 'moderate';
}

interface ExerciseSignal {
    identified: boolean;
    intensity: StrengthIntensity;
    weight: number; // working-set count, used to weight this exercise's share of the lower/upper split
    lowerFraction: number;
    upperFraction: number;
}

/** Fraction of an exercise's cost attributed to `lowerBody` vs `upperBody`, from
 *  `primaryMuscles` overlap. No matched muscle on either side (trunk/core work, or an
 *  unrecognised exercise) keeps a neutral 50/50 split rather than being pushed to one side
 *  by a default. A free-text exercise (no `exercises.ts` metadata at all) is neutral for
 *  the same reason. */
function lowerUpperSplit(definition: ExerciseDefinition | undefined): { lowerFraction: number; upperFraction: number } {
    if (!definition) return { lowerFraction: 0.5, upperFraction: 0.5 };
    const lowerCount = definition.primaryMuscles.filter(muscle => LOWER_BODY_MUSCLES.has(muscle)).length;
    const upperCount = definition.primaryMuscles.filter(muscle => UPPER_BODY_MUSCLES.has(muscle)).length;
    const total = lowerCount + upperCount;
    if (total === 0) return { lowerFraction: 0.5, upperFraction: 0.5 };
    return { lowerFraction: lowerCount / total, upperFraction: upperCount / total };
}

function signalForExercise(exercise: LoggedExercise): ExerciseSignal | null {
    const workingSetCount = exercise.sets.filter(set => !set.isWarmup).length;
    if (exercise.sets.length === 0) return null;
    const intensity = classifyExerciseIntensity(exercise.sets);
    // A working-set count of 0 (only warm-ups logged) still contributes to the session's
    // presence/intensity floor but carries no weight in the lower/upper split -- there is
    // no real working-set evidence yet to weight it by.
    const weight = Math.max(workingSetCount, 0.01);

    if (exercise.exerciseId === null) {
        return { identified: false, intensity, weight, lowerFraction: 0.5, upperFraction: 0.5 };
    }
    // `exerciseId` is a soft reference, so a malformed/manual document can point at a
    // catalog entry from another modality. That is not identified strength evidence.
    const definition = EXERCISES.find(candidate => candidate.id === exercise.exerciseId && candidate.modality === 'strength');
    const split = lowerUpperSplit(definition);
    return { identified: definition !== undefined, intensity, weight, ...split };
}

/** `maxStrength`/`hypertrophy` only -- the plan scopes this item to those two axes. The
 *  other six `WorkoutStimulusProfile` axes are left at 0 deliberately, not populated from
 *  the reference table's own small incidental values for them, since asserting a value for
 *  an axis this item was never asked to derive would overstate what was actually decided. */
function strengthOnlyStimulus(intensity: StrengthIntensity): WorkoutStimulusProfile {
    const reference = DEFAULT_STIMULUS_BY_MODALITY.Strength[intensity];
    return { ...ZERO_STIMULUS, maxStrength: reference.maxStrength, hypertrophy: reference.hypertrophy };
}

/** `null` for a session with nothing to derive from: still `in_progress` (data may still
 *  change mid-session; re-deriving before the athlete is done would be premature), or
 *  `completed`/`abandoned` with no logged sets at all. An `abandoned` session with real
 *  logged sets still derives an exposure -- partial work still happened (S1.4's rationale
 *  for never deleting one applies here too). */
export function deriveStrengthExposure(session: StrengthSession): CompletedExposure | null {
    if (session.state === 'in_progress') return null;

    const signals = session.exercises
        .map(signalForExercise)
        .filter((signal): signal is ExerciseSignal => signal !== null);
    if (signals.length === 0) return null;

    // One session-level intensity -- the hardest exercise present, matching the existing
    // Garmin-side convention that a session counts as "hard" if any part of it was, rather
    // than an average that would wash out one genuinely hard exercise among several easy
    // ones. One budget lookup for the whole session, not one per exercise (see module
    // docstring for why summing a full budget per exercise was wrong).
    const sessionIntensity = signals.reduce<StrengthIntensity>(
        (worst, signal) => (INTENSITY_RANK[signal.intensity] > INTENSITY_RANK[worst] ? signal.intensity : worst),
        'easy',
    );
    const budget = DEFAULT_COST_BY_MODALITY.Strength[sessionIntensity];
    const combinedLowerUpper = budget.lowerBody + budget.upperBody;

    const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
    const weightedLowerFraction = signals.reduce((sum, signal) => sum + signal.lowerFraction * signal.weight, 0) / totalWeight;
    const weightedUpperFraction = signals.reduce((sum, signal) => sum + signal.upperFraction * signal.weight, 0) / totalWeight;

    // Every WorkoutCostProfile axis is canonically 0.0-1.0 (see the field comments on the
    // type itself, and firestore.rules' hasValidAxisValue for the same bound enforced
    // elsewhere). A fully lower-body-weighted split of the hard-intensity combined budget
    // (0.8 + 0.7 = 1.5) would otherwise redistribute past 1.0 into a single axis -- the
    // redistribution reallocates the budget, but each resulting axis still needs its own cap.
    const costProfile = {
        ...budget,
        lowerBody: Math.min(1, Math.round(combinedLowerUpper * weightedLowerFraction * 1000) / 1000),
        upperBody: Math.min(1, Math.round(combinedLowerUpper * weightedUpperFraction * 1000) / 1000),
    };
    const stimulusProfile = strengthOnlyStimulus(sessionIntensity);

    // Session-level evidence tier is the WEAKEST link, not the best: a session with three
    // identified exercises and one free-text lift does not get to claim full confidence for
    // the quarter of it that has no metadata behind it.
    const allIdentified = signals.every(signal => signal.identified);
    const evidenceTier: EvidenceTier = allIdentified ? 'athleteClassification' : 'genericModalityFallback';
    const stimulusConfidence: StimulusConfidence = stimulusConfidenceForTier(evidenceTier);

    const startedAtMs = new Date(session.startedAt).getTime();
    const endedAtMs = new Date(session.completedAt ?? session.updatedAt).getTime();
    const durationMin = Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && endedAtMs > startedAtMs
        ? Math.round((endedAtMs - startedAtMs) / 60000)
        : 0;

    const trainingRecordLike: TrainingRecord = {
        type: 'strength',
        duration_min: durationMin,
        training_effect: 0, // No Garmin-equivalent measured training effect exists for a self-logged session.
        intensity_tag: sessionIntensity,
    };

    return {
        date: session.date,
        // A manual log started from a recommendation is evidence about the same physical
        // occurrence as Garmin/adherence reconciliation, not an additional workout.
        occurrenceKey: session.sourceRecommendationDate
            ? `recommendation:${session.sourceRecommendationDate}`
            : `strength:${session.sessionId}`,
        costProfile,
        stimulusProfile,
        stimulusConfidence,
        trainingRecordLike,
        modality: 'Strength',
    };
}
