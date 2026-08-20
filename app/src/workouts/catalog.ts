import type { WorkoutDefinition } from './models.ts';
import { CYCLING_BASE_WORKOUTS } from './catalog/cycling-base.ts';
import { CYCLING_QUALITY_WORKOUTS } from './catalog/cycling-quality.ts';
import { CYCLING_RACE_WORKOUTS } from './catalog/cycling-race.ts';
import { BUILD_SUPPORT_WORKOUTS } from './catalog/build-support.ts';
import { STRENGTH_WORKOUTS } from './catalog/strength.ts';
import { LOWER_BODY_STRENGTH_WORKOUTS } from './catalog/strength-lower.ts';
import { SUPPORT_STRENGTH_WORKOUTS } from './catalog/support-strength.ts';
import { TRAVEL_WORKOUTS } from './catalog/travel.ts';
import { FIELD_WORKOUTS } from './catalog/field.ts';
import { RECOVERY_WORKOUTS } from './catalog/recovery.ts';
import { TAPER_RACE_WORKOUTS } from './catalog/taper-race.ts';
import { FIELD_TECHNIQUE_WORKOUTS } from './catalog/field-technique.ts';
import { CYCLING_TECHNIQUE_WORKOUTS } from './catalog/cycling-technique.ts';
import { QUALITY_SUPPORT_WORKOUTS } from './catalog/quality-support.ts';

export const WORKOUTS: WorkoutDefinition[] = [
  ...CYCLING_BASE_WORKOUTS,
  ...CYCLING_QUALITY_WORKOUTS,
  ...CYCLING_RACE_WORKOUTS,
  ...BUILD_SUPPORT_WORKOUTS,
  ...STRENGTH_WORKOUTS,
  ...LOWER_BODY_STRENGTH_WORKOUTS,
  ...SUPPORT_STRENGTH_WORKOUTS,
  ...TRAVEL_WORKOUTS,
  ...FIELD_WORKOUTS,
  ...FIELD_TECHNIQUE_WORKOUTS,
  ...CYCLING_TECHNIQUE_WORKOUTS,
  ...QUALITY_SUPPORT_WORKOUTS,
  ...RECOVERY_WORKOUTS,
  ...TAPER_RACE_WORKOUTS
];
export const WORKOUTS_BY_ID = new Map(WORKOUTS.map(w => [w.id, w]));
