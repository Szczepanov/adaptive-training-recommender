import type { WorkoutDefinition } from './models.ts';

/**
 * Issue #804 / ADR-0044 D1: canonical owner of mechanical and impact exposure identity.
 *
 * Mechanical/impact tolerance is a longitudinal physical capability distinct from
 * `impactTissue` cost, metabolic conditioning, or generic strength.
 *
 * Discrete Progression Stages:
 * - Stage 1: Landing / low pogo / low-dose walk-run (re-entry & baseline impact tolerance).
 * - Stage 2: Low-volume bilateral jump + linear acceleration / continuous easy running.
 * - Stage 3: Deceleration & larger braking mechanics (high eccentric requirement).
 * - Stage 4: Multidirectional & broader change-of-direction (COD) field exposure.
 *
 * Owned by the `policy.evergreen.mechanical_exposure_v1` knowledge claim.
 */
export type MechanicalExposureClass =
  | 'landing_drills'
  | 'bilateral_plyometrics'
  | 'linear_mechanics'
  | 'deceleration_braking'
  | 'multidirectional_field';

export type MechanicalStage = 1 | 2 | 3 | 4;
export type MechanicalDoseVariant = 'full' | 'reduced' | 'return_to_training';

export interface MechanicalDose {
  stage: MechanicalStage;
  exposureClasses: readonly MechanicalExposureClass[];
  contactCountBand?: { min: number; max: number };
  estimatedContacts?: number;
  runningDurationMin?: number;
  multidirectional: boolean;
  laterality: 'bilateral' | 'unilateral' | 'mixed';
  surface?: 'field' | 'track' | 'road' | 'trail' | 'indoor' | 'unspecified';
}

export interface MechanicalQualifyingIdentity {
  workoutId: string;
  stage: MechanicalStage;
  dose: MechanicalDose;
  /** Step ids that carry the mechanical impact content. */
  stepIds: readonly string[];
  /** Authored variants that retain meaningful mechanical impact content. */
  qualifyingVariants: readonly MechanicalDoseVariant[];
}

