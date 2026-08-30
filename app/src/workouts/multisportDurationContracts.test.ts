import { describe, expect, it } from 'vitest';
import { RUNNING_RACE_WORKOUTS } from './catalog/running-race';
import { SWIMMING_WORKOUTS } from './catalog/swimming';

const MULTISPORT_WORKOUTS = [...RUNNING_RACE_WORKOUTS, ...SWIMMING_WORKOUTS];

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

describe('multisport executable duration contracts', () => {
  for (const workout of MULTISPORT_WORKOUTS) {
    for (const variant of workout.variants) {
      it(`${workout.id}/${variant.id} matches its declared target duration`, () => {
        expect(variantDurationSeconds(workout, variant.id)).toBe(variant.targetDurationMin * 60);
      });
    }
  }
});
