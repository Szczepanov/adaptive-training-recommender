import type { SessionStep } from './models';
import { EXERCISES_BY_ID } from '../workouts/exercises';

/**
 * Whether the athlete can log an external mass for this step. True when the step prescribes a
 * mass, when its catalog exercise allows a mass load (farmer carry, sled push), or when the
 * exercise is free text and its capability is unknown. Bodyweight/unloaded prescriptions and
 * catalog drills that never take a mass (sprints) keep the field hidden.
 */
export function stepAcceptsMassLoad(step: SessionStep): boolean {
    if (step.load?.kind === 'mass' || step.load?.kind === 'relative_step') return true;
    if (step.load?.kind === 'bodyweight' || step.load?.kind === 'unloaded') return false;
    if (step.exerciseRef?.kind !== 'catalog') return true;
    const exercise = EXERCISES_BY_ID.get(step.exerciseRef.exerciseId);
    if (!exercise?.facets) return true;
    return exercise.facets.allowedLoadKinds.includes('mass');
}
