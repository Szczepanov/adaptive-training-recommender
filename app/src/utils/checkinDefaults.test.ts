import { describe, it, expect } from 'vitest';
import { resolveDefaultTimeAvailableMin } from './checkinDefaults';
import { isWeekendLocalDateString } from './localDate';
import type { TrainingSettings } from '../engine/models';

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

describe('resolveDefaultTimeAvailableMin', () => {
  const weekdayDate = '2026-09-04'; // Friday
  const weekendDate = '2026-09-05'; // Saturday

  it('falls back to 45 min on weekdays and 60 min on weekends when settings are null or undefined', () => {
    expect(resolveDefaultTimeAvailableMin(null, weekdayDate)).toBe(45);
    expect(resolveDefaultTimeAvailableMin(null, weekendDate)).toBe(60);
    expect(resolveDefaultTimeAvailableMin(undefined, weekdayDate)).toBe(45);
    expect(resolveDefaultTimeAvailableMin(undefined, weekendDate)).toBe(60);
  });

  it('falls back to 45 min on weekdays and 60 min on weekends when settings defaults are null', () => {
    const emptySettings = {
      defaults: {
        weekdayMaxMinutes: null,
        weekendMaxMinutes: null,
      },
    } as unknown as TrainingSettings;

    expect(resolveDefaultTimeAvailableMin(emptySettings, weekdayDate)).toBe(45);
    expect(resolveDefaultTimeAvailableMin(emptySettings, weekendDate)).toBe(60);
  });

  it('uses configured weekdayMaxMinutes on weekdays', () => {
    const customSettings = {
      defaults: {
        weekdayMaxMinutes: 30,
        weekendMaxMinutes: 90,
      },
    } as unknown as TrainingSettings;

    expect(resolveDefaultTimeAvailableMin(customSettings, weekdayDate)).toBe(30);
  });

  it('uses configured weekendMaxMinutes on weekends', () => {
    const customSettings = {
      defaults: {
        weekdayMaxMinutes: 30,
        weekendMaxMinutes: 90,
      },
    } as unknown as TrainingSettings;

    expect(resolveDefaultTimeAvailableMin(customSettings, weekendDate)).toBe(90);
  });

  it('uses default when specific day preference is null but the other is set', () => {
    const partialSettings = {
      defaults: {
        weekdayMaxMinutes: 75,
        weekendMaxMinutes: null,
      },
    } as unknown as TrainingSettings;

    expect(resolveDefaultTimeAvailableMin(partialSettings, weekdayDate)).toBe(75);
    expect(resolveDefaultTimeAvailableMin(partialSettings, weekendDate)).toBe(60);
  });
});
