import type { WorkoutDefinition } from './models.ts';

export type EventPlanPhase = 'build' | 'travel' | 'peak' | 'taper' | 'race';
export type EventPlanRequirement = 'required' | 'optional' | 'conditional';

export type EventPlanCoverageKey =
  | 'easy_aerobic'
  | 'sustained_quality'
  | 'short_surges'
  | 'gap_closing'
  | 'outdoor_event_specific'
  | 'primary_strength'
  | 'compact_strength'
  | 'upper_body_trunk'
  | 'field_maintenance'
  | 'walk_run'
  | 'recovery_or_rest'
  | 'travel_aerobic'
  | 'travel_strength'
  | 'taper_sharpening'
  | 'pre_race_openers'
  | 'race_week_strength'
  | 'race_day';

export interface EventPlanSessionCoverage {
  key: EventPlanCoverageKey;
  label: string;
  phases: EventPlanPhase[];
  requirement: EventPlanRequirement;
  workoutIds: string[];
  notes: string;
}

export const SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE: EventPlanSessionCoverage[] = [
  { key: 'easy_aerobic', label: 'Easy Zone 2 or recovery cycling', phases: ['build', 'travel', 'peak', 'taper'], requirement: 'required', workoutIds: ['cycling_zone2_standard_01', 'cycling_recovery_spin_01'], notes: 'Adjust duration from short recovery riding to longer aerobic volume.' },
  { key: 'sustained_quality', label: 'Controlled threshold or over-under work', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_controlled_threshold_4x8_01', 'cycling_over_under_3x12_01'], notes: 'Choose interval count, duration and recovery from the generic parameter ranges.' },
  { key: 'short_surges', label: 'Repeated short accelerations', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_short_surges_10x20_01', 'cycling_event_specific_endurance_01'], notes: 'Covers wheel-holding and position changes without requiring maximal sprint testing.' },
  { key: 'gap_closing', label: 'Longer gap-closing efforts', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_gap_closing_01', 'cycling_race_simulation_50_01'], notes: 'Adjust efforts within the event-relevant 30-second to 3-minute range.' },
  { key: 'outdoor_event_specific', label: 'Outdoor event-specific endurance ride', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_event_specific_endurance_01', 'cycling_race_simulation_50_01'], notes: 'Combines endurance, continued pedalling after surges, positioning practice and a late finish.' },
  { key: 'primary_strength', label: 'Primary full-body strength maintenance', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['strength_full_body_maintenance_01'], notes: 'Use the reduced variant during peak-specific weeks.' },
  { key: 'compact_strength', label: 'Compact power and strength maintenance', phases: ['build', 'travel'], requirement: 'optional', workoutIds: ['strength_compact_power_01', 'travel_strength_maintenance_01'], notes: 'Remove first when it compromises cycling quality or taper freshness.' },
  { key: 'upper_body_trunk', label: 'Upper-body and trunk-only maintenance', phases: ['build', 'travel', 'peak'], requirement: 'conditional', workoutIds: ['strength_upper_body_trunk_01'], notes: 'Yellow-light alternative when lower-body loading is inappropriate.' },
  { key: 'field_maintenance', label: 'Controlled football and field exposure', phases: ['build', 'peak'], requirement: 'optional', workoutIds: ['field_controlled_maintenance_01'], notes: 'Remove in the final 7–10 days before the event.' },
  { key: 'walk_run', label: 'Optional easy walk-run', phases: ['build', 'travel'], requirement: 'optional', workoutIds: ['running_walk_run_01'], notes: 'Use only when calf, Achilles and knee response remain normal.' },
  { key: 'recovery_or_rest', label: 'Mobility, easy recovery or complete rest', phases: ['build', 'travel', 'peak', 'taper'], requirement: 'required', workoutIds: ['recovery_mobility_tissue_01', 'cycling_recovery_spin_01', 'rest_complete_01'], notes: 'Provides active and passive recovery choices for normal, yellow-light and race-week days.' },
  { key: 'travel_aerobic', label: 'Travel aerobic maintenance', phases: ['travel'], requirement: 'required', workoutIds: ['travel_aerobic_maintenance_01'], notes: 'Works with any available hotel aerobic machine and uses RPE rather than transferred watts.' },
  { key: 'travel_strength', label: 'Hotel-gym strength maintenance', phases: ['travel'], requirement: 'required', workoutIds: ['travel_strength_maintenance_01'], notes: 'Adjustable circuit using basic dumbbells or bodyweight.' },
  { key: 'taper_sharpening', label: 'Short race-specific sharpening ride', phases: ['taper'], requirement: 'required', workoutIds: ['cycling_taper_sharpening_01'], notes: 'Retains intensity while substantially reducing total volume.' },
  { key: 'pre_race_openers', label: 'Pre-race openers or rest', phases: ['taper'], requirement: 'required', workoutIds: ['cycling_pre_race_openers_01', 'rest_complete_01'], notes: 'Choose openers only when they reliably improve freshness and confidence.' },
  { key: 'race_week_strength', label: 'Race-week strength primer', phases: ['taper'], requirement: 'required', workoutIds: ['strength_race_week_primer_01'], notes: 'Short, low-volume and early enough to avoid soreness.' },
  { key: 'race_day', label: 'September cycling event', phases: ['race'], requirement: 'required', workoutIds: ['cycling_race_day_01'], notes: 'Represents warm-up, variable race execution and the planned fatigued finish.' }
];

const requiredCoverageKeys: EventPlanCoverageKey[] = [
  'easy_aerobic', 'sustained_quality', 'short_surges', 'gap_closing',
  'outdoor_event_specific', 'primary_strength', 'recovery_or_rest',
  'travel_aerobic', 'travel_strength', 'taper_sharpening',
  'pre_race_openers', 'race_week_strength', 'race_day'
];

const phaseRestrictedCoverage: Partial<Record<EventPlanCoverageKey, EventPlanPhase[]>> = {
  travel_aerobic: ['travel'],
  travel_strength: ['travel'],
  taper_sharpening: ['taper'],
  pre_race_openers: ['taper'],
  race_week_strength: ['taper'],
  race_day: ['race']
};

function samePhases(actual: EventPlanPhase[], expected: EventPlanPhase[]): boolean {
  return actual.length === expected.length && expected.every((phase) => actual.includes(phase));
}

export function validateEventPlanCoverage(
  workouts: WorkoutDefinition[],
  coverage: EventPlanSessionCoverage[] = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE
): string[] {
  const errors: string[] = [];
  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const coverageKeys = new Set<EventPlanCoverageKey>();

  for (const item of coverage) {
    if (coverageKeys.has(item.key)) errors.push(`Duplicate event-plan coverage key: ${item.key}`);
    coverageKeys.add(item.key);
    if (!item.label.trim()) errors.push(`${item.key}: label is required`);
    if (!item.notes.trim()) errors.push(`${item.key}: notes are required`);
    if (item.phases.length === 0) errors.push(`${item.key}: at least one phase is required`);
    if (new Set(item.phases).size !== item.phases.length) errors.push(`${item.key}: duplicate phase`);
    if (item.workoutIds.length === 0) errors.push(`${item.key}: at least one workout is required`);
    if (new Set(item.workoutIds).size !== item.workoutIds.length) errors.push(`${item.key}: duplicate workout mapping`);

    const restrictedPhases = phaseRestrictedCoverage[item.key];
    if (restrictedPhases && !samePhases(item.phases, restrictedPhases)) errors.push(`${item.key}: must be restricted to ${restrictedPhases.join(', ')}`);
    if (item.key === 'field_maintenance' && item.phases.some((phase) => phase === 'taper' || phase === 'race')) errors.push('field_maintenance: cannot be scheduled in taper or race phases');

    for (const workoutId of item.workoutIds) {
      const workout = workoutById.get(workoutId);
      if (!workout) errors.push(`${item.key}: missing workout ${workoutId}`);
      else if (workout.status !== 'active') errors.push(`${item.key}: workout ${workoutId} is not active`);
    }
  }

  for (const requiredKey of requiredCoverageKeys) if (!coverageKeys.has(requiredKey)) errors.push(`Missing required event-plan coverage key: ${requiredKey}`);

  for (const phase of ['build', 'travel', 'peak', 'taper', 'race'] as EventPlanPhase[]) {
    const phaseCoverage = coverage.filter((item) => item.phases.includes(phase));
    if (phaseCoverage.length === 0) errors.push(`No workout coverage declared for phase: ${phase}`);
    if (!phaseCoverage.some((item) => item.requirement === 'required')) errors.push(`No required workout coverage declared for phase: ${phase}`);
  }

  return errors;
}
