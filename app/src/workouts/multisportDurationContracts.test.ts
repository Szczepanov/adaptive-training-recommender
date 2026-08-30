import { describe, expect, it } from 'vitest';
import { RUNNING_RACE_WORKOUTS } from './catalog/running-race';
import { SWIMMING_WORKOUTS } from './catalog/swimming';
import type { WorkoutDefinition, WorkoutParameter } from './models';

const MULTISPORT_WORKOUTS = [...RUNNING_RACE_WORKOUTS, ...SWIMMING_WORKOUTS];

type DurationChangingProperty = 'sets' | 'duration.seconds' | 'restAfterSec';

function durationChangingBindings(parameter: WorkoutParameter) {
  return parameter.bindings.filter(binding =>
    (['sets', 'duration.seconds', 'restAfterSec'] as DurationChangingProperty[])
      .includes(binding.property as DurationChangingProperty),
  );
}

/** Resolve the executable timed duration for a variant, including inter-set recovery. */
function variantDurationSeconds(workout: (typeof MULTISPORT_WORKOUTS)[number], variantId: 'full' | 'reduced' | 'return_to_training'): number {
  const variant = workout.variants.find(item => item.id === variantId);
  if (!variant) throw new Error(`Missing ${variantId} variant for ${workout.id}`);
  const overrides = new Map(variant.stepOverrides.map(override => [override.stepId, override]));

  return workout.blocks.flatMap(block => block.steps).reduce((total, step) => {
    const override = overrides.get(step.id);
    if (override?.omit) return total;
    if (step.duration.type !== 'time') throw new Error(`Multisport duration contract requires timed steps: ${workout.id}/${step.id}`);
    const sets = override?.sets ?? step.sets ?? 1;
    const seconds = override?.durationSeconds ?? step.duration.seconds;
    const restAfterSec = override?.restAfterSec ?? step.restAfterSec ?? 0;
    return total + (seconds * sets) + (restAfterSec * Math.max(0, sets - 1));
  }, 0);
}

/** Apply one adjustable parameter to the canonical full prescription and compute its real
 * elapsed time. Parameter bounds are part of the executable contract too: a knob exposed
 * as valid must not be able to push the full workout outside its declared duration range. */
function fullDurationWithParameterSeconds(workout: WorkoutDefinition, parameter: WorkoutParameter, value: number): number {
  const bindings = new Map(durationChangingBindings(parameter).map(binding => [binding.stepId, binding]));

  return workout.blocks.flatMap(block => block.steps).reduce((total, step) => {
    if (step.duration.type !== 'time') throw new Error(`Multisport duration contract requires timed steps: ${workout.id}/${step.id}`);
    let sets = step.sets ?? 1;
    let seconds = step.duration.seconds;
    let restAfterSec = step.restAfterSec ?? 0;
    const binding = bindings.get(step.id);

    if (binding?.property === 'sets') sets = value;
    if (binding?.property === 'duration.seconds') seconds = parameter.unit === 'minutes' ? value * 60 : value;
    if (binding?.property === 'restAfterSec') restAfterSec = parameter.unit === 'minutes' ? value * 60 : value;

    return total + (seconds * sets) + (restAfterSec * Math.max(0, sets - 1));
  }, 0);
}

describe('multisport executable duration contracts', () => {
  for (const workout of MULTISPORT_WORKOUTS) {
    for (const variant of workout.variants) {
      it(`${workout.id}/${variant.id} matches its declared target duration`, () => {
        expect(variantDurationSeconds(workout, variant.id)).toBe(variant.targetDurationMin * 60);
      });
    }

    for (const parameter of workout.parameters) {
      if (durationChangingBindings(parameter).length === 0) continue;
      for (const boundary of ['minimum', 'maximum'] as const) {
        it(`${workout.id}/${parameter.id} ${boundary} stays inside the canonical duration envelope`, () => {
          const seconds = fullDurationWithParameterSeconds(workout, parameter, parameter[boundary]);
          expect(seconds).toBeGreaterThanOrEqual(workout.duration.minimumMin * 60);
          expect(seconds).toBeLessThanOrEqual(workout.duration.maximumMin * 60);
        });
      }
    }
  }
});
