export type WorkoutModality =
  | 'cycling'
  | 'running'
  | 'strength'
  | 'field'
  | 'mobility'
  | 'recovery'
  | 'cross_training';

export type WorkoutCategory =
  | 'recovery'
  | 'easy_endurance'
  | 'threshold'
  | 'over_under'
  | 'surge_tolerance'
  | 'race_simulation'
  | 'full_body_strength'
  | 'power_maintenance'
  | 'field_maintenance'
  | 'mobility_recovery';

export type TrainingObjective =
  | 'active_recovery'
  | 'aerobic_base'
  | 'lactate_threshold'
  | 'high_aerobic_power'
  | 'surge_tolerance'
  | 'fatigue_resistant_finish'
  | 'strength_maintenance'
  | 'power_maintenance'
  | 'tissue_capacity'
  | 'acceleration'
  | 'braking'
  | 'change_of_direction'
  | 'football_skill'
  | 'mobility'
  | 'travel_maintenance'
  | 'running_exposure'
  | 'freshness'
  | 'race_execution';

export type Equipment =
  | 'bike'
  | 'indoor_bike'
  | 'power_meter'
  | 'heart_rate_monitor'
  | 'barbell'
  | 'dumbbells'
  | 'rack'
  | 'bench'
  | 'pullup_bar'
  | 'kettlebell'
  | 'resistance_bands'
  | 'sled'
  | 'medicine_ball'
  | 'hurdles'
  | 'cones'
  | 'field'
  | 'treadmill'
  | 'foam_roller'
  | 'bodyweight'
  | 'hotel_gym';

export type LoadLevel = 1 | 2 | 3 | 4 | 5;

export interface ExerciseDefinition {
  id: string;
  version: number;
  name: string;
  modality: WorkoutModality;
  movementPatterns: string[];
  primaryMuscles: string[];
  equipment: Equipment[];
  impact: 'none' | 'low' | 'moderate' | 'high';
  eccentricLoad: 'none' | 'low' | 'moderate' | 'high';
  coordinationDemand: 'low' | 'moderate' | 'high';
  contraindicationTags: string[];
  instruction: string;
}

export type StepDuration =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number }
  | { type: 'repetitions'; repetitions: number }
  | { type: 'open' };

export type IntensityTarget =
  | { type: 'rpe'; min: number; max: number }
  | { type: 'heart_rate_zone'; zone: number }
  | { type: 'power_zone'; zone: number }
  | { type: 'ftp_percent'; min: number; max: number }
  | { type: 'cadence'; minRpm: number; maxRpm: number }
  | { type: 'reps_in_reserve'; min: number; max: number }
  | { type: 'technical_quality'; cue: string };

export interface WorkoutStep {
  id: string;
  exerciseId: string;
  name: string;
  duration: StepDuration;
  target?: IntensityTarget;
  sets?: number;
  restAfterSec?: number;
  notes?: string[];
  optional?: boolean;
}

export interface WorkoutBlock {
  id: string;
  name: string;
  role: 'warmup' | 'activation' | 'main' | 'accessory' | 'cooldown';
  steps: WorkoutStep[];
}

export interface WorkoutVariantStepOverride {
  stepId: string;
  sets?: number;
  durationSeconds?: number;
  restAfterSec?: number;
  target?: IntensityTarget;
  omit?: boolean;
}

export interface WorkoutVariant {
  id: 'full' | 'reduced' | 'return_to_training';
  targetDurationMin: number;
  loadMultiplier: number;
  rationale: string;
  stepOverrides: WorkoutVariantStepOverride[];
}

export type WorkoutParameterUnit =
  | 'minutes'
  | 'seconds'
  | 'repetitions'
  | 'sets'
  | 'rpe'
  | 'reps_in_reserve';



export type WorkoutParameterProperty =
  | 'sets'
  | 'duration.seconds'
  | 'restAfterSec'
  | 'target.rpe.min'
  | 'target.rpe.max';

export interface WorkoutParameterBinding {
  stepId: string;
  property: WorkoutParameterProperty;
  zeroBehavior?: 'omit_step' | 'use_zero';
}

/** A coach- or engine-adjustable dimension of a generic workout family. */
export interface WorkoutParameter {
  id: string;
  label: string;
  unit: WorkoutParameterUnit;
  defaultValue: number;
  minimum: number;
  maximum: number;
  step: number;
  appliesToStepIds: string[];
  bindings: WorkoutParameterBinding[];
  description: string;
}

export type WorkoutParameterTransform = 'identity' | 'minutes_to_seconds';
export type WorkoutParameterZeroBehavior = 'omit_step' | 'allow_zero';

