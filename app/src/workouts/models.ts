export type WorkoutModality =
  | 'cycling'
  | 'running'
  | 'strength'
  | 'field'
  | 'mobility'
  | 'recovery';

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
  | 'mobility';

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
  | 'bodyweight';

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

export interface WorkoutDefinition {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'deprecated';
  name: string;
  description: string;
  modality: WorkoutModality;
  category: WorkoutCategory;
  objectives: TrainingObjective[];
  duration: {
    defaultMin: number;
    minimumMin: number;
    maximumMin: number;
  };
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
  rationale: string[];
  adjustmentReasons: string[];
  source: {
    recommendationEngineVersion: string;
    recoverySnapshotDate?: string;
    checkinDate?: string;
  };
  status: 'recommended' | 'accepted' | 'scheduled' | 'completed' | 'skipped' | 'replaced';
}
