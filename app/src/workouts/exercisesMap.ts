import { EXERCISES, type ExerciseIdentity } from './exercises';

export const EXERCISES_MAP: Map<string, ExerciseIdentity> = new Map(
  EXERCISES.map(exercise => [exercise.id, exercise])
);
