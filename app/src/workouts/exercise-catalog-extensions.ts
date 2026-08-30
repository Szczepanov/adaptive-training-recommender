import type {
  ExerciseDefinition,
  ExerciseFacets,
  ExerciseLaterality,
  ExerciseLoadKind,
} from './models.ts';

function strengthReps(
  variant: string,
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
  allowedLoadKinds: ExerciseLoadKind[] = ['mass', 'descriptive'],
): ExerciseFacets {
  return {
    family: 'strength',
    variant,
    allowedDoseKinds: ['repetition'],
    allowedLoadKinds,
    allowedLaterality,
    measurementProfile: 'repetitions',
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function strengthDuration(
  variant: string,
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
  allowedLoadKinds: ExerciseLoadKind[] = ['bodyweight', 'unloaded', 'descriptive'],
): ExerciseFacets {
  return {
    family: 'strength',
    variant,
    allowedDoseKinds: ['duration'],
    allowedLoadKinds,
    allowedLaterality,
    measurementProfile: 'duration',
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function strengthCarry(
  variant: string,
  tissueDemand: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
): ExerciseFacets {
  return {
    family: 'strength',
    variant,
    allowedDoseKinds: ['distance', 'duration'],
    allowedLoadKinds: ['mass', 'descriptive'],
    allowedLaterality,
    measurementProfile: 'distance',
    ...(tissueDemand.length ? { tissueDemand } : {}),
  };
}

function fieldReps(
  variant: string,
  fieldDomains: NonNullable<ExerciseFacets['fieldDomains']> = [],
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
): ExerciseFacets {
  return {
    family: 'field_drill',
    variant,
    allowedDoseKinds: ['repetition', 'distance'],
    allowedLoadKinds: ['unloaded', 'descriptive'],
    allowedLaterality,
    measurementProfile: 'repetitions',
    ...(fieldDomains.length ? { fieldDomains } : {}),
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function fieldDuration(
  variant: string,
  fieldDomains: NonNullable<ExerciseFacets['fieldDomains']> = [],
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
): ExerciseFacets {
  return {
    family: 'field_drill',
    variant,
    allowedDoseKinds: ['duration', 'checkoff'],
    allowedLoadKinds: ['unloaded', 'descriptive'],
    allowedLaterality,
    measurementProfile: 'duration',
    ...(fieldDomains.length ? { fieldDomains } : {}),
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function fieldTimed(
  variant: string,
  fieldDomains: NonNullable<ExerciseFacets['fieldDomains']>,
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
): ExerciseFacets {
  return {
    family: 'field_drill',
    variant,
    allowedDoseKinds: ['distance'],
    allowedLoadKinds: ['unloaded'],
    allowedLaterality,
    measurementProfile: 'timed_sprint',
    fieldDomains,
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function runningDuration(
  variant: string,
  tissueDemand: string[] = ['calf', 'hamstring', 'knee_extensor'],
  safetyTags: string[] = ['knee_swelling', 'worsening_achilles_pain'],
): ExerciseFacets {
  return {
    family: 'running',
    variant,
    allowedDoseKinds: ['duration', 'distance'],
    allowedLoadKinds: ['unloaded', 'descriptive'],
    allowedLaterality: ['bilateral'],
    measurementProfile: 'duration',
    tissueDemand,
    safetyTags,
  };
}

function recoveryReps(
  variant: string,
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['bilateral'],
  allowedLoadKinds: ExerciseLoadKind[] = ['bodyweight', 'unloaded'],
): ExerciseFacets {
  return {
    family: 'recovery',
    variant,
    allowedDoseKinds: ['repetition'],
    allowedLoadKinds,
    allowedLaterality,
    measurementProfile: 'repetitions',
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function mobilityReps(
  variant: string,
  tissueDemand: string[] = [],
  safetyTags: string[] = [],
  allowedLaterality: ExerciseLaterality[] = ['per_side'],
): ExerciseFacets {
  return {
    family: 'mobility',
    variant,
    allowedDoseKinds: ['repetition', 'duration'],
    allowedLoadKinds: ['bodyweight', 'unloaded', 'descriptive'],
    allowedLaterality,
    measurementProfile: 'repetitions',
    ...(tissueDemand.length ? { tissueDemand } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  };
}

function cyclingDuration(variant: string): ExerciseFacets {
  return {
    family: 'cycling',
    variant,
    allowedDoseKinds: ['duration', 'distance'],
    allowedLoadKinds: ['percent_max', 'descriptive', 'unloaded'],
    allowedLaterality: ['bilateral'],
    measurementProfile: 'duration',
  };
}

/**
 * Facet enrichment for the established catalog. The legacy definitions remain stable while
 * the multidomain runner gets bounded dose/load/laterality/tissue metadata for the movements
 * most likely to appear in strength, field, running and recovery sessions.
 */
export const EXERCISE_FACET_OVERRIDES: Readonly<Record<string, ExerciseFacets>> = {
  hang_power_clean: strengthReps('hang_power_clean', ['hamstring', 'hip', 'knee_extensor'], ['acute_knee_pain', 'reactive_achilles'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  medicine_ball_slam: strengthReps('medicine_ball_slam', ['shoulder', 'core'], [], ['bilateral'], ['mass', 'descriptive']),
  front_squat: strengthReps('front_squat', ['knee_extensor', 'hip', 'lower_back'], ['knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  rear_foot_elevated_split_squat: strengthReps('rear_foot_elevated', ['knee_extensor', 'hip', 'adductor'], ['knee_swelling', 'painful_deep_knee_flexion'], ['per_side'], ['mass', 'percent_one_rm', 'descriptive']),
  romanian_deadlift: strengthReps('barbell_rdl', ['hamstring', 'hip', 'lower_back'], ['acute_hamstring_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  bench_press: strengthReps('barbell_bench', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  pull_up: strengthReps('pull_up', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'mass', 'descriptive']),
  band_pull_apart: strengthReps('band_pull_apart', ['shoulder'], ['acute_shoulder_pain'], ['bilateral'], ['band', 'descriptive']),
  scapular_push_up: strengthReps('scapular_push_up', ['shoulder', 'core'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'unloaded']),
  band_external_rotation: strengthReps('band_external_rotation', ['shoulder'], ['acute_shoulder_pain'], ['per_side'], ['band', 'descriptive']),
  dead_hang: strengthDuration('dead_hang', ['shoulder', 'wrist'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'unloaded']),
  chest_supported_dumbbell_row: strengthReps('chest_supported_dumbbell_row', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  seated_dumbbell_overhead_press: strengthReps('seated_dumbbell_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  rear_delt_raise: strengthReps('rear_delt_raise', ['shoulder'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  seated_soleus_iso: strengthDuration('seated_soleus_iso', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side'], ['bodyweight', 'mass', 'descriptive']),
  tibialis_raise: strengthReps('tibialis_raise', ['ankle'], [], ['bilateral', 'per_side'], ['bodyweight', 'mass', 'descriptive']),
  copenhagen_plank: strengthDuration('copenhagen_plank', ['adductor', 'core'], ['acute_adductor_pain'], ['per_side'], ['bodyweight', 'unloaded']),
  pogo_hop: strengthReps('bilateral_pogo', ['calf', 'achilles', 'ankle'], ['worsening_achilles_pain', 'knee_swelling'], ['bilateral'], ['bodyweight', 'unloaded']),
  countermovement_jump: strengthReps('countermovement_jump', ['knee_extensor', 'hip', 'calf', 'achilles'], ['worsening_achilles_pain', 'knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['bodyweight', 'unloaded']),
  drop_jump_low: strengthReps('low_drop_jump', ['knee_extensor', 'calf', 'achilles'], ['worsening_achilles_pain', 'knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['bodyweight', 'unloaded']),
  nordic_hamstring_curl: strengthReps('nordic', ['hamstring'], ['acute_hamstring_pain'], ['bilateral'], ['bodyweight', 'descriptive']),
  eccentric_heel_raise: strengthReps('eccentric_heel_raise', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side'], ['bodyweight', 'mass', 'descriptive']),
  hip_thrust: strengthReps('barbell_hip_thrust', ['hip', 'hamstring'], ['acute_hamstring_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  cable_chest_press: strengthReps('cable_chest_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  cable_row: strengthReps('cable_row', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  goblet_squat: strengthReps('goblet_squat', ['knee_extensor', 'hip'], ['knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['mass', 'descriptive']),
  dumbbell_row: strengthReps('one_arm_dumbbell_row', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['per_side'], ['mass', 'descriptive']),
  push_up: strengthReps('push_up', ['shoulder', 'elbow', 'core'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'descriptive']),
  bodyweight_squat: strengthReps('bodyweight_squat', ['knee_extensor', 'hip'], ['knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['bodyweight', 'descriptive']),
  bodyweight_hip_hinge: strengthReps('bodyweight_hip_hinge', ['hamstring', 'hip', 'lower_back'], ['acute_hamstring_pain'], ['bilateral'], ['bodyweight', 'descriptive']),
  prone_scapular_row: strengthReps('prone_scapular_row', ['shoulder', 'core'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'unloaded']),
  dead_bug: strengthReps('dead_bug', ['core'], [], ['alternating'], ['bodyweight', 'unloaded']),
  back_squat: strengthReps('back_squat', ['knee_extensor', 'hip', 'lower_back'], ['knee_swelling', 'painful_deep_knee_flexion'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  power_clean_from_floor: strengthReps('floor_power_clean', ['hamstring', 'hip', 'knee_extensor'], ['acute_knee_pain', 'reactive_achilles'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  side_plank: strengthDuration('side_plank', ['core'], [], ['per_side']),
  single_leg_romanian_deadlift: strengthReps('single_leg_rdl', ['hamstring', 'hip', 'ankle'], ['acute_hamstring_pain'], ['per_side'], ['mass', 'descriptive']),
  walking_lunge: strengthReps('walking_lunge', ['knee_extensor', 'hip', 'adductor'], ['knee_swelling', 'painful_deep_knee_flexion'], ['alternating'], ['mass', 'descriptive']),
  step_up: strengthReps('step_up', ['knee_extensor', 'hip'], ['knee_swelling', 'painful_deep_knee_flexion'], ['per_side'], ['mass', 'descriptive']),
  kettlebell_swing: strengthReps('kettlebell_swing', ['hamstring', 'hip', 'lower_back'], ['acute_hamstring_pain'], ['bilateral'], ['mass', 'descriptive']),
  kettlebell_deadlift: strengthReps('kettlebell_deadlift', ['hamstring', 'hip', 'lower_back'], ['acute_hamstring_pain'], ['bilateral'], ['mass', 'descriptive']),
  standing_calf_raise: strengthReps('standing_calf_raise', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side'], ['bodyweight', 'mass', 'descriptive']),
  calf_isometric: strengthDuration('calf_isometric', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side']),
  adductor_squeeze_isometric: strengthDuration('adductor_squeeze', ['adductor'], ['acute_adductor_pain'], ['bilateral']),
  lat_pulldown: strengthReps('lat_pulldown', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  face_pull: strengthReps('face_pull', ['shoulder'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'band', 'descriptive']),
  dumbbell_lateral_raise: strengthReps('dumbbell_lateral_raise', ['shoulder'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']),
  incline_dumbbell_press: strengthReps('incline_dumbbell_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']),
  dip: strengthReps('parallel_bar_dip', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'mass', 'descriptive']),
  dumbbell_bicep_curl: strengthReps('dumbbell_bicep_curl', ['elbow', 'wrist'], [], ['bilateral', 'alternating'], ['mass', 'descriptive']),
  triceps_rope_pushdown: strengthReps('triceps_rope_pushdown', ['elbow'], [], ['bilateral'], ['mass', 'descriptive']),
  pallof_press: strengthReps('pallof_press', ['core'], [], ['per_side'], ['band', 'mass', 'descriptive']),
  bird_dog: strengthReps('bird_dog', ['core', 'hip'], [], ['alternating'], ['bodyweight', 'unloaded']),
  plank: strengthDuration('front_plank', ['core'], [], ['bilateral']),
  hanging_leg_raise: strengthReps('hanging_leg_raise', ['core', 'shoulder', 'hip'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'descriptive']),
  box_jump: strengthReps('box_jump', ['knee_extensor', 'hip', 'calf', 'achilles'], ['knee_swelling', 'worsening_achilles_pain'], ['bilateral'], ['bodyweight', 'unloaded']),
  skater_hop: strengthReps('skater_hop', ['knee_extensor', 'hip', 'adductor', 'calf'], ['knee_swelling', 'instability', 'worsening_achilles_pain'], ['alternating'], ['bodyweight', 'unloaded']),

  field_dynamic_warmup: fieldDuration('dynamic_field_warmup', [], ['calf', 'hamstring', 'adductor'], ['knee_swelling', 'worsening_achilles_pain']),
  acceleration_10m: fieldTimed('10m_acceleration', ['acceleration'], ['hamstring', 'hip', 'calf'], ['knee_swelling', 'worsening_achilles_pain']),
  controlled_deceleration: fieldReps('controlled_deceleration', ['braking'], ['knee_extensor', 'calf'], ['knee_swelling', 'painful_braking']),
  change_of_direction_45: fieldReps('45_degree_cut', ['acceleration', 'braking', 'change_of_direction'], ['knee_extensor', 'hip', 'adductor', 'calf'], ['knee_swelling', 'instability', 'worsening_achilles_pain'], ['alternating']),
  ball_dribbling: fieldDuration('ball_dribbling', ['change_of_direction'], ['calf', 'adductor'], ['knee_swelling', 'worsening_achilles_pain'], ['alternating']),
  sprint_wall_drive: fieldReps('wall_drive', ['acceleration'], ['hamstring', 'hip', 'calf'], ['acute_hamstring_pain', 'worsening_achilles_pain'], ['alternating']),
  sprint_a_march: fieldReps('a_march', ['acceleration'], ['calf', 'hip'], ['worsening_achilles_pain'], ['alternating']),
  sprint_falling_start_10m: fieldTimed('falling_start_10m', ['acceleration'], ['hamstring', 'hip', 'calf'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),
  sprint_fly_10m: fieldTimed('fly_10m', ['max_velocity'], ['hamstring', 'calf'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),
  deceleration_stick: fieldReps('deceleration_stick', ['braking'], ['knee_extensor', 'calf'], ['knee_swelling', 'painful_braking']),
  sprint_15m: fieldTimed('15m', ['acceleration'], ['hamstring', 'hip', 'calf'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),
  pro_agility_5_10_5: fieldTimed('5_10_5', ['acceleration', 'braking', 'change_of_direction'], ['knee_extensor', 'adductor', 'calf'], ['knee_swelling', 'painful_braking', 'worsening_achilles_pain'], ['alternating']),
  sprint_30m_with_splits: fieldTimed('30m_split_test', ['acceleration', 'max_velocity'], ['hamstring', 'hip', 'calf'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),

  walk_run_easy: runningDuration('walk_run_easy'),
  easy_continuous_run: runningDuration('easy_continuous_run'),
  run_tempo_interval: runningDuration('tempo_interval'),
  run_vo2_interval: runningDuration('vo2_interval', ['calf', 'hamstring', 'knee_extensor'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),
  run_race_pace_interval: runningDuration('race_pace_interval', ['calf', 'hamstring', 'knee_extensor'], ['knee_swelling', 'worsening_achilles_pain']),
  running_hill_repeat: runningDuration('hill_repeat', ['calf', 'hamstring', 'hip'], ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling']),
  running_strides: runningDuration('strides', ['calf', 'hamstring', 'hip'], ['acute_hamstring_pain', 'worsening_achilles_pain']),
  running_drills: runningDuration('technical_drills', ['calf', 'hip'], ['worsening_achilles_pain']),
  run_fartlek: runningDuration('fartlek'),
  run_long_steady: runningDuration('long_steady'),

  complete_rest_protocol: {
    family: 'recovery', variant: 'complete_rest', allowedDoseKinds: ['checkoff'], allowedLoadKinds: ['unloaded'], allowedLaterality: ['bilateral'], measurementProfile: 'checkoff',
  },
  quad_set: {
    family: 'recovery', variant: 'quad_isometric', allowedDoseKinds: ['duration'], allowedLoadKinds: ['bodyweight', 'unloaded'], allowedLaterality: ['bilateral', 'per_side'], measurementProfile: 'duration', tissueDemand: ['knee_extensor'], safetyTags: ['acute_knee_pain'],
  },
  foam_rolling_lower_body: {
    family: 'recovery', variant: 'lower_body_foam_rolling', allowedDoseKinds: ['duration'], allowedLoadKinds: ['unloaded', 'descriptive'], allowedLaterality: ['bilateral', 'per_side'], measurementProfile: 'duration',
  },
  active_recovery_walk: {
    family: 'recovery', variant: 'easy_walk', allowedDoseKinds: ['duration', 'distance'], allowedLoadKinds: ['unloaded', 'descriptive'], allowedLaterality: ['bilateral'], measurementProfile: 'duration',
  },
};

/**
 * Deliberately broad but curated expansion. Exercise identity stays stable while dose, load,
 * laterality and technical intent live in structured metadata/session prescriptions.
 */
export const EXPANDED_EXERCISES: ExerciseDefinition[] = [
  { id: 'dumbbell_muscle_snatch', version: 1, name: 'Dumbbell Muscle Snatch', modality: 'strength', movementPatterns: ['hinge', 'triple_extension', 'vertical_pull', 'upper_body_power'], primaryMuscles: ['glutes', 'hamstrings', 'shoulders', 'traps'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'acute_shoulder_pain'], instruction: 'Drive explosively from the hips and finish overhead without a deep catch; stop while speed stays crisp.', facets: strengthReps('dumbbell_muscle_snatch', ['hamstring', 'hip', 'shoulder'], ['acute_hamstring_pain', 'acute_shoulder_pain'], ['per_side', 'alternating'], ['mass', 'descriptive']) },
  { id: 'kettlebell_muscle_snatch', version: 1, name: 'Kettlebell Muscle Snatch', modality: 'strength', movementPatterns: ['hinge', 'triple_extension', 'vertical_pull', 'upper_body_power'], primaryMuscles: ['glutes', 'hamstrings', 'shoulders', 'traps'], equipment: ['kettlebell'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'acute_shoulder_pain'], instruction: 'Accelerate the bell close to the body and finish overhead smoothly without chasing fatigue.', facets: strengthReps('kettlebell_muscle_snatch', ['hamstring', 'hip', 'shoulder'], ['acute_hamstring_pain', 'acute_shoulder_pain'], ['per_side', 'alternating'], ['mass', 'descriptive']) },
  { id: 'barbell_push_press', version: 1, name: 'Barbell Push Press', modality: 'strength', movementPatterns: ['vertical_push', 'triple_extension', 'upper_body_power'], primaryMuscles: ['shoulders', 'triceps', 'quadriceps', 'glutes'], equipment: ['barbell', 'rack'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_shoulder_pain', 'acute_knee_pain'], instruction: 'Use a shallow vertical dip and fast leg drive, then finish the bar overhead without grinding.', facets: strengthReps('barbell_push_press', ['shoulder', 'elbow', 'knee_extensor', 'hip'], ['acute_shoulder_pain', 'acute_knee_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'barbell_push_jerk', version: 1, name: 'Barbell Push Jerk', modality: 'strength', movementPatterns: ['vertical_push', 'triple_extension', 'upper_body_power', 'catch'], primaryMuscles: ['shoulders', 'triceps', 'quadriceps', 'glutes'], equipment: ['barbell', 'rack'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_shoulder_pain', 'acute_knee_pain', 'worsening_achilles_pain'], instruction: 'Drive vertically, receive in a shallow athletic catch, and stop if timing or landing quality deteriorates.', facets: strengthReps('barbell_push_jerk', ['shoulder', 'elbow', 'knee_extensor', 'calf'], ['acute_shoulder_pain', 'acute_knee_pain', 'worsening_achilles_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'clean_pull', version: 1, name: 'Clean Pull', modality: 'strength', movementPatterns: ['hinge', 'triple_extension', 'pull'], primaryMuscles: ['glutes', 'hamstrings', 'quadriceps', 'traps'], equipment: ['barbell'], impact: 'low', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_hamstring_pain', 'acute_knee_pain'], instruction: 'Keep the bar close and accelerate through full extension without turning the set into a slow deadlift.', facets: strengthReps('clean_pull', ['hamstring', 'hip', 'knee_extensor', 'lower_back'], ['acute_hamstring_pain', 'acute_knee_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'medicine_ball_chest_pass', version: 1, name: 'Medicine-ball Chest Pass', modality: 'strength', movementPatterns: ['horizontal_push', 'upper_body_power'], primaryMuscles: ['chest', 'triceps', 'shoulders'], equipment: ['medicine_ball'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Throw explosively from a stable trunk and reset fully between repetitions.', facets: strengthReps('medicine_ball_chest_pass', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']) },
  { id: 'medicine_ball_overhead_throw', version: 1, name: 'Medicine-ball Overhead Throw', modality: 'strength', movementPatterns: ['upper_body_power', 'triple_extension'], primaryMuscles: ['shoulders', 'lats', 'trunk', 'glutes'], equipment: ['medicine_ball'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Use coordinated hip and arm extension, release powerfully, and stop before speed falls.', facets: strengthReps('medicine_ball_overhead_throw', ['shoulder', 'hip', 'core'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']) },
  { id: 'conventional_deadlift', version: 1, name: 'Conventional Deadlift', modality: 'strength', movementPatterns: ['hinge'], primaryMuscles: ['glutes', 'hamstrings', 'back', 'quadriceps'], equipment: ['barbell'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_hamstring_pain', 'acute_low_back_pain'], instruction: 'Brace before the pull, keep the bar close, and finish with the hips rather than lumbar extension.', facets: strengthReps('conventional_deadlift', ['hamstring', 'hip', 'lower_back'], ['acute_hamstring_pain', 'acute_low_back_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'split_squat', version: 1, name: 'Split Squat', modality: 'strength', movementPatterns: ['unilateral_squat'], primaryMuscles: ['quadriceps', 'glutes', 'adductors'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['knee_swelling', 'painful_deep_knee_flexion'], instruction: 'Use a stable split stance and a symptom-free depth with smooth pressure through the front foot.', facets: strengthReps('split_squat', ['knee_extensor', 'hip', 'adductor'], ['knee_swelling', 'painful_deep_knee_flexion'], ['per_side'], ['mass', 'descriptive']) },
  { id: 'reverse_lunge', version: 1, name: 'Reverse Lunge', modality: 'strength', movementPatterns: ['unilateral_squat', 'lunge'], primaryMuscles: ['quadriceps', 'glutes', 'adductors'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['knee_swelling', 'painful_deep_knee_flexion'], instruction: 'Step back under control, keep the front foot planted, and return without pushing aggressively off the rear leg.', facets: strengthReps('reverse_lunge', ['knee_extensor', 'hip', 'adductor'], ['knee_swelling', 'painful_deep_knee_flexion'], ['alternating', 'per_side'], ['mass', 'descriptive']) },
  { id: 'lateral_lunge', version: 1, name: 'Lateral Lunge', modality: 'strength', movementPatterns: ['lateral_lunge', 'unilateral_squat'], primaryMuscles: ['adductors', 'glutes', 'quadriceps'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_adductor_pain', 'knee_swelling'], instruction: 'Sit into the working hip with the foot planted and return smoothly without collapsing the knee inward.', facets: strengthReps('lateral_lunge', ['adductor', 'hip', 'knee_extensor'], ['acute_adductor_pain', 'knee_swelling'], ['per_side'], ['mass', 'descriptive']) },
  { id: 'step_down', version: 1, name: 'Controlled Step-down', modality: 'strength', movementPatterns: ['unilateral_squat', 'eccentric_knee_control'], primaryMuscles: ['quadriceps', 'glutes'], equipment: ['bench'], impact: 'low', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['knee_swelling', 'painful_deep_knee_flexion'], instruction: 'Lower slowly from a low step with a level pelvis and controlled knee line; use only a symptom-free height.', facets: strengthReps('step_down', ['knee_extensor', 'hip'], ['knee_swelling', 'painful_deep_knee_flexion'], ['per_side'], ['bodyweight', 'mass', 'descriptive']) },
  { id: 'spanish_squat_isometric', version: 1, name: 'Spanish Squat Isometric', modality: 'strength', movementPatterns: ['squat', 'knee_extension_isometric'], primaryMuscles: ['quadriceps'], equipment: ['resistance_bands'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain'], instruction: 'Sit back against band tension to a comfortable angle and hold a steady quadriceps contraction without symptom escalation.', facets: strengthDuration('spanish_squat_isometric', ['knee_extensor'], ['acute_knee_pain'], ['bilateral'], ['band', 'bodyweight', 'descriptive']) },
  { id: 'wall_sit', version: 1, name: 'Wall Sit', modality: 'strength', movementPatterns: ['squat', 'knee_extension_isometric'], primaryMuscles: ['quadriceps', 'glutes'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain', 'painful_deep_knee_flexion'], instruction: 'Hold a comfortable knee angle with even foot pressure and stop if knee symptoms build.', facets: strengthDuration('wall_sit', ['knee_extensor', 'hip'], ['acute_knee_pain', 'painful_deep_knee_flexion']) },
  { id: 'glute_bridge', version: 1, name: 'Glute Bridge', modality: 'strength', movementPatterns: ['hip_extension'], primaryMuscles: ['glutes', 'hamstrings'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_hamstring_pain'], instruction: 'Drive through the feet, finish with the ribs down, and avoid arching the lower back.', facets: strengthReps('glute_bridge', ['hip', 'hamstring'], ['acute_hamstring_pain'], ['bilateral'], ['bodyweight', 'mass', 'descriptive']) },
  { id: 'single_leg_hip_thrust', version: 1, name: 'Single-leg Hip Thrust', modality: 'strength', movementPatterns: ['unilateral_hip_extension'], primaryMuscles: ['glutes', 'hamstrings'], equipment: ['bench'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_hamstring_pain'], instruction: 'Keep the pelvis level, extend through the working hip, and stop before hamstring cramping or lumbar compensation.', facets: strengthReps('single_leg_hip_thrust', ['hip', 'hamstring'], ['acute_hamstring_pain'], ['per_side'], ['bodyweight', 'mass', 'descriptive']) },
  { id: 'hamstring_bridge_isometric', version: 1, name: 'Hamstring Bridge Isometric', modality: 'strength', movementPatterns: ['hip_extension', 'knee_flexion_isometric'], primaryMuscles: ['hamstrings', 'glutes'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_hamstring_pain'], instruction: 'Dig the heels into the floor, hold the hips steady, and use a pain-free effort below cramping.', facets: strengthDuration('hamstring_bridge_isometric', ['hamstring', 'hip'], ['acute_hamstring_pain'], ['bilateral', 'per_side']) },
  { id: 'seated_calf_raise', version: 1, name: 'Seated Calf Raise', modality: 'strength', movementPatterns: ['ankle_plantarflexion'], primaryMuscles: ['soleus'], equipment: ['dumbbells', 'bench'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'low', contraindicationTags: ['worsening_achilles_pain'], instruction: 'Keep the knees bent, rise through the forefoot, pause at the top, and lower under control.', facets: strengthReps('seated_calf_raise', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side'], ['mass', 'bodyweight', 'descriptive']) },
  { id: 'bent_knee_calf_raise', version: 1, name: 'Bent-knee Calf Raise', modality: 'strength', movementPatterns: ['ankle_plantarflexion'], primaryMuscles: ['soleus'], equipment: ['dumbbells'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'low', contraindicationTags: ['worsening_achilles_pain'], instruction: 'Maintain a small knee bend while moving through controlled plantarflexion without bouncing.', facets: strengthReps('bent_knee_calf_raise', ['calf', 'achilles'], ['worsening_achilles_pain'], ['bilateral', 'per_side'], ['mass', 'bodyweight', 'descriptive']) },
  { id: 'standing_calf_isometric_bilateral', version: 1, name: 'Bilateral Standing Calf Isometric', modality: 'strength', movementPatterns: ['ankle_plantarflexion'], primaryMuscles: ['gastrocnemius', 'soleus'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['worsening_achilles_pain'], instruction: 'Rise onto both forefeet and hold steady with even pressure and no increase in Achilles symptoms.', facets: strengthDuration('standing_calf_iso_bilateral', ['calf', 'achilles'], ['worsening_achilles_pain']) },
  { id: 'standing_calf_isometric_single_leg', version: 1, name: 'Single-leg Standing Calf Isometric', modality: 'strength', movementPatterns: ['ankle_plantarflexion'], primaryMuscles: ['gastrocnemius', 'soleus'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'moderate', contraindicationTags: ['worsening_achilles_pain'], instruction: 'Hold a stable single-leg calf raise position with light support if needed and no symptom escalation.', facets: strengthDuration('standing_calf_iso_single_leg', ['calf', 'achilles', 'ankle'], ['worsening_achilles_pain'], ['per_side']) },
  { id: 'single_leg_calf_raise', version: 1, name: 'Single-leg Calf Raise', modality: 'strength', movementPatterns: ['ankle_plantarflexion'], primaryMuscles: ['gastrocnemius', 'soleus'], equipment: ['dumbbells'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['worsening_achilles_pain'], instruction: 'Use a full controlled range on one leg, pause briefly at the top, and avoid bouncing.', facets: strengthReps('single_leg_calf_raise', ['calf', 'achilles', 'ankle'], ['worsening_achilles_pain'], ['per_side'], ['bodyweight', 'mass', 'descriptive']) },
  { id: 'ankle_pump', version: 1, name: 'Ankle Pump', modality: 'recovery', movementPatterns: ['ankle_dorsiflexion', 'ankle_plantarflexion'], primaryMuscles: ['calves', 'tibialis_anterior'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: [], instruction: 'Alternate comfortable plantarflexion and dorsiflexion through an easy range without forcing the ankle.', facets: recoveryReps('ankle_pump', ['ankle', 'calf'], [], ['bilateral', 'per_side']) },
  { id: 'copenhagen_short_lever', version: 1, name: 'Short-lever Copenhagen Plank', modality: 'strength', movementPatterns: ['adduction', 'anti_lateral_flexion'], primaryMuscles: ['adductors', 'obliques'], equipment: ['bench'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'moderate', contraindicationTags: ['acute_adductor_pain'], instruction: 'Support through the knee or distal thigh, keep the pelvis stacked, and stop before adductor or trunk compensation.', facets: strengthDuration('copenhagen_short_lever', ['adductor', 'core'], ['acute_adductor_pain'], ['per_side']) },
  { id: 'copenhagen_long_lever', version: 1, name: 'Long-lever Copenhagen Plank', modality: 'strength', movementPatterns: ['adduction', 'anti_lateral_flexion'], primaryMuscles: ['adductors', 'obliques'], equipment: ['bench'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['acute_adductor_pain'], instruction: 'Support through the ankle or foot only after short-lever holds are easy, keeping the trunk and pelvis aligned.', facets: strengthDuration('copenhagen_long_lever', ['adductor', 'core'], ['acute_adductor_pain'], ['per_side']) },
  { id: 'side_lying_adduction', version: 1, name: 'Side-lying Hip Adduction', modality: 'strength', movementPatterns: ['adduction'], primaryMuscles: ['adductors'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_adductor_pain'], instruction: 'Lift the lower leg under control without rolling the pelvis and stop before groin discomfort increases.', facets: strengthReps('side_lying_adduction', ['adductor'], ['acute_adductor_pain'], ['per_side'], ['bodyweight', 'descriptive']) },
  { id: 'farmer_carry', version: 1, name: 'Farmer Carry', modality: 'strength', movementPatterns: ['carry', 'grip', 'trunk_control'], primaryMuscles: ['forearms', 'traps', 'trunk'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: [], instruction: 'Walk tall with even loads, quiet ribs, and controlled steps without rushing.', facets: strengthCarry('farmer_carry', ['wrist', 'shoulder', 'core']) },
  { id: 'suitcase_carry', version: 1, name: 'Suitcase Carry', modality: 'strength', movementPatterns: ['carry', 'grip', 'anti_lateral_flexion'], primaryMuscles: ['forearms', 'obliques', 'trunk'], equipment: ['dumbbells'], impact: 'low', eccentricLoad: 'none', coordinationDemand: 'moderate', contraindicationTags: [], instruction: 'Carry one dumbbell without leaning, keeping the pelvis level and gait normal.', facets: strengthCarry('suitcase_carry', ['wrist', 'shoulder', 'core'], ['per_side']) },
  { id: 'hollow_body_hold', version: 1, name: 'Hollow-body Hold', modality: 'strength', movementPatterns: ['anti_extension', 'trunk_control'], primaryMuscles: ['trunk'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'moderate', contraindicationTags: [], instruction: 'Keep the lower ribs and pelvis controlled; shorten the lever before the lower back loses position.', facets: strengthDuration('hollow_body_hold', ['core']) },
  { id: 'bear_plank_shoulder_tap', version: 1, name: 'Bear-plank Shoulder Tap', modality: 'strength', movementPatterns: ['anti_rotation', 'trunk_control', 'shoulder_stability'], primaryMuscles: ['trunk', 'shoulders'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Hover the knees low, tap one shoulder at a time, and keep the pelvis quiet.', facets: strengthReps('bear_plank_shoulder_tap', ['core', 'shoulder'], ['acute_shoulder_pain'], ['alternating'], ['bodyweight', 'unloaded']) },
  { id: 'barbell_overhead_press', version: 1, name: 'Barbell Overhead Press', modality: 'strength', movementPatterns: ['vertical_push'], primaryMuscles: ['shoulders', 'triceps'], equipment: ['barbell', 'rack'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Press from a braced torso with a smooth bar path and finish well before grinding.', facets: strengthReps('barbell_overhead_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'dumbbell_bench_press', version: 1, name: 'Dumbbell Bench Press', modality: 'strength', movementPatterns: ['horizontal_push'], primaryMuscles: ['chest', 'triceps', 'shoulders'], equipment: ['dumbbells', 'bench'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Use a stable shoulder position and smooth pain-free range with several repetitions in reserve.', facets: strengthReps('dumbbell_bench_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'percent_one_rm', 'descriptive']) },
  { id: 'chin_up', version: 1, name: 'Chin-up', modality: 'strength', movementPatterns: ['vertical_pull'], primaryMuscles: ['lats', 'biceps', 'upper_back'], equipment: ['pullup_bar'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain', 'acute_elbow_pain'], instruction: 'Use a controlled supinated-grip pull and stop before shoulder, elbow or grip mechanics change.', facets: strengthReps('chin_up', ['shoulder', 'elbow'], ['acute_shoulder_pain', 'acute_elbow_pain'], ['bilateral'], ['bodyweight', 'mass', 'descriptive']) },
  { id: 'inverted_row', version: 1, name: 'Inverted Row', modality: 'strength', movementPatterns: ['horizontal_pull'], primaryMuscles: ['upper_back', 'lats', 'biceps'], equipment: ['barbell', 'rack'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'low', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Keep the body rigid, pull the chest toward the bar, and change body angle to scale difficulty.', facets: strengthReps('inverted_row', ['shoulder', 'elbow', 'core'], ['acute_shoulder_pain'], ['bilateral'], ['bodyweight', 'descriptive']) },
  { id: 'dumbbell_floor_press', version: 1, name: 'Dumbbell Floor Press', modality: 'strength', movementPatterns: ['horizontal_push'], primaryMuscles: ['chest', 'triceps', 'shoulders'], equipment: ['dumbbells'], impact: 'none', eccentricLoad: 'moderate', coordinationDemand: 'low', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Lower until the upper arms contact the floor softly, pause, and press without losing shoulder position.', facets: strengthReps('dumbbell_floor_press', ['shoulder', 'elbow'], ['acute_shoulder_pain'], ['bilateral'], ['mass', 'descriptive']) },
  { id: 'single_arm_dumbbell_floor_press', version: 1, name: 'Single-arm Dumbbell Floor Press', modality: 'strength', movementPatterns: ['horizontal_push', 'anti_rotation'], primaryMuscles: ['chest', 'triceps', 'trunk'], equipment: ['dumbbells'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'moderate', contraindicationTags: ['acute_shoulder_pain'], instruction: 'Lie flat with knees bent, brace core against rotational pull, lower until upper arm contacts floor, and press up smoothly.', facets: strengthReps('single_arm_floor_press', ['shoulder', 'elbow', 'core'], ['acute_shoulder_pain'], ['per_side'], ['mass', 'descriptive']) },
  { id: 'broad_jump', version: 1, name: 'Standing Broad Jump', modality: 'strength', movementPatterns: ['horizontal_jump', 'triple_extension', 'landing'], primaryMuscles: ['glutes', 'quadriceps', 'calves'], equipment: ['bodyweight'], impact: 'high', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], instruction: 'Jump forward explosively, land quietly with control, and reset completely before repeating.', facets: strengthReps('broad_jump', ['knee_extensor', 'hip', 'calf', 'achilles'], ['knee_swelling', 'worsening_achilles_pain'], ['bilateral'], ['bodyweight', 'unloaded']) },
  { id: 'lateral_bound_stick', version: 1, name: 'Lateral Bound and Stick', modality: 'strength', movementPatterns: ['lateral_jump', 'unilateral_landing', 'braking'], primaryMuscles: ['glutes', 'quadriceps', 'adductors', 'calves'], equipment: ['bodyweight'], impact: 'moderate', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'instability', 'worsening_achilles_pain'], instruction: 'Bound laterally and hold the landing for two seconds before the next repetition.', facets: strengthReps('lateral_bound_stick', ['knee_extensor', 'hip', 'adductor', 'calf'], ['knee_swelling', 'instability', 'worsening_achilles_pain'], ['alternating'], ['bodyweight', 'unloaded']) },
  { id: 'single_leg_hop_stick', version: 1, name: 'Single-leg Hop and Stick', modality: 'strength', movementPatterns: ['unilateral_jump', 'unilateral_landing'], primaryMuscles: ['glutes', 'quadriceps', 'calves'], equipment: ['bodyweight'], impact: 'high', eccentricLoad: 'high', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'instability', 'worsening_achilles_pain'], instruction: 'Use a small controlled hop and stabilize the landing before progressing distance or speed.', facets: strengthReps('single_leg_hop_stick', ['knee_extensor', 'hip', 'calf', 'achilles'], ['knee_swelling', 'instability', 'worsening_achilles_pain'], ['per_side'], ['bodyweight', 'unloaded']) },
  { id: 'low_hurdle_hop', version: 1, name: 'Low Hurdle Hop', modality: 'strength', movementPatterns: ['reactive_jump', 'landing'], primaryMuscles: ['calves', 'quadriceps', 'glutes'], equipment: ['mini_hurdles'], impact: 'high', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], instruction: 'Use low hurdles and quick quiet contacts; stop when stiffness or landing quality fades.', facets: strengthReps('low_hurdle_hop', ['calf', 'achilles', 'knee_extensor'], ['knee_swelling', 'worsening_achilles_pain'], ['bilateral'], ['bodyweight', 'unloaded']) },
  { id: 'single_leg_pogo', version: 1, name: 'Single-leg Pogo Hop', modality: 'strength', movementPatterns: ['ankle_stiffness', 'reactive_jump', 'unilateral_landing'], primaryMuscles: ['calves', 'soleus'], equipment: ['bodyweight'], impact: 'high', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], instruction: 'Use very small springy contacts on one leg and stop immediately if tendon response or landing rhythm worsens.', facets: strengthReps('single_leg_pogo', ['calf', 'achilles', 'ankle'], ['knee_swelling', 'worsening_achilles_pain'], ['per_side'], ['bodyweight', 'unloaded']) },
  { id: 'sled_push', version: 1, name: 'Sled Push', modality: 'strength', movementPatterns: ['locomotion', 'knee_extension', 'hip_extension'], primaryMuscles: ['quadriceps', 'glutes', 'calves'], equipment: ['sled'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain', 'worsening_achilles_pain'], instruction: 'Use short powerful steps and a stable trunk; select a load that keeps gait smooth rather than grinding.', facets: { family: 'strength', variant: 'sled_push', allowedDoseKinds: ['distance', 'duration'], allowedLoadKinds: ['mass', 'descriptive'], allowedLaterality: ['bilateral'], measurementProfile: 'distance', tissueDemand: ['knee_extensor', 'hip', 'calf'], safetyTags: ['acute_knee_pain', 'worsening_achilles_pain'] } },
  { id: 'backward_sled_drag', version: 1, name: 'Backward Sled Drag', modality: 'strength', movementPatterns: ['backward_locomotion', 'knee_extension'], primaryMuscles: ['quadriceps', 'calves'], equipment: ['sled'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain', 'worsening_achilles_pain'], instruction: 'Walk backward with short controlled steps and continuous tension without locking the knees.', facets: { family: 'strength', variant: 'backward_sled_drag', allowedDoseKinds: ['distance', 'duration'], allowedLoadKinds: ['mass', 'descriptive'], allowedLaterality: ['bilateral'], measurementProfile: 'distance', tissueDemand: ['knee_extensor', 'calf'], safetyTags: ['acute_knee_pain', 'worsening_achilles_pain'] } },
  { id: 'acceleration_20m', version: 1, name: '20 m Acceleration', modality: 'field', movementPatterns: ['acceleration'], primaryMuscles: ['glutes', 'hamstrings', 'calves'], equipment: ['field', 'cones'], impact: 'high', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], instruction: 'Build force through the first steps and stay relaxed as posture rises; stop while acceleration mechanics remain crisp.', facets: fieldTimed('20m_acceleration', ['acceleration'], ['hamstring', 'hip', 'calf'], ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain']) },
  { id: 'change_of_direction_90', version: 1, name: '90-degree Change of Direction', modality: 'field', movementPatterns: ['braking', 'cutting', 'acceleration'], primaryMuscles: ['quadriceps', 'glutes', 'adductors', 'calves'], equipment: ['field', 'cones'], impact: 'high', eccentricLoad: 'high', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'instability', 'worsening_achilles_pain'], instruction: 'Brake before the cone, lower the centre of mass, plant cleanly, and reaccelerate without chasing maximal speed.', facets: fieldReps('90_degree_cut', ['acceleration', 'braking', 'change_of_direction'], ['knee_extensor', 'hip', 'adductor', 'calf'], ['knee_swelling', 'instability', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'change_of_direction_180', version: 1, name: '180-degree Turn', modality: 'field', movementPatterns: ['braking', 'cutting', 'acceleration'], primaryMuscles: ['quadriceps', 'glutes', 'adductors', 'calves'], equipment: ['field', 'cones'], impact: 'high', eccentricLoad: 'high', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'instability', 'painful_braking', 'worsening_achilles_pain'], instruction: 'Approach under control, brake over several steps, turn off a stable foot, and reaccelerate cleanly.', facets: fieldReps('180_degree_turn', ['acceleration', 'braking', 'change_of_direction'], ['knee_extensor', 'hip', 'adductor', 'calf'], ['knee_swelling', 'instability', 'painful_braking', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'lateral_shuffle', version: 1, name: 'Lateral Shuffle', modality: 'field', movementPatterns: ['lateral_locomotion', 'change_of_direction'], primaryMuscles: ['adductors', 'glutes', 'calves'], equipment: ['field', 'cones'], impact: 'moderate', eccentricLoad: 'moderate', coordinationDemand: 'moderate', contraindicationTags: ['acute_adductor_pain', 'knee_swelling'], instruction: 'Stay athletic and move laterally without crossing the feet, keeping each direction change controlled.', facets: fieldReps('lateral_shuffle', ['braking', 'change_of_direction'], ['adductor', 'hip', 'calf'], ['acute_adductor_pain', 'knee_swelling'], ['alternating']) },
  { id: 'shuffle_to_acceleration', version: 1, name: 'Shuffle-to-Acceleration Drill', modality: 'field', movementPatterns: ['lateral_locomotion', 'acceleration'], primaryMuscles: ['glutes', 'hamstrings', 'adductors', 'calves'], equipment: ['field', 'cones'], impact: 'moderate', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'acute_adductor_pain', 'knee_swelling', 'worsening_achilles_pain'], instruction: 'Use two or three controlled shuffle contacts, orient the hips, then accelerate smoothly for a short distance.', facets: fieldReps('shuffle_to_acceleration', ['acceleration', 'change_of_direction'], ['hamstring', 'adductor', 'hip', 'calf'], ['acute_hamstring_pain', 'acute_adductor_pain', 'knee_swelling', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'backpedal_to_acceleration', version: 1, name: 'Backpedal-to-Acceleration Drill', modality: 'field', movementPatterns: ['backward_locomotion', 'braking', 'acceleration'], primaryMuscles: ['quadriceps', 'glutes', 'hamstrings', 'calves'], equipment: ['field', 'cones'], impact: 'moderate', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], instruction: 'Backpedal under control, plant without reaching, then turn and accelerate with clean first steps.', facets: fieldReps('backpedal_to_acceleration', ['acceleration', 'braking', 'change_of_direction'], ['hamstring', 'knee_extensor', 'hip', 'calf'], ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'ball_slalom_dribble', version: 1, name: 'Ball Slalom Dribble', modality: 'field', movementPatterns: ['skill', 'change_of_direction', 'running'], primaryMuscles: ['calves', 'adductors', 'hip_flexors'], equipment: ['field', 'cones', 'football'], impact: 'moderate', eccentricLoad: 'moderate', coordinationDemand: 'high', contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], instruction: 'Use frequent controlled touches through the cones and keep the drill technical rather than conditioning-driven.', facets: fieldDuration('ball_slalom_dribble', ['change_of_direction'], ['adductor', 'calf'], ['knee_swelling', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'dribble_to_acceleration', version: 1, name: 'Dribble-to-Acceleration', modality: 'field', movementPatterns: ['skill', 'acceleration', 'running'], primaryMuscles: ['glutes', 'hamstrings', 'calves', 'adductors'], equipment: ['field', 'cones', 'football'], impact: 'moderate', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], instruction: 'Carry the ball under control, take a purposeful release touch, then accelerate without turning the rep into a maximal sprint.', facets: fieldReps('dribble_to_acceleration', ['acceleration'], ['hamstring', 'adductor', 'calf'], ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], ['alternating']) },
  { id: 'football_pass_and_move', version: 1, name: 'Football Pass and Move', modality: 'field', movementPatterns: ['skill', 'running', 'change_of_direction'], primaryMuscles: ['adductors', 'calves', 'hip_flexors'], equipment: ['field', 'cones', 'football'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_adductor_pain', 'knee_swelling'], instruction: 'Pass accurately, move immediately into the next angle, and keep the tempo technical and repeatable.', facets: fieldDuration('football_pass_and_move', ['change_of_direction'], ['adductor', 'calf'], ['acute_adductor_pain', 'knee_swelling'], ['alternating']) },
  { id: 'football_first_touch', version: 1, name: 'Football First-touch Drill', modality: 'field', movementPatterns: ['skill'], primaryMuscles: ['adductors', 'hip_flexors', 'calves'], equipment: ['field', 'cones', 'football'], impact: 'low', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_adductor_pain'], instruction: 'Receive into space with the first touch and keep body orientation ready for the next action.', facets: fieldDuration('football_first_touch', [], ['adductor'], ['acute_adductor_pain'], ['alternating']) },
  { id: 'football_shooting_technique', version: 1, name: 'Football Shooting Technique', modality: 'field', movementPatterns: ['skill', 'kicking'], primaryMuscles: ['quadriceps', 'adductors', 'hip_flexors'], equipment: ['field', 'football'], impact: 'moderate', eccentricLoad: 'low', coordinationDemand: 'high', contraindicationTags: ['acute_adductor_pain', 'acute_knee_pain'], instruction: 'Use technically clean submaximal strikes, alternate setup patterns, and stop before kicking quality or groin comfort changes.', facets: fieldReps('football_shooting_technique', [], ['adductor', 'knee_extensor'], ['acute_adductor_pain', 'acute_knee_pain'], ['alternating']) },
  { id: 'ankle_dorsiflexion_rock', version: 1, name: 'Ankle Dorsiflexion Rock', modality: 'mobility', movementPatterns: ['ankle_dorsiflexion', 'mobility'], primaryMuscles: ['ankle', 'calves'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_ankle_pain'], instruction: 'Drive the knee forward over the foot while keeping the heel down and staying in a comfortable range.', facets: mobilityReps('ankle_dorsiflexion_rock', ['ankle', 'calf'], ['acute_ankle_pain']) },
  { id: 'adductor_rockback', version: 1, name: 'Adductor Rockback', modality: 'mobility', movementPatterns: ['adduction', 'hip_mobility'], primaryMuscles: ['adductors', 'hips'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_adductor_pain'], instruction: 'Keep one leg extended to the side and rock the hips back gently without forcing groin range.', facets: mobilityReps('adductor_rockback', ['adductor', 'hip'], ['acute_adductor_pain']) },
  { id: 'half_kneeling_hip_flexor_stretch', version: 1, name: 'Half-kneeling Hip Flexor Stretch', modality: 'mobility', movementPatterns: ['hip_extension_mobility'], primaryMuscles: ['hip_flexors', 'quadriceps'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['painful_deep_knee_flexion'], instruction: 'Tuck the pelvis slightly, squeeze the rear-side glute, and shift forward only enough to feel a gentle front-of-hip stretch.', facets: mobilityReps('half_kneeling_hip_flexor_stretch', ['hip'], ['painful_deep_knee_flexion']) },
  { id: 'hamstring_floss', version: 1, name: 'Hamstring Floss', modality: 'mobility', movementPatterns: ['hamstring_mobility'], primaryMuscles: ['hamstrings'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_hamstring_pain'], instruction: 'Move rhythmically in and out of a mild hamstring stretch without long aggressive holds.', facets: mobilityReps('hamstring_floss', ['hamstring'], ['acute_hamstring_pain']) },
  { id: 'heel_slide', version: 1, name: 'Heel Slide', modality: 'recovery', movementPatterns: ['knee_flexion', 'knee_extension'], primaryMuscles: ['quadriceps', 'hamstrings'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain'], instruction: 'Slide the heel toward and away from the body through a comfortable knee range without forcing flexion.', facets: recoveryReps('heel_slide', ['knee_extensor', 'hamstring'], ['acute_knee_pain'], ['per_side']) },
  { id: 'terminal_knee_extension_band', version: 1, name: 'Band Terminal Knee Extension', modality: 'recovery', movementPatterns: ['knee_extension'], primaryMuscles: ['quadriceps'], equipment: ['resistance_bands'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain'], instruction: 'Extend the knee smoothly against light band tension and pause briefly without locking aggressively.', facets: recoveryReps('terminal_knee_extension_band', ['knee_extensor'], ['acute_knee_pain'], ['per_side'], ['band', 'descriptive']) },
  { id: 'straight_leg_raise', version: 1, name: 'Straight-leg Raise', modality: 'recovery', movementPatterns: ['hip_flexion', 'knee_extension_isometric'], primaryMuscles: ['quadriceps', 'hip_flexors'], equipment: ['bodyweight'], impact: 'none', eccentricLoad: 'low', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain'], instruction: 'Set the quadriceps first, keep the knee straight, and lift only as high as control remains easy.', facets: recoveryReps('straight_leg_raise', ['knee_extensor', 'hip'], ['acute_knee_pain'], ['per_side']) },
  { id: 'bike_endurance_steady', version: 1, name: 'Steady Zone 2 Endurance Ride', modality: 'cycling', movementPatterns: ['cyclical', 'sustained_power'], primaryMuscles: ['quadriceps', 'glutes', 'calves'], equipment: ['bike'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'low', contraindicationTags: ['acute_knee_pain'], instruction: 'Ride continuously at conversational endurance intensity with smooth cadence and minimal power spikes.', facets: cyclingDuration('endurance_steady') },
  { id: 'bike_gap_close_effort', version: 1, name: 'Cycling Gap-close Effort', modality: 'cycling', movementPatterns: ['cyclical', 'acceleration', 'sustained_power'], primaryMuscles: ['quadriceps', 'glutes', 'calves'], equipment: ['bike'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'high', contraindicationTags: ['acute_knee_pain'], instruction: 'Accelerate decisively to close a simulated gap, then settle quickly back into sustainable pressure without a complete coast.', facets: cyclingDuration('gap_close_effort') },
  { id: 'bike_drafting_drill', version: 1, name: 'Drafting Position Drill', modality: 'cycling', movementPatterns: ['cyclical', 'handling', 'group_riding'], primaryMuscles: ['quadriceps', 'glutes', 'trunk'], equipment: ['bike', 'safe_riding_area'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'high', contraindicationTags: [], instruction: 'Practise smooth speed matching, predictable line choice and safe following distance only in an appropriate controlled riding environment.', facets: cyclingDuration('drafting_drill') },
  { id: 'bike_seated_climb', version: 1, name: 'Seated Climbing Effort', modality: 'cycling', movementPatterns: ['cyclical', 'force_production', 'sustained_power'], primaryMuscles: ['quadriceps', 'glutes', 'calves'], equipment: ['bike'], impact: 'none', eccentricLoad: 'none', coordinationDemand: 'moderate', contraindicationTags: ['acute_knee_pain'], instruction: 'Climb seated with a controlled gear and stable pelvis, avoiding low-cadence grinding when knee load rises.', facets: cyclingDuration('seated_climb') },
];
