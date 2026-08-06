import type { WorkoutDefinition } from './models.ts';
import { CYCLING_BASE_WORKOUTS } from './catalog/cycling-base.ts';
import { CYCLING_QUALITY_WORKOUTS } from './catalog/cycling-quality.ts';
import { CYCLING_RACE_WORKOUTS } from './catalog/cycling-race.ts';
import { STRENGTH_WORKOUTS } from './catalog/strength.ts';
import { FIELD_WORKOUTS } from './catalog/field.ts';
import { RECOVERY_WORKOUTS } from './catalog/recovery.ts';

export const WORKOUTS: WorkoutDefinition[] = [
  ...CYCLING_BASE_WORKOUTS,
  ...CYCLING_QUALITY_WORKOUTS,
  ...CYCLING_RACE_WORKOUTS,
  ...STRENGTH_WORKOUTS,
  ...FIELD_WORKOUTS,
  ...RECOVERY_WORKOUTS
];
