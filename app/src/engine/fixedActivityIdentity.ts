import { WORKOUTS } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES } from './templates';
import type { FixedActivity, SessionTemplate } from './models';

/**
 * Phase 6.2c / ADR-0016 integration boundary.
 *
 * FixedActivity predates exact catalog identity. These optional fields are persisted only
 * when a booked activity is intended to behave like a known authored workout for stimulus
 * and weekly-role credit. The declaration merge keeps the legacy model source-compatible
 * while the persistence/parser/rules paths are upgraded in this PR.
 */
declare module './models' {
    interface FixedActivity {
        /** Exact coarse engine template that the booked activity represents. */
        templateId?: string;
        /** Exact detailed workout identity. When both ids exist they must resolve to the
         * same prescription; otherwise identity fails closed. */
        workoutId?: string;
    }
}

export interface ResolvedFixedActivityIdentity {
    occurrenceKey: string;
    templateId: string;
    workoutId: string;
    modality: SessionTemplate['modality'];
    category: SessionTemplate['category'];
}

export function fixedActivityOccurrenceKey(activity: Pick<FixedActivity, 'id'>): string {
    return `fixed:${activity.id}`;
}

/**
 * Exact identity only. No title/category/modality inference is allowed here: without a
 * valid catalog link a fixed activity may still reserve time/cost, but its expected
 * stimulus cannot discharge an adaptation objective or a weekly coverage role.
 */
export function resolveFixedActivityIdentity(activity: FixedActivity): ResolvedFixedActivityIdentity | null {
    const templateId = activity.templateId;
    const declaredWorkoutId = activity.workoutId;
    if (!templateId && !declaredWorkoutId) return null;

    if (templateId) {
        const template = ENRICHED_TEMPLATES.find(item => item.id === templateId);
        const resolvedWorkout = workoutForTemplate(templateId);
        if (!template || !resolvedWorkout) return null;
        if (declaredWorkoutId && declaredWorkoutId !== resolvedWorkout.id) return null;
        return {
            occurrenceKey: fixedActivityOccurrenceKey(activity),
            templateId,
            workoutId: resolvedWorkout.id,
            modality: template.modality,
            category: template.category,
        };
    }

    const workout = WORKOUTS.find(item => item.id === declaredWorkoutId && item.status === 'active');
    const templateIdFromWorkout = workout?.engineTemplateIds?.[0];
    const template = templateIdFromWorkout
        ? ENRICHED_TEMPLATES.find(item => item.id === templateIdFromWorkout)
        : undefined;
    if (!workout || !template) return null;
    return {
        occurrenceKey: fixedActivityOccurrenceKey(activity),
        templateId: template.id,
        workoutId: workout.id,
        modality: template.modality,
        category: template.category,
    };
}
