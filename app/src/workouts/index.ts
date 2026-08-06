export { WORKOUTS } from './catalog.ts';
export { EXERCISES } from './exercises.ts';
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
  WorkoutPrescription,
  WorkoutStep,
  WorkoutVariant
} from './models.ts';
