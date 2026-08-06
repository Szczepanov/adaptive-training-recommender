import type { WorkoutStep } from '../models.ts';

export const timeStep = (
  id: string,
  exerciseId: string,
  name: string,
  seconds: number,
  options: Omit<WorkoutStep, 'id' | 'exerciseId' | 'name' | 'duration'> = {}
): WorkoutStep => ({ id, exerciseId, name, duration: { type: 'time', seconds }, ...options });

export const repsStep = (
  id: string,
  exerciseId: string,
  name: string,
  repetitions: number,
  options: Omit<WorkoutStep, 'id' | 'exerciseId' | 'name' | 'duration'> = {}
): WorkoutStep => ({ id, exerciseId, name, duration: { type: 'repetitions', repetitions }, ...options });
