import { describe, expect, it } from 'vitest';
import {
  NUTRITION_ADHERENCE_OPTIONS,
  toggleNutritionAdherence,
} from './nutritionAdherence';
import { NUTRITION_TRACKING_ADHERENCE_LEVELS } from '../engine/models';

describe('nutritionAdherence utility', () => {
  it('covers all canonical NUTRITION_TRACKING_ADHERENCE_LEVELS in NUTRITION_ADHERENCE_OPTIONS', () => {
    const valuesInOptions = NUTRITION_ADHERENCE_OPTIONS.map((o) => o.value);
    expect(valuesInOptions).toEqual(expect.arrayContaining([...NUTRITION_TRACKING_ADHERENCE_LEVELS]));
    expect(valuesInOptions.length).toBe(NUTRITION_TRACKING_ADHERENCE_LEVELS.length);
  });

  describe('toggleNutritionAdherence', () => {
    it('selects new value when current is null or undefined', () => {
      expect(toggleNutritionAdherence(null, 'fully_tracked')).toBe('fully_tracked');
      expect(toggleNutritionAdherence(undefined, 'fasted')).toBe('fasted');
    });

    it('toggles off (returns null) when clicking the already selected value', () => {
      expect(toggleNutritionAdherence('fully_tracked', 'fully_tracked')).toBeNull();
      expect(toggleNutritionAdherence('fasted', 'fasted')).toBeNull();
      expect(toggleNutritionAdherence('untracked', 'untracked')).toBeNull();
    });

    it('switches to different value when another option is selected', () => {
      expect(toggleNutritionAdherence('mostly_tracked', 'fasted')).toBe('fasted');
      expect(toggleNutritionAdherence('fasted', 'minimal')).toBe('minimal');
    });
  });
});
