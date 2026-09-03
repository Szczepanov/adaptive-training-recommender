import { describe, expect, it } from 'vitest';
import { WORKOUTS } from './catalog';
import { EXERCISES } from './exercises';
import { validateWorkoutLibrary } from './validation';

describe('catalog workout recovery metadata audit (SKR3 W3)', () => {
  it('verifies that every catalog workout declares finite recoveryHours within [0, 168]', () => {
    expect(WORKOUTS.length).toBeGreaterThanOrEqual(40);
    for (const workout of WORKOUTS) {
      expect(workout.loadProfile.recoveryHours).toBeDefined();
      expect(typeof workout.loadProfile.recoveryHours).toBe('number');
      expect(Number.isFinite(workout.loadProfile.recoveryHours)).toBe(true);
      expect(workout.loadProfile.recoveryHours).toBeGreaterThanOrEqual(0);
      expect(workout.loadProfile.recoveryHours).toBeLessThanOrEqual(168);
    }
  });

  it('verifies that every workout declaring minimumDaysAfterHardLowerBody declares an integer in [1, 7]', () => {
    const declaringWorkouts = WORKOUTS.filter(
      workout => workout.eligibility.minimumDaysAfterHardLowerBody !== undefined
    );
    expect(declaringWorkouts.length).toBe(21);
    for (const workout of declaringWorkouts) {
      const minDays = workout.eligibility.minimumDaysAfterHardLowerBody;
      expect(Number.isInteger(minDays)).toBe(true);
      expect(minDays).toBeGreaterThanOrEqual(1);
      expect(minDays).toBeLessThanOrEqual(7);
    }
  });

  it('audits the distribution of minimumDaysAfterHardLowerBody overrides across modalities', () => {
    const byModality: Record<string, { total: number; minDays1: number; minDays2: number }> = {};
    for (const workout of WORKOUTS) {
      const mod = workout.modality;
      if (!byModality[mod]) {
        byModality[mod] = { total: 0, minDays1: 0, minDays2: 0 };
      }
      byModality[mod].total++;
      if (workout.eligibility.minimumDaysAfterHardLowerBody === 1) {
        byModality[mod].minDays1++;
      } else if (workout.eligibility.minimumDaysAfterHardLowerBody === 2) {
        byModality[mod].minDays2++;
      }
    }

    // 18 declare 1 day (authored override easing the 2-day fallback), 3 declare 2 days (explicitly matching the 48h boundary)
    expect(byModality.cycling.minDays1).toBe(8);
    expect(byModality.cycling.minDays2).toBe(1);
    expect(byModality.running.minDays1).toBe(5);
    expect(byModality.running.minDays2).toBe(0);
    expect(byModality.strength.minDays1).toBe(4);
    expect(byModality.strength.minDays2).toBe(0);
    expect(byModality.field.minDays1).toBe(1);
    expect(byModality.field.minDays2).toBe(2);
  });

  it('rejects workouts with out-of-bounds recoveryHours or invalid minimumDaysAfterHardLowerBody', () => {
    const base = WORKOUTS[0];

    const invalidRecNegative = { ...base, id: 'test_rec_neg', loadProfile: { ...base.loadProfile, recoveryHours: -5 } };
    const resNeg = validateWorkoutLibrary(EXERCISES, [invalidRecNegative]);
    expect(resNeg.errors).toContain('test_rec_neg: recoveryHours cannot be negative');

    const invalidRecExcess = { ...base, id: 'test_rec_excess', loadProfile: { ...base.loadProfile, recoveryHours: 200 } };
    const resExcess = validateWorkoutLibrary(EXERCISES, [invalidRecExcess]);
    expect(resExcess.errors).toContain('test_rec_excess: recoveryHours cannot exceed 168 hours (7 days)');

    const invalidMinDaysZero = { ...base, id: 'test_mindays_zero', eligibility: { ...base.eligibility, minimumDaysAfterHardLowerBody: 0 } };
    const resZero = validateWorkoutLibrary(EXERCISES, [invalidMinDaysZero]);
    expect(resZero.errors).toContain('test_mindays_zero: minimumDaysAfterHardLowerBody must be an integer between 1 and 7');

    const invalidMinDaysNonInt = { ...base, id: 'test_mindays_float', eligibility: { ...base.eligibility, minimumDaysAfterHardLowerBody: 1.5 } };
    const resFloat = validateWorkoutLibrary(EXERCISES, [invalidMinDaysNonInt]);
    expect(resFloat.errors).toContain('test_mindays_float: minimumDaysAfterHardLowerBody must be an integer between 1 and 7');
  });

  it('rejects non-finite recoveryHours values before range validation', () => {
    const base = WORKOUTS[0];
    for (const [suffix, recoveryHours] of [
      ['nan', Number.NaN],
      ['positive_infinity', Number.POSITIVE_INFINITY],
      ['negative_infinity', Number.NEGATIVE_INFINITY],
    ] as const) {
      const id = `test_rec_${suffix}`;
      const invalidWorkout = { ...base, id, loadProfile: { ...base.loadProfile, recoveryHours } };
      const result = validateWorkoutLibrary(EXERCISES, [invalidWorkout]);
      expect(result.errors).toContain(`${id}: recoveryHours must be finite`);
    }
  });
});
