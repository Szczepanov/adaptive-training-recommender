import type { Recommendation } from '../engine/models.ts';
import { EXERCISES } from './exercises.ts';
import { WORKOUTS } from './catalog.ts';
import type {
  AthletePerformanceProfile,
  IntensityTarget,
  PrescriptionBlock,
  PrescriptionStep,
  WorkoutBlock,
  WorkoutDefinition,
  WorkoutPrescription,
  WorkoutStep
} from './models.ts';

/** The readiness engine chooses session families; this table makes the detailed
 * execution contract explicit rather than inferring it from a display title. */
const TEMPLATE_TO_WORKOUT: Record<string, string> = {
  rest_01: 'rest_complete_01',
  mob_01: 'recovery_mobility_tissue_01',
  mob_02: 'recovery_mobility_tissue_01',
  end_easy_01: 'cycling_zone2_standard_01',
  end_easy_02: 'running_walk_run_01',
  end_easy_03: 'running_walk_run_01',
  end_mod_01: 'running_walk_run_01',
  end_mod_02: 'cycling_controlled_threshold_4x8_01',
  str_upper_01: 'strength_upper_body_trunk_01',
  str_upper_02: 'strength_upper_body_trunk_01',
  str_lower_01: 'strength_full_body_maintenance_01',
  str_full_01: 'strength_full_body_maintenance_01',
  str_full_02: 'travel_strength_maintenance_01',
  end_hard_01: 'running_walk_run_01',
  end_hard_02: 'cycling_controlled_threshold_4x8_01',
  end_hard_03: 'running_walk_run_01'
};

const strengthTempos: Record<string, string> = {
  hang_power_clean: '20X1',
  front_squat: '31X1',
  romanian_deadlift: '3111',
  bench_press: '31X1',
  pull_up: '21X1',
  dumbbell_row: '2111',
  goblet_squat: '3111',
  push_up: '3111',
  tibialis_raise: '2111'
};

const exerciseById = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const workoutById = new Map(WORKOUTS.map((workout) => [workout.id, workout]));

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 && remainder > 0 ? `${minutes}:${String(remainder).padStart(2, '0')} min` : minutes > 0 ? `${minutes} min` : `${seconds} sec`;
}

function formatPace(secondsPerKm: number): string {
  return `${Math.floor(secondsPerKm / 60)}:${String(Math.round(secondsPerKm % 60)).padStart(2, '0')}/km`;
}

function formatDose(step: WorkoutStep): string {
  const repetitions = step.duration.type === 'repetitions' ? `${step.duration.repetitions} reps` : undefined;
  const duration = step.duration.type === 'time' ? formatSeconds(step.duration.seconds) : undefined;
  const distance = step.duration.type === 'distance' ? `${step.duration.meters} m` : undefined;
  const unit = repetitions ?? duration ?? distance ?? 'As needed';
  return step.sets ? `${step.sets} × ${unit}` : unit;
}

function formatTarget(target: IntensityTarget, profile?: AthletePerformanceProfile): string {
  switch (target.type) {
    case 'rpe': return `RPE ${target.min}–${target.max}/10`;
    case 'heart_rate_zone': return `Heart-rate zone ${target.zone}`;
    case 'power_zone': return `Power zone ${target.zone}`;
    case 'cadence': return `${target.minRpm}–${target.maxRpm} rpm`;
    case 'reps_in_reserve': return `${target.min}–${target.max} reps in reserve`;
    case 'technical_quality': return target.cue;
    case 'ftp_percent': {
      const relative = `${target.min}–${target.max}% FTP`;
      if (!profile?.ftpWatts || profile.ftpWatts <= 0) return relative;
      return `${relative} (${Math.round(profile.ftpWatts * target.min / 100)}–${Math.round(profile.ftpWatts * target.max / 100)} W)`;
    }
  }
}