export const MECHANICAL_QUALIFYING_IDENTITIES: readonly MechanicalQualifyingIdentity[] = [
  {
    workoutId: 'running_walk_run_01',
    stage: 1,
    dose: {
      stage: 1,
      exposureClasses: ['landing_drills'],
      contactCountBand: { min: 200, max: 400 },
      runningDurationMin: 18,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['walk_run_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_easy_continuous_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 2500, max: 5000 },
      runningDurationMin: 40,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['easy_run_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'strength_reactive_power_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['bilateral_plyometrics', 'landing_drills'],
      contactCountBand: { min: 30, max: 60 },
      estimatedContacts: 57,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'indoor',
    },
    stepIds: ['reactive_pogo', 'reactive_cmj', 'reactive_drop'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'field_sprint_mechanics_foundation_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['landing_drills', 'linear_mechanics'],
      contactCountBand: { min: 20, max: 50 },
      estimatedContacts: 30,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'field',
    },
    stepIds: ['a_march', 'falling_starts'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'field_acceleration_braking_01',
    stage: 3,
    dose: {
      stage: 3,
      exposureClasses: ['linear_mechanics', 'deceleration_braking'],
      contactCountBand: { min: 30, max: 60 },
      estimatedContacts: 40,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'field',
    },
    stepIds: ['accel_20m', 'braking_sticks'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'field_controlled_maintenance_01',
    stage: 4,
    dose: {
      stage: 4,
      exposureClasses: ['linear_mechanics', 'deceleration_braking', 'multidirectional_field'],
      contactCountBand: { min: 40, max: 80 },
      estimatedContacts: 60,
      multidirectional: true,
      laterality: 'mixed',
      surface: 'field',
    },
    stepIds: ['accels', 'decelerations', 'cuts', 'ball_skill'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_long_run_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 6000, max: 14000 },
      runningDurationMin: 90,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['long_run_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_race_pace_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 3500, max: 7000 },
      runningDurationMin: 55,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['race_pace_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_tempo_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 3000, max: 6000 },
      runningDurationMin: 40,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['tempo_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_vo2_4x4_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 3000, max: 6000 },
      runningDurationMin: 40,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['vo2_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'running_hill_repeats_01',
    stage: 2,
    dose: {
      stage: 2,
      exposureClasses: ['linear_mechanics'],
      contactCountBand: { min: 2500, max: 5000 },
      runningDurationMin: 35,
      multidirectional: false,
      laterality: 'bilateral',
      surface: 'road',
    },
    stepIds: ['hill_main'],
    qualifyingVariants: ['full', 'reduced'],
  },
];

export const MECHANICAL_QUALIFYING_WORKOUT_IDS: readonly string[] = MECHANICAL_QUALIFYING_IDENTITIES.map(i => i.workoutId);

const MECHANICAL_IDENTITY_BY_WORKOUT_ID: ReadonlyMap<string, MechanicalQualifyingIdentity> = new Map(
  MECHANICAL_QUALIFYING_IDENTITIES.map(identity => [identity.workoutId, identity]),
);

export function mechanicalIdentityFor(workoutId: string | undefined): MechanicalQualifyingIdentity | undefined {
  return workoutId ? MECHANICAL_IDENTITY_BY_WORKOUT_ID.get(workoutId) : undefined;
}

export interface MechanicalExposureEvidence {
  workoutId?: string;
  isReadinessModifiedDose?: boolean;
  variant?: MechanicalDoseVariant;
}

/**
 * Checks whether an exposure qualifies for mechanical/impact exposure credit.
 * Fails closed on readiness-modified doses or non-qualifying dose variants.
 */
export function grantsMechanicalExposureCredit(evidence: MechanicalExposureEvidence): boolean {
  const identity = mechanicalIdentityFor(evidence.workoutId);
  if (!identity || evidence.isReadinessModifiedDose) return false;
  return evidence.variant === undefined || identity.qualifyingVariants.includes(evidence.variant);
}

/**
 * Validates catalog alignment:
 * - Every mapped workout must exist and be active.
 * - Every declared mechanical step must exist in the workout.
 * - Every qualifying variant must retain at least one declared mechanical step.
 */
export function validateMechanicalQualifyingIdentities(workouts: readonly WorkoutDefinition[]): string[] {
  const errors: string[] = [];
  const byId = new Map(workouts.map(workout => [workout.id, workout]));

  for (const identity of MECHANICAL_QUALIFYING_IDENTITIES) {
    const workout = byId.get(identity.workoutId);
    if (!workout) {
      errors.push(`mechanical identity ${identity.workoutId}: missing workout`);
      continue;
    }
    if (workout.status !== 'active') {
      errors.push(`mechanical identity ${identity.workoutId}: workout is not active`);
    }
    if (identity.stepIds.length === 0) {
      errors.push(`mechanical identity ${identity.workoutId}: no mechanical steps declared`);
    }
    const stepIds = new Set(workout.blocks.flatMap(block => block.steps.map(step => step.id)));
    for (const stepId of identity.stepIds) {
      if (!stepIds.has(stepId)) {
        errors.push(`mechanical identity ${identity.workoutId}: missing mechanical step ${stepId}`);
      }
    }
    for (const variant of workout.variants) {
      const omitted = new Set(variant.stepOverrides.filter(override => override.omit).map(override => override.stepId));
      const retained = identity.stepIds.filter(stepId => !omitted.has(stepId));
      if (identity.qualifyingVariants.includes(variant.id as MechanicalDoseVariant) && retained.length === 0) {
        errors.push(`mechanical identity ${identity.workoutId}: qualifying variant ${variant.id} omits every mechanical step`);
      }
    }
    for (const variantId of identity.qualifyingVariants) {
      if (!workout.variants.some(variant => variant.id === variantId)) {
        errors.push(`mechanical identity ${identity.workoutId}: missing qualifying variant ${variantId}`);
      }
    }
  }

  return errors;
}
