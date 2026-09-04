import type { TrainingSettings } from '../engine/models';
import { isWeekendLocalDateString } from './localDate';

/**
 * Resolves the initial prefilled timeAvailableMin for daily check-in.
 * Prefers the athlete's configured settings if present, otherwise defaults
 * to 45 minutes on weekdays and 60 minutes on weekends.
 */
export function resolveDefaultTimeAvailableMin(
  settings: TrainingSettings | null | undefined,
  dateStr: string
): number {
  const isWeekend = isWeekendLocalDateString(dateStr);
  if (isWeekend) {
    return typeof settings?.defaults?.weekendMaxMinutes === 'number' && settings.defaults.weekendMaxMinutes > 0
      ? settings.defaults.weekendMaxMinutes
      : 60;
  }
  return typeof settings?.defaults?.weekdayMaxMinutes === 'number' && settings.defaults.weekdayMaxMinutes > 0
    ? settings.defaults.weekdayMaxMinutes
    : 45;
}
