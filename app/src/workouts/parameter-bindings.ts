import type {
  WorkoutParameterBindingSet,
  WorkoutParameterLegacyBinding,
  WorkoutParameterStepField,
  WorkoutParameterTransform,
  WorkoutParameterZeroBehavior
} from './models.ts';

interface StepFieldOptions {
  transform?: WorkoutParameterTransform;
  zeroBehavior?: WorkoutParameterZeroBehavior;
  range?: { minOffset: number; maxOffset: number };
}

function stepField(
  parameterId: string,
  stepIds: string[],
  field: WorkoutParameterStepField,
  options: StepFieldOptions = {}
): WorkoutParameterLegacyBinding {
  return { kind: 'step_field', parameterId, stepIds, field, ...options };
}

function resolver(
  parameterId: string,
  stepIds: string[],
  resolverId:
    | 'embedded_short_surges'
    | 'embedded_gap_closing_efforts'
    | 'over_under_internal_pattern'
    | 'walk_run_distribution'
): WorkoutParameterLegacyBinding {
  return { kind: 'resolver', parameterId, stepIds, resolver: resolverId };
}

/**
 * Explicit parameter-to-prescription bindings. The catalogue remains readable,
 * while this registry makes every adjustment executable and auditable.
 */
export const WORKOUT_PARAMETER_BINDINGS: WorkoutParameterBindingSet[] = [
  {
    workoutId: 'cycling_recovery_spin_01',
    bindings: [
      stepField('easy_duration', ['easy_spin'], 'duration.seconds', { transform: 'minutes_to_seconds' })
    ]
  },
  {
    workoutId: 'cycling_zone2_standard_01',
    bindings: [
      stepField('zone2_duration', ['zone2_main'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('zone2_rpe', ['zone2_main'], 'target.rpe', { range: { minOffset: -0.5, maxOffset: 0.5 } })
    ]
  },
  {
    workoutId: 'cycling_controlled_threshold_4x8_01',
    bindings: [
      stepField('interval_count', ['threshold_repeats'], 'sets'),
      stepField('interval_duration', ['threshold_repeats'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('recovery_duration', ['threshold_repeats'], 'restAfterSec', { transform: 'minutes_to_seconds' }),
      stepField('target_rpe', ['threshold_repeats'], 'target.rpe', { range: { minOffset: -0.5, maxOffset: 0.5 } })
    ]
  },
  {
    workoutId: 'cycling_over_under_3x12_01',
    bindings: [
      stepField('block_count', ['ou_repeats'], 'sets'),
      stepField('block_duration', ['ou_repeats'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      resolver('surge_duration', ['ou_repeats'], 'over_under_internal_pattern'),
      stepField('recovery_duration', ['ou_repeats'], 'restAfterSec', { transform: 'minutes_to_seconds' })
    ]
  },
  {
    workoutId: 'cycling_short_surges_10x20_01',
    bindings: [
      stepField('surge_count', ['surges'], 'sets'),
      stepField('surge_duration', ['surges'], 'duration.seconds'),
      stepField('recovery_duration', ['surges'], 'restAfterSec'),
      stepField('surge_rpe', ['surges'], 'target.rpe', { range: { minOffset: -0.5, maxOffset: 0.5 } })
    ]
  },
  {
    workoutId: 'cycling_event_specific_endurance_01',
    bindings: [
      stepField('base_duration', ['event_base'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('surge_count', ['event_surges'], 'sets'),
      stepField('surge_duration', ['event_surges'], 'duration.seconds'),
      stepField('gap_close_count', ['event_gap_close'], 'sets', { zeroBehavior: 'omit_step' }),
      stepField('gap_close_duration', ['event_gap_close'], 'duration.seconds'),
      stepField('finish_duration', ['event_finish'], 'duration.seconds', { zeroBehavior: 'omit_step' })
    ]
  },
  {
    workoutId: 'cycling_gap_closing_01',
    bindings: [
      stepField('effort_count', ['gap_efforts'], 'sets'),
      stepField('effort_duration', ['gap_efforts'], 'duration.seconds'),
      stepField('recovery_duration', ['gap_efforts'], 'restAfterSec'),
      stepField('effort_rpe', ['gap_efforts'], 'target.rpe', { range: { minOffset: -1, maxOffset: 1 } })
    ]
  },
  {
    workoutId: 'running_walk_run_01',
    bindings: [
      resolver('total_running_minutes', ['walk_run_main'], 'walk_run_distribution'),
      resolver('run_interval_minutes', ['walk_run_main'], 'walk_run_distribution'),
      resolver('walk_interval_minutes', ['walk_run_main'], 'walk_run_distribution')
    ]
  },
  {
    workoutId: 'cycling_race_simulation_50_01',
    bindings: [
      stepField('simulation_duration', ['race_variable'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      resolver('short_surge_count', ['race_variable'], 'embedded_short_surges'),
      resolver('gap_close_count', ['race_variable'], 'embedded_gap_closing_efforts'),
      stepField('finish_duration', ['race_finish'], 'duration.seconds')
    ]
  },
  {
    workoutId: 'travel_aerobic_maintenance_01',
    bindings: [
      stepField('aerobic_duration', ['travel_aerobic_main'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('aerobic_rpe', ['travel_aerobic_main'], 'target.rpe', { range: { minOffset: -1, maxOffset: 1 } })
    ]
  },
  {
    workoutId: 'travel_strength_maintenance_01',
    bindings: [
      stepField('circuit_rounds', ['travel_squat', 'travel_push', 'travel_pull', 'travel_trunk'], 'sets'),
      stepField('working_repetitions', ['travel_squat', 'travel_push', 'travel_pull'], 'duration.repetitions'),
      stepField('strength_rir', ['travel_squat'], 'target.reps_in_reserve', { range: { minOffset: 0, maxOffset: 2 } }),
      stepField('strength_rir', ['travel_push', 'travel_pull'], 'target.reps_in_reserve', { range: { minOffset: -1, maxOffset: 2 } })
    ]
  },
  {
    workoutId: 'strength_upper_body_trunk_01',
    bindings: [
      stepField('working_sets', ['upper_bench', 'upper_pull', 'upper_trunk'], 'sets'),
      stepField('working_rir', ['upper_bench', 'upper_pull', 'upper_pushup'], 'target.reps_in_reserve', { range: { minOffset: -1, maxOffset: 2 } })
    ]
  },
  {
    workoutId: 'cycling_taper_sharpening_01',
    bindings: [
      stepField('stimulus_count', ['sharpen_efforts'], 'sets'),
      stepField('stimulus_duration', ['sharpen_efforts'], 'duration.seconds'),
      stepField('surge_count', ['sharpen_surges'], 'sets', { zeroBehavior: 'omit_step' })
    ]
  },
  {
    workoutId: 'cycling_pre_race_openers_01',
    bindings: [
      stepField('opener_count', ['openers_cadence'], 'sets', { zeroBehavior: 'omit_step' }),
      stepField('opener_duration', ['openers_cadence'], 'duration.seconds'),
      stepField('race_touch_duration', ['openers_effort'], 'duration.seconds', { zeroBehavior: 'omit_step' })
    ]
  },
  {
    workoutId: 'strength_race_week_primer_01',
    bindings: [
      stepField('primer_sets', ['primer_squat', 'primer_bench', 'primer_pull'], 'sets'),
      stepField('primer_rir', ['primer_squat'], 'target.reps_in_reserve', { range: { minOffset: -1, maxOffset: 1 } }),
      stepField('primer_rir', ['primer_bench', 'primer_pull'], 'target.reps_in_reserve', { range: { minOffset: -2, maxOffset: 1 } })
    ]
  },
  {
    workoutId: 'cycling_race_day_01',
    bindings: [
      stepField('event_duration', ['race_day_main'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('warmup_duration', ['race_day_warmup'], 'duration.seconds', { transform: 'minutes_to_seconds' }),
      stepField('finish_duration', ['race_day_finish'], 'duration.seconds')
    ]
  }
];
