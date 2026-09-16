import type { SessionStep } from './models';
import { EXERCISES_BY_ID } from '../workouts/exercises';

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
    if (step.exerciseRef?.kind === 'catalog') {
        const found = EXERCISES_BY_ID.get(step.exerciseRef.exerciseId);
        if (found?.name) return found.name;
        return formatSlug(step.exerciseRef.exerciseId);
    }
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    return formatSlug(step.id);
}
