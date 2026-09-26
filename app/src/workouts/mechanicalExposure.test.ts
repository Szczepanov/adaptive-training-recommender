import { describe, expect, it } from 'vitest';
import { WORKOUTS } from './catalog.ts';
import {
  grantsMechanicalExposureCredit,
  mechanicalIdentityFor,
  validateMechanicalQualifyingIdentities,
} from './mechanicalExposure.ts';

describe('mechanicalExposure catalog validation', () => {
  it('validates all declared qualifying mechanical identities against the active workout catalog', () => {
    const errors = validateMechanicalQualifyingIdentities(WORKOUTS);
    expect(errors).toEqual([]);
  });

  it('recognizes discrete stages across qualifying workouts', () => {
    expect(mechanicalIdentityFor('running_walk_run_01')?.stage).toBe(1);
    expect(mechanicalIdentityFor('running_easy_continuous_01')?.stage).toBe(2);
    expect(mechanicalIdentityFor('strength_reactive_power_01')?.stage).toBe(2);
    expect(mechanicalIdentityFor('field_sprint_mechanics_foundation_01')?.stage).toBe(2);
    expect(mechanicalIdentityFor('field_acceleration_braking_01')?.stage).toBe(3);
    expect(mechanicalIdentityFor('field_controlled_maintenance_01')?.stage).toBe(4);
  });

  it('credits mechanical exposure only on qualifying variants and denies readiness-modified doses', () => {
    expect(grantsMechanicalExposureCredit({ workoutId: 'running_walk_run_01', variant: 'full' })).toBe(true);
    expect(grantsMechanicalExposureCredit({ workoutId: 'running_walk_run_01', variant: 'reduced' })).toBe(true);
    expect(grantsMechanicalExposureCredit({ workoutId: 'running_walk_run_01', variant: 'return_to_training' })).toBe(false);
    expect(grantsMechanicalExposureCredit({ workoutId: 'running_walk_run_01', isReadinessModifiedDose: true })).toBe(false);
  });

  it('denies mechanical credit for non-impact workouts', () => {
    expect(mechanicalIdentityFor('strength_compact_power_01')).toBeUndefined();
    expect(grantsMechanicalExposureCredit({ workoutId: 'strength_compact_power_01', variant: 'full' })).toBe(false);
    expect(grantsMechanicalExposureCredit({ workoutId: 'cycling_zone2_standard_01', variant: 'full' })).toBe(false);
  });
});
