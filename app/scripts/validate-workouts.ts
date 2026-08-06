import { WORKOUTS } from '../src/workouts/catalog.ts';
import { EXERCISES } from '../src/workouts/exercises.ts';
import { validateWorkoutLibrary } from '../src/workouts/validation.ts';

const result = validateWorkoutLibrary(EXERCISES, WORKOUTS);

for (const warning of result.warnings) {
  console.warn(`workout-library warning: ${warning}`);
}

if (!result.valid) {
  for (const error of result.errors) {
    console.error(`workout-library error: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${EXERCISES.length} exercises and ${WORKOUTS.length} workouts.`);
}
