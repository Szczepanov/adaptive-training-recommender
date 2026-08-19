import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { EXERCISE_FACET_OVERRIDES, EXPANDED_EXERCISES } from './exercise-catalog-extensions';
import { validateWorkoutLibrary } from './validation';

const REQUIRED_PROGRAM_EXERCISE_IDS = [
  'hang_power_clean',
  'power_clean_from_floor',
  'dumbbell_muscle_snatch',
  'kettlebell_muscle_snatch',
  'barbell_push_press',
  'barbell_push_jerk',
  'medicine_ball_slam',
  'front_squat',
  'rear_foot_elevated_split_squat',
  'romanian_deadlift',
  'bench_press',
  'pull_up',
  'chest_supported_dumbbell_row',
  'seated_dumbbell_overhead_press',
  'seated_soleus_iso',
  'seated_calf_raise',
  'standing_calf_isometric_bilateral',
  'standing_calf_isometric_single_leg',
  'single_leg_calf_raise',
  'ankle_pump',
  'tibialis_raise',
  'copenhagen_short_lever',
  'copenhagen_long_lever',
  'nordic_hamstring_curl',
  'pogo_hop',
  'single_leg_pogo',
  'countermovement_jump',
  'drop_jump_low',
  'acceleration_10m',
  'acceleration_20m',
  'controlled_deceleration',
  'change_of_direction_45',
  'change_of_direction_90',
  'change_of_direction_180',
  'ball_dribbling',
  'ball_slalom_dribble',
  'dribble_to_acceleration',
  'football_pass_and_move',
  'football_first_touch',
  'football_shooting_technique',
  'bike_endurance_steady',
  'bike_gap_close_effort',
] as const;

describe('expanded exercise catalog coverage', () => {
  it('keeps the enriched catalog valid', () => {
    expect(validateWorkoutLibrary(EXERCISES, []).errors).toEqual([]);
  });

  it('keeps every strength, field, running and recovery movement facet-backed', () => {
    const missing = EXERCISES
      .filter(exercise => ['strength', 'field', 'running', 'recovery'].includes(exercise.modality))
      .filter(exercise => !exercise.facets)
      .map(exercise => exercise.id);

    expect(missing).toEqual([]);
  });

  it('includes the movements used by the current multidirectional strength and field model', () => {
    const byId = new Map(EXERCISES.map(exercise => [exercise.id, exercise]));
    const missing = REQUIRED_PROGRAM_EXERCISE_IDS.filter(id => !byId.has(id));
    const missingFacets = REQUIRED_PROGRAM_EXERCISE_IDS.filter(id => !byId.get(id)?.facets);

    expect(missing).toEqual([]);
    expect(missingFacets).toEqual([]);
  });

  it('ships every newly added movement with explicit facets', () => {
    expect(EXPANDED_EXERCISES.length).toBeGreaterThanOrEqual(50);
    expect(EXPANDED_EXERCISES.filter(exercise => !exercise.facets).map(exercise => exercise.id)).toEqual([]);
  });

  it('does not leave stale facet overrides for unknown established exercises', () => {
    const ids = new Set(EXERCISES.map(exercise => exercise.id));
    const stale = Object.keys(EXERCISE_FACET_OVERRIDES).filter(id => !ids.has(id));
    expect(stale).toEqual([]);
  });
});
