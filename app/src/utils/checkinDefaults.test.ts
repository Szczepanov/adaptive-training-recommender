import { describe, expect, it } from 'vitest';
import { resolveDefaultTimeAvailable, resolveDefaultTimeAvailableMin } from './checkinDefaults';
import { isWeekendLocalDateString } from './localDate';

describe('isWeekendLocalDateString', () => {
  it('identifies Saturday and Sunday as weekends', () => {
    expect(isWeekendLocalDateString('2026-09-05')).toBe(true); // Saturday
    expect(isWeekendLocalDateString('2026-09-06')).toBe(true); // Sunday
  });

  it('identifies Monday through Friday as weekdays', () => {
    expect(isWeekendLocalDateString('2026-09-01')).toBe(false); // Tuesday
    expect(isWeekendLocalDateString('2026-09-02')).toBe(false); // Wednesday
    expect(isWeekendLocalDateString('2026-09-03')).toBe(false); // Thursday
    expect(isWeekendLocalDateString('2026-09-04')).toBe(false); // Friday
    expect(isWeekendLocalDateString('2026-09-07')).toBe(false); // Monday
  });
});

describe('resolveDefaultTimeAvailable', () => {
  const weekdayDate = '2026-09-04'; // Friday
  const weekendDate = '2026-09-05'; // Saturday

  it('falls back to the standard 45/60 minute defaults when preferences are unavailable', () => {
    expect(resolveDefaultTimeAvailable(null, weekdayDate)).toEqual({
      minutes: 45,
      dayType: 'weekday',
      source: 'standard_default',
    });
    expect(resolveDefaultTimeAvailable(undefined, weekendDate)).toEqual({
      minutes: 60,
      dayType: 'weekend',
      source: 'standard_default',
    });
  });

  it('uses the canonical Default Available Duration preference for the matching day type', () => {
    const preferences = {
      defaultWeekdayTimeMin: 35,
      defaultWeekendTimeMin: 105,
    };

    expect(resolveDefaultTimeAvailable(preferences, weekdayDate)).toEqual({
      minutes: 35,
      dayType: 'weekday',
      source: 'preferences',
    });
    expect(resolveDefaultTimeAvailable(preferences, weekendDate)).toEqual({
      minutes: 105,
      dayType: 'weekend',
      source: 'preferences',
    });
  });

  it('defensively falls back when an unvalidated preference duration is outside the stored contract', () => {
    const malformedPreferences = {
      defaultWeekdayTimeMin: 0,
      defaultWeekendTimeMin: 1441,
    };

    expect(resolveDefaultTimeAvailableMin(malformedPreferences, weekdayDate)).toBe(45);
    expect(resolveDefaultTimeAvailableMin(malformedPreferences, weekendDate)).toBe(60);
  });
});