export type WorkoutParameterStepField =
  | 'sets'
  | 'duration.seconds'
  | 'duration.repetitions'
  | 'restAfterSec'
  | 'target.rpe'
  | 'target.reps_in_reserve';

export interface WorkoutParameterStepFieldBinding {
  kind: 'step_field';
  parameterId: string;
  stepIds: string[];
  field: WorkoutParameterStepField;
  transform?: WorkoutParameterTransform;
  zeroBehavior?: WorkoutParameterZeroBehavior;
  /** Offsets applied around the resolved value for range targets. */
  range?: { minOffset: number; maxOffset: number };
}

export type WorkoutParameterResolver =
  | 'embedded_short_surges'
  | 'embedded_gap_closing_efforts'
  | 'over_under_internal_pattern'
  | 'walk_run_distribution';

export interface WorkoutParameterResolverBinding {
  kind: 'resolver';
  parameterId: string;
  stepIds: string[];
  resolver: WorkoutParameterResolver;
}

export type WorkoutParameterSetBinding =
  | WorkoutParameterStepFieldBinding
  | WorkoutParameterResolverBinding;

/** Explicitly describes how every adjustable parameter changes a prescription. */
export interface WorkoutParameterBindingSet {
  workoutId: string;
  bindings: WorkoutParameterSetBinding[];
}

export interface WorkoutDurationRange {
  /** Minimum target duration across all variants of the workout family. */
  minimumMin: number;
  /** Default duration for the canonical full workout. */
  defaultMin: number;
  /** Maximum target duration across all variants of the workout family. */
  maximumMin: number;
}

export interface WorkoutDefinition {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'deprecated';
  name: string;
  description: string;
  modality: WorkoutModality;
  category: WorkoutCategory;
  objectives: TrainingObjective[];
  /**
   * Canonical full-workout duration range. Reduced and return-to-training
   * variants may intentionally target a duration below minimumMin.
   */
  duration: WorkoutDurationRange;
  loadProfile: {
    cardiovascular: LoadLevel;
    muscular: LoadLevel;
    mechanical: LoadLevel;
    eccentric: LoadLevel;
    coordination: LoadLevel;
    recoveryHours: number;
  };
  eligibility: {
    minimumReadiness?: number;
    maximumSoreness?: number;
    minimumDaysAfterHardLowerBody?: number;
    forbiddenPainFlags?: string[];
  };
  equipment: Equipment[];
  contraindicationTags: string[];
  blocks: WorkoutBlock[];
  variants: WorkoutVariant[];
  parameters?: WorkoutParameter[];
  regressions: string[];
  progressions: string[];
  substitutions: Array<{
    exerciseId: string;
    substituteExerciseId: string;
    reason: string;
  }>;
  garmin: {
    exportable: boolean;
    supportedSport?: 'cycling' | 'running';
  };
  tags: string[];
  sourceNotes: string[];
}

export interface WorkoutPrescription {
  id: string;
  userId: string;
  date: string;
  workoutId: string;
  workoutVersion: number;
  variantId: WorkoutVariant['id'];
  targetDurationMin: number;
  adjustedBlocks: WorkoutBlock[];
  /** Presentation-ready steps. This is deliberately a snapshot so a later catalogue
   * edit cannot rewrite what was prescribed on an earlier date. */
  displayBlocks: PrescriptionBlock[];
  resolvedParameters?: Record<string, number>;
  rationale: string[];
  adjustmentReasons: string[];
  source: {
    recommendationEngineVersion: string;
    recoverySnapshotDate?: string;
    checkinDate?: string;
  };
  status: 'recommended' | 'accepted' | 'scheduled' | 'completed' | 'skipped' | 'replaced';
}

export interface PrescriptionBlock {
  id: string;
  name: string;
  role: WorkoutBlock['role'];
  steps: PrescriptionStep[];
}

/** A UI-safe representation of one concrete instruction. Targets remain relative
 * unless a dated athlete measurement makes an absolute value defensible. */
export interface PrescriptionStep {
  id: string;
  name: string;
  dose: string;
  rest?: string;
  targets: string[];
  cues: string[];
  optional?: boolean;
}

export interface AthletePerformanceProfile {
  ftpWatts?: number | null;
  thresholdPaceSecPerKm?: number | null;
  lthrBpm?: number | null;
  /** Exercise id -> estimated 1RM in kilograms. Optional by design: RIR remains
   * the safe load prescription when a tested or recent estimate is unavailable. */
  estimated1RmKg?: Record<string, number>;
  measuredAt?: string | null;
}
