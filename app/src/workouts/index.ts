import { WORKOUTS as _WORKOUTS } from './catalog.ts';

export const WORKOUTS = _WORKOUTS;
export const WORKOUTS_BY_ID = new Map(WORKOUTS.map(w => [w.id, w]));

export { EXERCISES } from './exercises.ts';
export {
  SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE,
  validateEventPlanCoverage
} from './event-plan.ts';
export { WORKOUT_PARAMETER_BINDINGS } from './parameter-bindings.ts';
export { validateWorkoutLibrary } from './validation.ts';
export { getPrescriptionLegend, resolveWorkoutPrescription } from './prescription.ts';
export type {
  Equipment,
  ExerciseDefinition,
  IntensityTarget,
  LoadLevel,
  TechnicalRequirements,
  StepDuration,
  TrainingObjective,
  WorkoutBlock,
  WorkoutCategory,
  WorkoutDefinition,
  WorkoutDurationRange,
  WorkoutModality,
  WorkoutParameter,
  WorkoutParameterBinding,
  WorkoutParameterBindingSet,
  WorkoutParameterResolver,
  WorkoutParameterResolverBinding,
  WorkoutParameterStepField,
  WorkoutParameterStepFieldBinding,
  WorkoutParameterTransform,
  WorkoutParameterUnit,
  WorkoutParameterZeroBehavior,
  WorkoutEnvironment,
  AthletePerformanceProfile,
  PrescriptionBlock,
  PrescriptionStep,
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