function additionalTargets(step: WorkoutStep, workout: WorkoutDefinition, profile?: AthletePerformanceProfile): string[] {
  const targets: string[] = [];
  if (step.target) targets.push(formatTarget(step.target, profile));

  if (workout.modality === 'cycling' && !step.target?.type.includes('ftp')) {
    targets.push(profile?.ftpWatts ? 'Power: use RPE target; no fixed watts for this step' : 'Power: set FTP in Preferences to unlock watts where applicable');
  }
  if (workout.modality === 'running') {
    targets.push(profile?.thresholdPaceSecPerKm
      ? `Threshold reference: ${formatPace(profile.thresholdPaceSecPerKm)}; let the RPE target set today’s pace`
      : 'Pace: use RPE; add threshold pace in Preferences to show min/km guidance');
  }
  if ((workout.modality === 'cycling' || workout.modality === 'running') && profile?.lthrBpm) {
    targets.push(`HR guardrail: stay below LTHR ${profile.lthrBpm} bpm unless the interval target says otherwise`);
  }
  if (workout.modality === 'strength') {
    const estimated1Rm = profile?.estimated1RmKg?.[step.exerciseId];
    if (estimated1Rm) {
      const repetitions = step.duration.type === 'repetitions' ? step.duration.repetitions : undefined;
      const percentage = repetitions && repetitions <= 5 ? [0.70, 0.80] : repetitions && repetitions <= 8 ? [0.60, 0.75] : [0.45, 0.65];
      targets.push(`Starting load: ${Math.round(estimated1Rm * percentage[0] / 2.5) * 2.5}–${Math.round(estimated1Rm * percentage[1] / 2.5) * 2.5} kg (about ${percentage[0] * 100}–${percentage[1] * 100}% e1RM); RIR takes precedence`);
    }
    const tempo = strengthTempos[step.exerciseId];
    if (tempo) targets.push(`Tempo ${tempo} (lower / pause / lift / pause)`);
  }
  return targets;
}

function toDisplayStep(step: WorkoutStep, workout: WorkoutDefinition, profile?: AthletePerformanceProfile): PrescriptionStep {
  const exercise = exerciseById.get(step.exerciseId);
  return {
    id: step.id,
    name: step.name,
    dose: formatDose(step),
    ...(step.restAfterSec !== undefined ? { rest: `${formatSeconds(step.restAfterSec)} recovery` } : {}),
    targets: additionalTargets(step, workout, profile),
    cues: [exercise?.instruction, ...(step.notes ?? [])].filter((cue): cue is string => Boolean(cue)),
    ...(step.optional ? { optional: true } : {})
  };
}

function applyVariant(workout: WorkoutDefinition, variantId: 'full' | 'reduced' | 'return_to_training'): WorkoutBlock[] {
  const variant = workout.variants.find((item) => item.id === variantId) ?? workout.variants[0];
  const overrides = new Map(variant.stepOverrides.map((override) => [override.stepId, override]));
  return workout.blocks.map((block) => ({
    ...block,
    steps: block.steps.flatMap((step) => {
      const override = overrides.get(step.id);
      if (override?.omit) return [];
      const duration = override?.durationSeconds !== undefined && step.duration.type === 'time'
        ? { type: 'time' as const, seconds: override.durationSeconds }
        : step.duration;
      return [{ ...step, duration, ...(override?.sets !== undefined ? { sets: override.sets } : {}), ...(override?.restAfterSec !== undefined ? { restAfterSec: override.restAfterSec } : {}), ...(override?.target ? { target: override.target } : {}) }];
    })
  }));
}

function variantFor(rec: Recommendation): 'full' | 'reduced' | 'return_to_training' {
  if (rec.adjustment?.direction === 'easier') return 'reduced';
  if (rec.mode === 'recover' && rec.template.category !== 'Rest') return 'return_to_training';
  return 'full';
}

export function resolveWorkoutPrescription(
  recommendation: Recommendation,
  userId: string,
  date: string,
  profile?: AthletePerformanceProfile
): WorkoutPrescription | null {
  const workoutId = TEMPLATE_TO_WORKOUT[recommendation.template.id];
  const workout = workoutId ? workoutById.get(workoutId) : undefined;
  if (!workout) return null;

  const variantId = variantFor(recommendation);
  const variant = workout.variants.find((item) => item.id === variantId) ?? workout.variants[0];
  const adjustedBlocks = applyVariant(workout, variantId);
  const displayBlocks: PrescriptionBlock[] = adjustedBlocks.map((block) => ({
    id: block.id,
    name: block.name,
    role: block.role,
    steps: block.steps.map((step) => toDisplayStep(step, workout, profile))
  }));

  return {
    id: `${date}_${workout.id}_${variantId}`,
    userId,
    date,
    workoutId: workout.id,
    workoutVersion: workout.version,
    variantId,
    targetDurationMin: variant.targetDurationMin,
    adjustedBlocks,
    displayBlocks,
    resolvedParameters: Object.fromEntries((workout.parameters ?? []).map((parameter) => [parameter.id, parameter.defaultValue])),
    rationale: [workout.description, variant.rationale],
    adjustmentReasons: recommendation.adjustment ? [recommendation.adjustment.rationale] : [],
    source: { recommendationEngineVersion: 'daily-recommendation-v2' },
    status: 'recommended'
  };
}

export function getPrescriptionLegend(): string {
  return 'RPE is effort out of 10. RIR is repetitions left before failure. Four-part tempo is lower / pause / lift / pause; X means accelerate with control.';
}
