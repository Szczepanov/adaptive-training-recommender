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

describe('validatePreferences shadow mode opt-in', () => {
  it('keeps legacy preference documents without the field valid and disabled by absence', () => {
    const result = validatePreferences(validPreferences);

    expect(result.isValid).toBe(true);
    expect(result.data?.shadowModeEnabled).toBeUndefined();
  });

  it('preserves explicit true and false values', () => {
    expect(validatePreferences({ ...validPreferences, shadowModeEnabled: true }).data?.shadowModeEnabled).toBe(true);
    expect(validatePreferences({ ...validPreferences, shadowModeEnabled: false }).data?.shadowModeEnabled).toBe(false);
  });

  it('rejects non-boolean values instead of accidentally enabling shadow mode', () => {
    const result = validatePreferences({ ...validPreferences, shadowModeEnabled: 'true' });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      field: 'shadowModeEnabled',
      message: 'Shadow mode enabled must be a boolean',
    });
  });
});
