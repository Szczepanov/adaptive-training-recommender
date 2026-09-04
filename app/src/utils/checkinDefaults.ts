import type { UserPreferences } from '../engine/models';
import { isWeekendLocalDateString } from './localDate';

export type TimeAvailabilityPreferences = Pick<
  UserPreferences,
  'defaultWeekdayTimeMin' | 'defaultWeekendTimeMin'
>;

export type CheckinAvailabilityDefault = {
  minutes: number;
  dayType: 'weekday' | 'weekend';
  source: 'preferences' | 'standard_default';
};

const STANDARD_WEEKDAY_MINUTES = 45;
const STANDARD_WEEKEND_MINUTES = 60;

function isValidPreferenceDuration(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 1440;
}

/**
 * Resolve the initial daily-check-in availability for a brand-new check-in.
 *
 * `UserPreferences.default*TimeMin` is the canonical user-facing "Default Available
 * Duration" setting. TrainingSettings' weekday/weekend max-minute fields are hard
 * session limits and are intentionally not substituted here: a feasibility cap is not
 * the same concept as how much time the athlete says is available today.
 *
 * Persisted check-ins are authoritative and must not be passed back through this resolver;
 * callers should only use this result when constructing a new daily check-in.
 */
export function resolveDefaultTimeAvailable(
  preferences: TimeAvailabilityPreferences | null | undefined,
  dateStr: string,
): CheckinAvailabilityDefault {
  const dayType = isWeekendLocalDateString(dateStr) ? 'weekend' : 'weekday';
  const preferredMinutes = dayType === 'weekend'
    ? preferences?.defaultWeekendTimeMin
    : preferences?.defaultWeekdayTimeMin;

  if (isValidPreferenceDuration(preferredMinutes)) {
    return { minutes: preferredMinutes, dayType, source: 'preferences' };
  }

  return {
    minutes: dayType === 'weekend' ? STANDARD_WEEKEND_MINUTES : STANDARD_WEEKDAY_MINUTES,
    dayType,
    source: 'standard_default',
  };
}

/** Numeric compatibility helper for callers/tests that only need the resolved minutes. */
export function resolveDefaultTimeAvailableMin(
  preferences: TimeAvailabilityPreferences | null | undefined,
  dateStr: string,
): number {
  return resolveDefaultTimeAvailable(preferences, dateStr).minutes;
}
