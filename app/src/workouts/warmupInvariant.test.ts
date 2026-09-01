import { describe, expect, it } from 'vitest';
import { WORKOUTS } from './catalog';
import { EXERCISES } from './exercises';
import { validateWorkoutLibrary } from './validation';

describe('catalog strength warm-up invariant', () => {
  it('starts every active catalog strength workout with a non-empty warm-up block', () => {
    const strengthWorkouts = WORKOUTS.filter(workout => workout.status === 'active' && workout.modality === 'strength' && !workout.manualOnly);
    expect(strengthWorkouts).toHaveLength(9);
    for (const workout of strengthWorkouts) {
      expect(workout.blocks[0]).toMatchObject({ role: 'warmup' });
      expect(workout.blocks[0]?.steps.length).toBeGreaterThan(0);
      expect(workout.warmupKnowledgeClaimIds).toEqual(expect.arrayContaining([
        'strength.warmup.contextual_preparation',
        'strength.warmup.specific_rehearsal',
      ]));
    }
  });

  it('rejects a strength workout that loses its first warm-up block', () => {
    const primary = WORKOUTS.find(workout => workout.id === 'strength_full_body_maintenance_01');
    if (!primary) throw new Error('Missing primary strength workout');
    const invalid = { ...primary, blocks: primary.blocks.slice(1) };
    const result = validateWorkoutLibrary(EXERCISES, [invalid]);
    expect(result.errors).toContain('strength_full_body_maintenance_01: active catalog strength workout must begin with a non-empty warmup block');
  });
});
