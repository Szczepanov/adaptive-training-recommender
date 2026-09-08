import type { WorkoutDefinition } from './models.ts';

/** Generic planning vocabulary. The September cycling set is merely its first
 * descriptor; evergreen adds the `general` phase in Phase 7.5. */
export type PlanPhase = 'build' | 'travel' | 'peak' | 'taper' | 'race' | 'recovery' | 'general';
export type PlanRequirement = 'required' | 'optional' | 'conditional';

export type PlanCoverageKey =
  | 'aerobic_volume'
  | 'recovery_spin'
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

export interface PlanSessionCoverage {
  key: PlanCoverageKey;
  label: string;
  phases: PlanPhase[];
  requirement: PlanRequirement;
  workoutIds: string[];
  notes: string;
}

/** @deprecated Use the generic Plan* vocabulary. Retained while existing consumers
 * migrate without changing the frozen September descriptor. */
export type EventPlanPhase = Exclude<PlanPhase, 'general'>;
/** @deprecated Use PlanRequirement. */
export type EventPlanRequirement = PlanRequirement;
/** @deprecated Use PlanCoverageKey. */
export type EventPlanCoverageKey = PlanCoverageKey;
/** @deprecated Use PlanSessionCoverage. */
export type EventPlanSessionCoverage = PlanSessionCoverage;

export type CoverageSetId = 'september_cycling_event' | 'evergreen_general';
export interface CoverageSetDescriptor {
  id: CoverageSetId;
  coverage: readonly PlanSessionCoverage[];
  requiredKeys: readonly PlanCoverageKey[];
  phases: readonly PlanPhase[];
}

/** Stable id of the one authored coverage set that exists today. ADR-0017 D-COVSET turns
 * this into a registry key; ADR-0018 D-MISS already needs it as part of a role
 * occurrence's canonical identity. */
export const SEPTEMBER_CYCLING_EVENT_COVERAGE_SET_ID = 'september_cycling_event';

