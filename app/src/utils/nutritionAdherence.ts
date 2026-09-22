import type { NutritionTrackingAdherence } from '../engine/models';

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
    badge: '100%',
    description: 'Logged all meals, snacks, and drinks accurately',
  },
  {
    value: 'mostly_tracked',
    label: 'Mostly Tracked',
    badge: '~75%',
    description: 'Logged main meals; missed small snacks, drinks, or dressings',
  },
  {
    value: 'minimal',
    label: 'Minimally Tracked',
    badge: '<50%',
    description: 'Logged only 1–2 items (e.g. breakfast only) and stopped',
  },
  {
    value: 'untracked',
    label: 'Untracked',
    badge: '0%',
    description: 'Did not log food yesterday / took a day off',
  },
  {
    value: 'fasted',
    label: 'Fasted (0 kcal)',
    badge: 'Fast',
    description: 'Deliberate water or intermittent fast all day; intentional 0 kcal',
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
