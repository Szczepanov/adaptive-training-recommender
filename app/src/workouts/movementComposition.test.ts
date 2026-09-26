import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { WORKOUTS } from './catalog';
import { validateWorkoutLibrary } from './validation';

describe('authored movement composition', () => {
  const fullBody = WORKOUTS.find(workout => workout.id === 'strength_full_body_maintenance_01')!;
  const lowerBody = WORKOUTS.find(workout => workout.id === 'strength_lower_body_01')!;

  it('requires unilateral composition in normal full-body and lower-body strength workouts', () => {
    expect(fullBody.compositionRequirements).toEqual([
      { id: 'regular_unilateral_lower_body', pattern: 'unilateral_lower_body', stepIds: ['unilateral_lower_body'] },
    ]);
    expect(lowerBody.compositionRequirements?.[0].stepIds).toContain('lower_split_squat');
    expect(validateWorkoutLibrary(EXERCISES, WORKOUTS).errors.filter(error => error.includes('composition'))).toEqual([]);
  });

  it('keeps the requirement in reduced dose and requires an explicit return-to-training relaxation', () => {
    const reduced = fullBody.variants.find(variant => variant.id === 'reduced')!;
    const reentry = fullBody.variants.find(variant => variant.id === 'return_to_training')!;
    expect(reduced.stepOverrides.find(item => item.stepId === 'unilateral_lower_body')).toMatchObject({ sets: 1 });
    expect(reentry.compositionRelaxations).toEqual([{ pattern: 'unilateral_lower_body', reason: expect.any(String) }]);
  });

  it('rejects a unilateral component silently replaced by a bilateral exercise', () => {
    const invalid = structuredClone(fullBody);
    invalid.substitutions.push({
      exerciseId: 'rear_foot_elevated_split_squat',
      substituteExerciseId: 'front_squat',
      reason: 'A bilateral alternative.',
    });
    const result = validateWorkoutLibrary(EXERCISES, [invalid]);
    expect(result.errors.some(error => error.includes('loses unilateral_lower_body'))).toBe(true);
  });
});
