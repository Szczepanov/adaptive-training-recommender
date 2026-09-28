import type { WorkoutDefinition } from './models.ts';
import type { AthleticCapabilityKey } from '../engine/models.ts';
import {
  mechanicalIdentityFor,
  type MechanicalDoseVariant,
  type MechanicalStage,
} from './mechanicalExposure.ts';

/**
 * Issue #805: canonical owner of athletic-capability identity for periodic
 * broad-athleticism maintenance.
 *
 * Credit is per capability x workout x authored variant x retained steps (D-I): one variant
 * can keep a capability's defining steps while omitting another's, so qualification is
 * declared per mapping row rather than per workout. The #804 mechanical stage is read from
 * `mechanicalIdentityFor`, never duplicated here.
 *
 * Deliberately unmapped: every `running_*` identity, `running_walk_run_01` and
 * `strength_reactive_power_01`. Generic running or plyometric work never earns change of
 * direction or sport skill. Capability keys are sport-neutral; `sport` is metadata only, so
 * a future racket/court identity adds rows rather than new capability semantics.
 *
 * Owned by the `policy.evergreen.athletic_capability_maintenance_v1` knowledge claim.
 */
export interface AthleticCapabilityIdentity {
  workoutId: string;
  capability: AthleticCapabilityKey;
  /** Step ids that define this capability; every one must be retained for credit. */
  requiredStepIds: readonly string[];
  /** Authored variants that retain every required step. */
  qualifyingVariants: readonly MechanicalDoseVariant[];
  sport?: string;
}

export const ATHLETIC_CAPABILITY_IDENTITIES: readonly AthleticCapabilityIdentity[] = [
  {
    workoutId: 'field_sprint_mechanics_foundation_01',
    capability: 'linear_speed_skill',
    requiredStepIds: ['a_march', 'falling_starts'],
    qualifyingVariants: ['full', 'reduced', 'return_to_training'],
  },
  {
    workoutId: 'field_acceleration_braking_01',
    capability: 'linear_speed_skill',
    requiredStepIds: ['accel_20m'],
    qualifyingVariants: ['full', 'reduced', 'return_to_training'],
  },
  {
    workoutId: 'field_acceleration_braking_01',
    capability: 'acceleration_deceleration',
    requiredStepIds: ['accel_20m', 'braking_sticks'],
    qualifyingVariants: ['full', 'reduced'],
  },
  {
    workoutId: 'field_controlled_maintenance_01',
    capability: 'acceleration_deceleration',
    requiredStepIds: ['accels', 'decelerations'],
    qualifyingVariants: ['full', 'reduced'],
    sport: 'football',
  },
  {
    workoutId: 'field_controlled_maintenance_01',
    capability: 'multidirectional_change_of_direction',
    requiredStepIds: ['cuts'],
    qualifyingVariants: ['full', 'reduced'],
    sport: 'football',
  },
  {
    workoutId: 'field_controlled_maintenance_01',
    capability: 'sport_skill',
    requiredStepIds: ['ball_skill'],
    qualifyingVariants: ['full', 'reduced', 'return_to_training'],
    sport: 'football',
  },
];

export const ATHLETIC_CAPABILITY_WORKOUT_IDS: readonly string[] = [
  ...new Set(ATHLETIC_CAPABILITY_IDENTITIES.map(identity => identity.workoutId)),
];

export function capabilityIdentitiesFor(capability: AthleticCapabilityKey): readonly AthleticCapabilityIdentity[] {
  return ATHLETIC_CAPABILITY_IDENTITIES.filter(identity => identity.capability === capability);
}

/** The #804 stage an athlete must be eligible for before this capability workout. */
export function athleticCapabilityStageFor(workoutId: string): MechanicalStage | undefined {
  return mechanicalIdentityFor(workoutId)?.stage;
}

export interface AthleticCapabilityEvidence {
  workoutId?: string;
  capability: AthleticCapabilityKey;
  variant?: MechanicalDoseVariant;
  isReadinessModifiedDose?: boolean;
}

/**
 * Exact capability credit. Readiness-modified ad-hoc doses fail closed. A known variant
 * must retain every required step. Historical evidence without a variant follows #804's
 * backward-compatible unknown-variant behaviour; the knowledge claim records that this can
 * over-credit until performed facts carry exact variant/step completion.
 */
export function grantsAthleticCapabilityCredit(evidence: AthleticCapabilityEvidence): boolean {
  if (!evidence.workoutId || evidence.isReadinessModifiedDose) return false;
  const identity = ATHLETIC_CAPABILITY_IDENTITIES.find(item =>
    item.workoutId === evidence.workoutId && item.capability === evidence.capability);
  if (!identity) return false;
  return evidence.variant === undefined || identity.qualifyingVariants.includes(evidence.variant);
}

/** Every capability one performed session credits; a session may credit several. */
export function athleticCapabilitiesCreditedBy(
  evidence: Omit<AthleticCapabilityEvidence, 'capability'>,
): AthleticCapabilityKey[] {
  return [...new Set(ATHLETIC_CAPABILITY_IDENTITIES
    .filter(identity => grantsAthleticCapabilityCredit({ ...evidence, capability: identity.capability }))
    .map(identity => identity.capability))];
}

/**
 * Validates catalog alignment per mapping row:
 * - the workout exists, is active, and is a #804 `maintenance_candidate`;
 * - every required step exists;
 * - every declared qualifying variant exists and retains every required step.
 */
export function validateAthleticCapabilityIdentities(workouts: readonly WorkoutDefinition[]): string[] {
  const errors: string[] = [];
  const byId = new Map(workouts.map(workout => [workout.id, workout]));
  for (const identity of ATHLETIC_CAPABILITY_IDENTITIES) {
    const label = `athletic capability ${identity.workoutId}/${identity.capability}`;
    const workout = byId.get(identity.workoutId);
    if (!workout) {
      errors.push(`${label}: missing workout`);
      continue;
    }
    if (workout.status !== 'active') errors.push(`${label}: workout is not active`);
    const mechanical = mechanicalIdentityFor(identity.workoutId);
    if (mechanical?.planningUse !== 'maintenance_candidate') {
      errors.push(`${label}: not a #804 mechanical maintenance candidate`);
    }
    if (identity.requiredStepIds.length === 0) errors.push(`${label}: no required steps declared`);
    const stepIds = new Set(workout.blocks.flatMap(block => block.steps.map(step => step.id)));
    for (const stepId of identity.requiredStepIds) {
      if (!stepIds.has(stepId)) errors.push(`${label}: missing required step ${stepId}`);
    }
    for (const variantId of identity.qualifyingVariants) {
      const variant = workout.variants.find(item => item.id === variantId);
      if (!variant) {
        errors.push(`${label}: missing qualifying variant ${variantId}`);
        continue;
      }
      const omitted = new Set(variant.stepOverrides.filter(override => override.omit).map(override => override.stepId));
      const dropped = identity.requiredStepIds.filter(stepId => omitted.has(stepId));
      if (dropped.length > 0) errors.push(`${label}: qualifying variant ${variantId} omits required step(s) ${dropped.join(', ')}`);
    }
  }
  return errors;
}
