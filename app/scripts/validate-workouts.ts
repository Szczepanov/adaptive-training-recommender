import { WORKOUTS } from '../src/workouts/catalog.ts';
import { EXERCISES } from '../src/workouts/exercises.ts';
import { COVERAGE_SETS, validatePlanCoverage } from '../src/workouts/event-plan.ts';
import { WORKOUT_PARAMETER_BINDINGS } from '../src/workouts/parameter-bindings.ts';
import { validateWorkoutLibrary } from '../src/workouts/validation.ts';

const result = validateWorkoutLibrary(
  EXERCISES,
  WORKOUTS,
  WORKOUT_PARAMETER_BINDINGS
);
const coverageErrors = Object.values(COVERAGE_SETS).flatMap(descriptor => validatePlanCoverage(WORKOUTS, descriptor));

for (const warning of result.warnings) {
  console.warn(`workout-library warning: ${warning}`);
}

for (const error of [...result.errors, ...coverageErrors]) {
  console.error(`workout-library error: ${error}`);
}

if (!result.valid || coverageErrors.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${EXERCISES.length} exercises, ${WORKOUTS.length} workouts, ` +
    `${WORKOUT_PARAMETER_BINDINGS.length} parameter binding sets, and ` +
    `${Object.values(COVERAGE_SETS).reduce((total, descriptor) => total + descriptor.coverage.length, 0)} authored session families.`
  );
}
