export { WORKOUTS } from './catalog.ts';
export { EXERCISES } from './exercises.ts';
export {
  SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
  validateEventPlanCoverage
} from './event-plan.ts';
export { toLegacySessionTemplate } from './compatibility.ts';
export { validateWorkoutLibrary } from './validation.ts';
export type {
  Equipment,
  ExerciseDefinition,
  IntensityTarget,
  LoadLevel,
  StepDuration,
  TrainingObjective,
  WorkoutBlock,
  WorkoutCategory,
  WorkoutDefinition,
  WorkoutModality,
  WorkoutParameter,
  WorkoutParameterUnit,
  WorkoutPrescription,
  WorkoutStep,
  WorkoutVariant
} from './models.ts';
export type {
  EventPlanCoverageKey,
  EventPlanPhase,
  EventPlanRequirement,
  EventPlanSessionCoverage
} from './event-plan.ts';
