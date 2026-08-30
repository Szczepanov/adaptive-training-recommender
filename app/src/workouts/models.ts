export type WorkoutModality =
  | 'cycling'
  | 'running'
  | 'swimming'
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
  | 'technical_skill'
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
  | 'sprint_mechanics'
  | 'acceleration_mechanics'
  | 'max_velocity_mechanics'
  | 'deceleration_mechanics'
  | 'cycling_pedalling_economy'
  | 'cycling_handling'
  | 'cycling_group_riding'
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
  | 'football'
  | 'mini_hurdles'
  | 'safe_riding_area'
  | 'treadmill'
  | 'foam_roller'
  | 'bodyweight'
  | 'plyo_box'
  | 'cable_machine'
  | 'hotel_gym'
  | 'pool';

export type LoadLevel = 1 | 2 | 3 | 4 | 5;

/** Bounded metadata used to validate authored session references, never to infer coaching intent. */
export type ExerciseFamily = 'cycling' | 'running' | 'strength' | 'field_drill' | 'mobility' | 'recovery';
export type ExerciseDoseKind = 'repetition' | 'duration' | 'distance' | 'checkoff';
export type ExerciseLoadKind = 'bodyweight' | 'mass' | 'band' | 'percent_max' | 'percent_one_rm' | 'descriptive' | 'unloaded';
export type ExerciseLaterality = 'bilateral' | 'per_side' | 'alternating';
export type ExerciseMeasurementProfile = 'repetitions' | 'duration' | 'distance' | 'timed_sprint' | 'checkoff';
export type FieldDomainFacet = 'acceleration' | 'max_velocity' | 'braking' | 'change_of_direction' | 'elastic';

export interface ExerciseFacets {
  family: ExerciseFamily;
  variant?: string;
  allowedDoseKinds: ExerciseDoseKind[];
  allowedLoadKinds: ExerciseLoadKind[];
  allowedLaterality: ExerciseLaterality[];
  measurementProfile: ExerciseMeasurementProfile;
  /** Field-only exposure tags. They are descriptive metadata, not a load model. */
  fieldDomains?: FieldDomainFacet[];
  /** Coarse heuristic labels retained separately from diagnosis or clinical claims. */
  tissueDemand?: string[];
  safetyTags?: string[];
}

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
  /** Optional for catalog compatibility; new multidomain fixture movements declare it. */
  facets?: ExerciseFacets;
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
  | {
      type: 'technical_quality';
      cue: string;
      successCriteria?: string[];
      commonFaults?: string[];
      stopConditions?: string[];
    };

export type TargetRole = 'primary' | 'secondary' | 'cap' | 'technique' | 'fallback';

export type MetricRequirement = 'power_meter' | 'heart_rate_monitor' | 'cadence_data';

export type TargetValue =
  | { min: number; max: number }
  | { minRpm: number; maxRpm: number }
  | { zone: number; minBpm?: number; maxBpm?: number }
  | { minBpm: number; maxBpm: number }
  | { minSecPerKm?: number; maxSecPerKm?: number; relativeToThresholdPercent?: { min: number; max: number } }
  | { cue: string; successCriteria?: string[]; commonFaults?: string[]; stopConditions?: string[] };

export interface StepTarget {
  role: TargetRole;
  metric:
    | 'rpe'
    | 'ftp_percent'
    | 'heart_rate_zone'
    | 'heart_rate_bpm'
    | 'cadence'
    | 'pace'
    | 'reps_in_reserve'
    | 'estimated_1rm_percent'
    | 'technical_quality';
  value: TargetValue;
  requires?: MetricRequirement;
}

export interface DisplayTarget {
  role: TargetRole;
  label: string;
  metric: string;
  valueText: string;
  rawWatts?: { min: number; max: number };
  staleTag?: boolean;
}

export type WorkoutEnvironment = 'trainer' | 'field' | 'closed_road' | 'low_traffic_road';

export interface TechnicalRequirements {
  environment: WorkoutEnvironment[];
  supervision: 'none' | 'recommended' | 'required';
  prerequisiteSkills?: string[];
  stopConditions: string[];
}

