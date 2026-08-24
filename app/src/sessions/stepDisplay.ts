import type { SessionStep } from './models';

/** The athlete-facing label for a step: its authored title, else the resolved exercise
 * name/free-text name, else the step id as a last resort. Single source of truth so every
 * display site (nav pills, panels, banners, swap picker) agrees on the same fallback order. */
export function stepName(step: SessionStep): string {
    if (step.title) return step.title;
    if (step.exerciseRef?.kind === 'catalog') return step.exerciseRef.exerciseId;
    if (step.exerciseRef?.kind === 'unresolved_free_text') return step.exerciseRef.name;
    return step.id;
}