export const SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE: PlanSessionCoverage[] = [
  { key: 'aerobic_volume', label: 'Easy Zone 2 aerobic volume', phases: ['build', 'travel', 'peak', 'taper', 'recovery'], requirement: 'required', workoutIds: ['cycling_zone2_standard_01'], notes: 'Counts only the authored Zone 2 prescription at or above its catalog minimum duration; a recovery spin never replaces this floor.' },
  { key: 'recovery_spin', label: 'Optional recovery spin', phases: ['build', 'travel', 'peak', 'taper', 'recovery'], requirement: 'optional', workoutIds: ['cycling_recovery_spin_01'], notes: 'Useful active recovery, but never aerobic-volume coverage.' },
  { key: 'sustained_quality', label: 'Controlled threshold, over-under or longer aerobic-power work', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_controlled_threshold_4x8_01', 'cycling_over_under_3x12_01', 'cycling_vo2_6x3_01', 'cycling_vo2_variable_01', 'cycling_vo2_short_30_15_01'], notes: 'Choose interval count, duration and recovery from the generic parameter ranges; the default 6x3 aerobic-power prescription belongs to this role too.' },
  { key: 'short_surges', label: 'Repeated short accelerations', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_short_surges_10x20_01', 'cycling_event_specific_endurance_01', 'cycling_criterium_surges_01'], notes: 'Covers wheel-holding and position changes without requiring maximal sprint testing.' },
  { key: 'gap_closing', label: 'Longer gap-closing efforts', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_gap_closing_01', 'cycling_race_simulation_50_01'], notes: 'Adjust efforts within the event-relevant 30-second to 3-minute range.' },
  // cycling_criterium_surges_01 is the only outdoor_event_specific option that fits a
  // <=45-minute capacity ceiling -- the other two need 50+ minutes -- so a criterium
  // athlete with limited weekday time still has a feasible race-specific ride to reserve
  // this required role against, instead of the role silently going unfulfilled.
  { key: 'outdoor_event_specific', label: 'Outdoor event-specific endurance ride', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['cycling_event_specific_endurance_01', 'cycling_race_simulation_50_01', 'cycling_criterium_surges_01'], notes: 'Combines endurance, continued pedalling after surges, positioning practice and a late finish. A compact surge-focused variant covers short-on-time criterium athletes.' },
  { key: 'primary_strength', label: 'Primary full-body strength maintenance', phases: ['build', 'peak'], requirement: 'required', workoutIds: ['strength_full_body_maintenance_01'], notes: 'Use the reduced variant during peak-specific weeks.' },
  { key: 'compact_strength', label: 'Compact power and strength maintenance', phases: ['build', 'travel'], requirement: 'optional', workoutIds: ['strength_compact_power_01', 'strength_reactive_power_01', 'travel_strength_maintenance_01', 'strength_bodyweight_full_body_01'], notes: 'Remove first when it compromises cycling quality or taper freshness. The zero-equipment bodyweight identity is a genuine travel-compatible alternative here too.' },
  { key: 'upper_body_trunk', label: 'Upper-body and trunk-only maintenance', phases: ['build', 'travel', 'peak'], requirement: 'conditional', workoutIds: ['strength_upper_body_trunk_01'], notes: 'Yellow-light alternative when lower-body loading is inappropriate.' },
  { key: 'field_maintenance', label: 'Controlled football and field exposure', phases: ['build', 'peak'], requirement: 'optional', workoutIds: ['field_controlled_maintenance_01'], notes: 'Remove in the final 7–10 days before the event.' },
  { key: 'walk_run', label: 'Optional easy walk-run', phases: ['build', 'travel'], requirement: 'optional', workoutIds: ['running_walk_run_01'], notes: 'Use only when calf, Achilles and knee response remain normal.' },
  { key: 'recovery_or_rest', label: 'Mobility, easy recovery or complete rest', phases: ['build', 'travel', 'peak', 'taper', 'recovery'], requirement: 'required', workoutIds: ['recovery_mobility_tissue_01', 'cycling_recovery_spin_01', 'rest_complete_01'], notes: 'Provides active and passive recovery choices for normal, yellow-light and race-week days.' },
  { key: 'travel_aerobic', label: 'Travel aerobic maintenance', phases: ['travel'], requirement: 'required', workoutIds: ['travel_aerobic_maintenance_01'], notes: 'Works with any available hotel aerobic machine and uses RPE rather than transferred watts.' },
  { key: 'travel_strength', label: 'Hotel-gym strength maintenance', phases: ['travel'], requirement: 'required', workoutIds: ['travel_strength_maintenance_01'], notes: 'Adjustable circuit using basic dumbbells or bodyweight.' },
  { key: 'taper_sharpening', label: 'Short race-specific sharpening ride', phases: ['taper'], requirement: 'required', workoutIds: ['cycling_taper_sharpening_01'], notes: 'Retains intensity while substantially reducing total volume.' },
  { key: 'pre_race_openers', label: 'Pre-race openers or rest', phases: ['taper'], requirement: 'required', workoutIds: ['cycling_pre_race_openers_01', 'rest_complete_01'], notes: 'Choose openers only when they reliably improve freshness and confidence.' },
  { key: 'race_week_strength', label: 'Race-week strength primer', phases: ['taper'], requirement: 'required', workoutIds: ['strength_race_week_primer_01'], notes: 'Short, low-volume and early enough to avoid soreness.' },
  { key: 'race_day', label: 'September cycling event', phases: ['race'], requirement: 'required', workoutIds: ['cycling_race_day_01'], notes: 'Represents warm-up, variable race execution and the planned fatigued finish.' }
];

const requiredCoverageKeys: PlanCoverageKey[] = [
  'aerobic_volume', 'sustained_quality', 'short_surges', 'gap_closing',
  'outdoor_event_specific', 'primary_strength', 'recovery_or_rest',
  'travel_aerobic', 'travel_strength', 'taper_sharpening',
  'pre_race_openers', 'race_week_strength', 'race_day'
];

const phaseRestrictedCoverage: Partial<Record<PlanCoverageKey, EventPlanPhase[]>> = {
  travel_aerobic: ['travel'],
  travel_strength: ['travel'],
  taper_sharpening: ['taper'],
  pre_race_openers: ['taper'],
  race_week_strength: ['taper'],
  race_day: ['race']
};

export const SEPTEMBER_CYCLING_EVENT_COVERAGE_SET: CoverageSetDescriptor = {
  id: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET_ID,
  coverage: SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
  requiredKeys: requiredCoverageKeys,
  phases: ['build', 'travel', 'peak', 'taper', 'race', 'recovery'],
};

/** Starting product policy for non-event training. This descriptor is intentionally
 * separate from the evidence metadata in evergreenStrategy.ts: it maps exact workout
 * identities to programming roles and makes no blanket scientific claim. */
export const EVERGREEN_SESSION_COVERAGE: PlanSessionCoverage[] = [
  { key: 'aerobic_volume', label: 'Continuous aerobic volume', phases: ['general'], requirement: 'required', workoutIds: ['cycling_zone2_standard_01', 'running_easy_continuous_01', 'walking_brisk_continuous_01'], notes: 'Counts only an authored continuous aerobic prescription at or above its catalog minimum duration; walk-run and generic recovery walking are not equivalent -- only the purposeful brisk-walk identity earns this credit.' },
  { key: 'sustained_quality', label: 'Optional sustained quality', phases: ['general'], requirement: 'optional', workoutIds: ['cycling_controlled_threshold_4x8_01', 'running_tempo_01'], notes: 'Optional performance work; it is introduced only by an eligible evidence-backed strategy.' },
  { key: 'primary_strength', label: 'Primary full-body strength', phases: ['general'], requirement: 'required', workoutIds: ['strength_full_body_maintenance_01', 'strength_bodyweight_full_body_01'], notes: 'Exact full-body resistance exposure for the strength role; the bodyweight identity is the zero-equipment floor so a no-equipment athlete has a reachable required-strength candidate.' },
  { key: 'compact_strength', label: 'Compact strength support', phases: ['general'], requirement: 'optional', workoutIds: ['strength_compact_power_01'], notes: 'Optional lower-time resistance alternative; never silently replaces a required full-body role.' },
  { key: 'recovery_or_rest', label: 'Recovery or rest', phases: ['general'], requirement: 'required', workoutIds: ['recovery_mobility_tissue_01', 'rest_complete_01'], notes: 'Supports recovery choices without creating aerobic or strength credit.' },
  { key: 'upper_body_trunk', label: 'Upper-body and trunk support', phases: ['general'], requirement: 'conditional', workoutIds: ['strength_upper_body_trunk_01'], notes: 'Conditional alternative when lower-body loading is inappropriate.' },
  { key: 'walk_run', label: 'Optional walk-run', phases: ['general'], requirement: 'optional', workoutIds: ['running_walk_run_01'], notes: 'A distinct low-impact entry; it is not credited as full continuous aerobic volume.' },
];

export const EVERGREEN_GENERAL_COVERAGE_SET: CoverageSetDescriptor = {
  id: 'evergreen_general',
  coverage: EVERGREEN_SESSION_COVERAGE,
  requiredKeys: ['aerobic_volume', 'primary_strength', 'recovery_or_rest'],
  phases: ['general'],
};

/** Registry authority for coverage lookup. Its single entry is intentionally not a
 * behavioural change; Phase 7.5 adds the peer evergreen descriptor. */
export const COVERAGE_SETS: Record<CoverageSetId, CoverageSetDescriptor> = {
  [SEPTEMBER_CYCLING_EVENT_COVERAGE_SET_ID]: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
  evergreen_general: EVERGREEN_GENERAL_COVERAGE_SET,
};

export function coverageSetFor(id: CoverageSetId): CoverageSetDescriptor {
  return COVERAGE_SETS[id];
}

function samePhases(actual: readonly PlanPhase[], expected: readonly PlanPhase[]): boolean {
  return actual.length === expected.length && expected.every((phase) => actual.includes(phase));
}

export function validatePlanCoverage(
  workouts: WorkoutDefinition[],
  descriptor: CoverageSetDescriptor,
): string[] {
  const errors: string[] = [];
  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const coverageKeys = new Set<PlanCoverageKey>();

  for (const item of descriptor.coverage) {
    if (coverageKeys.has(item.key)) errors.push(`Duplicate plan coverage key: ${item.key}`);
    coverageKeys.add(item.key);
    if (!item.label.trim()) errors.push(`${item.key}: label is required`);
    if (!item.notes.trim()) errors.push(`${item.key}: notes are required`);
    if (item.phases.length === 0) errors.push(`${item.key}: at least one phase is required`);
    if (new Set(item.phases).size !== item.phases.length) errors.push(`${item.key}: duplicate phase`);
    if (item.workoutIds.length === 0) errors.push(`${item.key}: at least one workout is required`);
    if (new Set(item.workoutIds).size !== item.workoutIds.length) errors.push(`${item.key}: duplicate workout mapping`);

    if (descriptor.id === SEPTEMBER_CYCLING_EVENT_COVERAGE_SET_ID) {
      const restrictedPhases = phaseRestrictedCoverage[item.key];
      if (restrictedPhases && !samePhases(item.phases, restrictedPhases)) errors.push(`${item.key}: must be restricted to ${restrictedPhases.join(', ')}`);
      if (item.key === 'field_maintenance' && item.phases.some((phase) => phase === 'taper' || phase === 'race' || phase === 'recovery')) errors.push('field_maintenance: cannot be scheduled in taper or race phases');
    }

    for (const workoutId of item.workoutIds) {
      const workout = workoutById.get(workoutId);
      if (!workout) errors.push(`${item.key}: missing workout ${workoutId}`);
      else if (workout.status !== 'active') errors.push(`${item.key}: workout ${workoutId} is not active`);
    }
  }

  for (const requiredKey of descriptor.requiredKeys) if (!coverageKeys.has(requiredKey)) errors.push(`Missing required plan coverage key: ${requiredKey}`);

  for (const phase of descriptor.phases) {
    const phaseCoverage = descriptor.coverage.filter((item) => item.phases.includes(phase));
    if (phaseCoverage.length === 0) errors.push(`No workout coverage declared for phase: ${phase}`);
    if (!phaseCoverage.some((item) => item.requirement === 'required')) errors.push(`No required workout coverage declared for phase: ${phase}`);
  }

  return errors;
}

/** @deprecated Compatibility wrapper for callers that still supply only the September
 * coverage array. New code validates an explicit descriptor. */
export function validateEventPlanCoverage(
  workouts: WorkoutDefinition[],
  coverage: EventPlanSessionCoverage[] = SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
): string[] {
  return validatePlanCoverage(workouts, {
    ...SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
    coverage,
  });
}