export interface WorkoutStep {
  id: string;
  exerciseId: string;
  name: string;
  duration: StepDuration;
  target?: IntensityTarget;
  targets?: StepTarget[];
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
  targets?: StepTarget[];
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
  /** Technical sessions carry execution and environment constraints in addition to load. */
  technicalRequirements?: TechnicalRequirements;
  /** Links a detailed prescription to the coarse readiness-engine session family. */
  engineTemplateIds?: string[];
  /** Deterministic tie-breaker when several detailed workouts implement one template. */
  engineTemplatePriority?: number;
  /** Kept out of automatic recommendations until the athlete confirms the setting. */
  manualOnly?: boolean;
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
  structuredTargets?: DisplayTarget[];
  cues: string[];
  stopConditions?: string[];
  optional?: boolean;
}

export interface SportCyclingProfile {
  ftpWatts?: number | null;
  powerZoneSystem?: 'garmin_7_zone_ftp' | 'custom';
  powerZones?: Record<number, { minPercentFtp: number; maxPercentFtp?: number }>;
  lthrBpm?: number | null;
  heartRateZones?: Record<number, { minBpm: number; maxBpm?: number }>;
  measuredAt?: string | null;
}

export interface SportRunningProfile {
  thresholdPaceSecPerKm?: number | null;
  lthrBpm?: number | null;
  heartRateZones?: Record<number, { minBpm: number; maxBpm?: number }>;
  measuredAt?: string | null;
}

export interface SportStrengthProfile {
  estimated1RmKg?: Record<string, number>;
  measuredAt?: string | null;
}

export interface DeviceCapabilities {
  powerMeter?: boolean;
  heartRateMonitor?: boolean;
  cadenceData?: boolean;
}

/** `derived` added for ADR-0021 D-1RMSRC: a 1RM estimated from logged sets (S2.1) joins
 *  the same ownership vocabulary as a Garmin import rather than bypassing it, and must
 *  never overwrite `manual` or `coach` -- the reason `targetSources` exists at all. */
export type TargetSource = 'garmin' | 'manual' | 'coach' | 'derived';

export interface AthletePerformanceProfile {
  // Legacy and biometric top-level fields
  ftpWatts?: number | null;
  thresholdPaceSecPerKm?: number | null;
  lthrBpm?: number | null;
  estimated1RmKg?: Record<string, number>;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  weightMeasuredAt?: string | null;
  /** Field-level ownership prevents a Garmin refresh from replacing a coach target. */
  targetSources?: Partial<Record<'ftpWatts' | 'thresholdPaceSecPerKm' | 'lthrBpm' | 'cyclingLthr' | 'runningLthr' | 'weightKg' | 'bodyFatPct', TargetSource>>;
  /** Per-exercise 1RM provenance, parallel to `estimated1RmKg`/`strength.estimated1RmKg`
   *  (ADR-0021 D-1RMSRC) -- keyed by the same `exerciseId` as those maps. An exercise
   *  present in `estimated1RmKg` with no entry here has no recorded source, and per
   *  ADR-0021's literal text S2.2's writer treats that as writable, the same as a fully
   *  absent value -- only an explicit `manual` or `coach` source is protected. */
  estimated1RmSources?: Record<string, { source: TargetSource; computedAt?: string }>;
  /** Most recent provider import, retained even when the effective target is manual. */
  garmin?: {
    ftpWatts?: number | null;
    thresholdPaceSecPerKm?: number | null;
    lthrBpm?: number | null;
    cyclingLthrBpm?: number | null;
    runningLthrBpm?: number | null;
    weightKg?: number | null;
    bodyFatPct?: number | null;
    weightMeasuredAt?: string | null;
    fetchedAt: string;
    ftpMeasuredAt?: string | null;
    thresholdMeasuredAt?: string | null;
    lthrMeasuredAt?: string | null;
  };

  // V3 Sport-scoped profiles
  cycling?: SportCyclingProfile;
  running?: SportRunningProfile;
  strength?: SportStrengthProfile;

  // Device capabilities (default hardware context)
  capabilities?: DeviceCapabilities;

  measuredAt?: string | null;
}
