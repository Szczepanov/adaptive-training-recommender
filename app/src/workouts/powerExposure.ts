import type { WorkoutDefinition } from './models.ts';

/**
 * Issue #802 / ADR-0044 D1: canonical owner of neuromuscular-power exposure identity.
 *
 * Power credit is an exact authored mapping, never inferred from the broad `Strength`
 * modality, a `power` tag, a stimulus axis such as `sprintPower`, or "the session was hard".
 * Each entry names the steps that carry the power content and the dose variants that keep
 * them; a variant that omits every power step (e.g. `return_to_training`) is not a power
 * exposure. `impact` separates reactive landing work from non-impact alternatives so a
 * tissue restriction can block plyometrics without also erasing a safe, explicitly authored
 * non-impact power identity (ADR-0044 D9). Owned by the
 * `policy.evergreen.power_maintenance_exposure_v1` knowledge claim.
 */
export type PowerMechanism = 'olympic_derivative' | 'ballistic_throw' | 'reactive_plyometric';
export type PowerDoseVariant = 'full' | 'reduced' | 'return_to_training';

export interface PowerQualifyingIdentity {
  workoutId: string;
  mechanism: PowerMechanism;
  /** True when the power content involves jump/landing ground contacts. */
  impact: boolean;
  /** Step ids that carry the power content (warm-up rehearsals do not count). */
  powerStepIds: readonly string[];
  /** Authored variants that retain the power content at a meaningful dose. */
  qualifyingVariants: readonly PowerDoseVariant[];
}

export const POWER_QUALIFYING_IDENTITIES: readonly PowerQualifyingIdentity[] = [
  { workoutId: 'strength_full_body_maintenance_01', mechanism: 'olympic_derivative', impact: false, powerStepIds: ['power_clean'], qualifyingVariants: ['full', 'reduced'] },
  { workoutId: 'strength_lower_body_01', mechanism: 'olympic_derivative', impact: false, powerStepIds: ['lower_power_clean'], qualifyingVariants: ['full', 'reduced'] },
  { workoutId: 'strength_compact_power_01', mechanism: 'ballistic_throw', impact: false, powerStepIds: ['slam'], qualifyingVariants: ['full', 'reduced'] },
  { workoutId: 'strength_reactive_power_01', mechanism: 'reactive_plyometric', impact: true, powerStepIds: ['reactive_cmj', 'reactive_drop'], qualifyingVariants: ['full', 'reduced'] },
];

export const POWER_QUALIFYING_WORKOUT_IDS: readonly string[] = POWER_QUALIFYING_IDENTITIES.map(identity => identity.workoutId);

const POWER_IDENTITY_BY_WORKOUT_ID: ReadonlyMap<string, PowerQualifyingIdentity> = new Map(
  POWER_QUALIFYING_IDENTITIES.map(identity => [identity.workoutId, identity]),
);

export function powerIdentityFor(workoutId: string | undefined): PowerQualifyingIdentity | undefined {
  return workoutId ? POWER_IDENTITY_BY_WORKOUT_ID.get(workoutId) : undefined;
}

/** Exposure evidence needed to decide power credit. A readiness-modified dose is denied
 * conservatively: at planning time it cannot be distinguished from the variant that
 * removes the power content. */
export interface PowerExposureEvidence {
  workoutId?: string;
  isReadinessModifiedDose?: boolean;
  /** Materialized dose variant, when known. No planning/coverage caller has it today (they
   * pass `isReadinessModifiedDose` instead); the `full`/`reduced` contract is otherwise
   * enforced by `validatePowerQualifyingIdentities`. */
  variant?: PowerDoseVariant;
}

export function grantsPowerExposureCredit(evidence: PowerExposureEvidence): boolean {
  const identity = powerIdentityFor(evidence.workoutId);
  if (!identity || evidence.isReadinessModifiedDose) return false;
  return evidence.variant === undefined || identity.qualifyingVariants.includes(evidence.variant);
}

/** Catalog alignment: every mapped identity must exist, be an active strength workout,
 * contain its power steps and keep at least one of them in every qualifying variant.
 * A non-qualifying variant may retain reduced power content (the reactive re-entry dose
 * keeps two countermovement-jump sets); it simply earns no power credit. */
export function validatePowerQualifyingIdentities(workouts: readonly WorkoutDefinition[]): string[] {
  const errors: string[] = [];
  const byId = new Map(workouts.map(workout => [workout.id, workout]));
  for (const identity of POWER_QUALIFYING_IDENTITIES) {
    const workout = byId.get(identity.workoutId);
    if (!workout) { errors.push(`power identity ${identity.workoutId}: missing workout`); continue; }
    if (workout.status !== 'active') errors.push(`power identity ${identity.workoutId}: workout is not active`);
    if (workout.modality !== 'strength') errors.push(`power identity ${identity.workoutId}: must be an authored strength workout`);
    if (identity.powerStepIds.length === 0) errors.push(`power identity ${identity.workoutId}: no power steps declared`);
    const stepIds = new Set(workout.blocks.flatMap(block => block.steps.map(step => step.id)));
    for (const stepId of identity.powerStepIds) {
      if (!stepIds.has(stepId)) errors.push(`power identity ${identity.workoutId}: missing power step ${stepId}`);
    }
    for (const variant of workout.variants) {
      const omitted = new Set(variant.stepOverrides.filter(override => override.omit).map(override => override.stepId));
      const retained = identity.powerStepIds.filter(stepId => !omitted.has(stepId));
      if (identity.qualifyingVariants.includes(variant.id as PowerDoseVariant) && retained.length === 0) {
        errors.push(`power identity ${identity.workoutId}: qualifying variant ${variant.id} omits every power step`);
      }
    }
    for (const variantId of identity.qualifyingVariants) {
      if (!workout.variants.some(variant => variant.id === variantId)) errors.push(`power identity ${identity.workoutId}: missing qualifying variant ${variantId}`);
    }
  }
  return errors;
}
