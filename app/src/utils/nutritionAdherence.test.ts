import { describe, expect, it } from 'vitest';
import {
  NUTRITION_ADHERENCE_OPTIONS,
  getNutritionAdherenceCheckinRange,
} from './nutritionAdherence';
import { NUTRITION_TRACKING_ADHERENCE_LEVELS } from '../engine/models';

describe('nutritionAdherence utility', () => {
  it('covers all canonical NUTRITION_TRACKING_ADHERENCE_LEVELS in NUTRITION_ADHERENCE_OPTIONS', () => {
    const valuesInOptions = NUTRITION_ADHERENCE_OPTIONS.map((o) => o.value);
    expect(valuesInOptions).toEqual(expect.arrayContaining([...NUTRITION_TRACKING_ADHERENCE_LEVELS]));
    expect(valuesInOptions.length).toBe(NUTRITION_TRACKING_ADHERENCE_LEVELS.length);
  });

  it('maps a displayed nutrition window to the D+1 check-in window', () => {
    expect(getNutritionAdherenceCheckinRange('2026-08-24', '2026-09-20')).toEqual({
      startDateInclusive: '2026-08-25',
      endDateExclusive: '2026-09-22',
    });
  });

});
