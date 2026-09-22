import type { NutritionTrackingAdherence } from '../engine/models';
import { addDaysToLocalDateString } from './localDate';

export interface NutritionAdherenceOption {
  value: NutritionTrackingAdherence;
  label: string;
  badge: string;
  description: string;
}

export const NUTRITION_ADHERENCE_OPTIONS: readonly NutritionAdherenceOption[] = [
  {
    value: 'fully_tracked',
    label: 'Fully Tracked',
    badge: 'All',
    description: 'Logged all meals, snacks, caloric drinks, and cooking extras you intended to track',
  },
  {
    value: 'mostly_tracked',
    label: 'Mostly Tracked',
    badge: 'Most',
    description: 'Logged the main meals but missed some small items or had uncertain portions',
  },
  {
    value: 'minimal',
    label: 'Minimally Tracked',
    badge: 'Few',
    description: 'Logged only a small part of the day before stopping',
  },
  {
    value: 'untracked',
    label: 'Untracked',
    badge: 'None',
    description: 'Did not meaningfully log food yesterday',
  },
  {
    value: 'fasted',
    label: 'Full-Day Fast (0 kcal)',
    badge: '0 kcal',
    description: 'Deliberate full-day fast with no caloric intake',
  },
];

/**
 * Resolves the next adherence value when an option is selected.
 * Clicking the already active option toggles it off (returns null).
 */
export function toggleNutritionAdherence(
  current: NutritionTrackingAdherence | null | undefined,
  selected: NutritionTrackingAdherence,
): NutritionTrackingAdherence | null {
  return current === selected ? null : selected;
}


/**
 * Daily check-in D records adherence for D-1. A nutrition display window [start, end]
 * therefore needs check-ins [start+1, end+2) so the final displayed day can read D+1.
 */
export function getNutritionAdherenceCheckinRange(
  startDateInclusive: string,
  endDateInclusive: string,
): { startDateInclusive: string; endDateExclusive: string } {
  return {
    startDateInclusive: addDaysToLocalDateString(startDateInclusive, 1),
    endDateExclusive: addDaysToLocalDateString(endDateInclusive, 2),
  };
}
