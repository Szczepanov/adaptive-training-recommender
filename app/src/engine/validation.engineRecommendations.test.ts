import { describe, expect, it } from 'vitest';
import { validatePreferences } from './validation';

const validPreferences = {
  userId: 'u1',
  preferredRecoveryStyle: 'mixed',
  defaultWeekdayTimeMin: 45,
  defaultWeekendTimeMin: 60,
  preferredTimeOfDay: 'flexible',
  preferredModalities: [],
  avoidedModalities: [],
  explanationVerbosity: 'detailed',
  conservativeBias: false,
  preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
};

describe('validatePreferences engine recommendations setting (#1167 P2-1)', () => {
  it('keeps documents without the field valid and leaves it unset, so the P2-8 default applies', () => {
    const result = validatePreferences(validPreferences);

    expect(result.isValid).toBe(true);
    expect(result.data).not.toHaveProperty('engineRecommendationsEnabled');
  });

  it('preserves explicit true and false values', () => {
    expect(validatePreferences({ ...validPreferences, engineRecommendationsEnabled: true }).data?.engineRecommendationsEnabled).toBe(true);
    expect(validatePreferences({ ...validPreferences, engineRecommendationsEnabled: false }).data?.engineRecommendationsEnabled).toBe(false);
  });

  it('rejects non-boolean values instead of silently picking a mode', () => {
    const result = validatePreferences({ ...validPreferences, engineRecommendationsEnabled: 'false' });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      field: 'engineRecommendationsEnabled',
      message: 'Engine recommendations enabled must be a boolean',
    });
  });
});
