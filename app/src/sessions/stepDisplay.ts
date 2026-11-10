import type { ExerciseRef, SessionStep } from './models';
import { EXERCISES_BY_ID } from '../workouts/exercises';

/** Convert identifier-style fallback text into a readable athlete-facing label. */
function formatSlug(slug: string): string {
    return slug
        .replace(/[-_]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/** The athlete-facing label for a step: its authored title, else the resolved exercise
 * name/free-text name, else the step id formatted nicely as a last resort. Single source of
 * truth so every display site (nav pills, panels, banners, swap picker) agrees on the same fallback order. */
export function stepName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef) return exerciseRefName(step.exerciseRef);
    return formatSlug(step.id);
}

/** The athlete-facing name of an exercise reference: the catalog name, else its id formatted
 * readably, else the free-text name exactly as the athlete typed it. */
export function exerciseRefName(ref: ExerciseRef): string {
    if (ref.kind === 'unresolved_free_text') return ref.name;
    return EXERCISES_BY_ID.get(ref.exerciseId)?.name ?? formatSlug(ref.exerciseId);
}

/** Stable identity key for comparing two exercise references. */
export function exerciseRefKey(ref: ExerciseRef): string {
    return ref.kind === 'catalog' ? `catalog:${ref.exerciseId}` : `free_text:${ref.name.trim().toLowerCase()}`;
}
