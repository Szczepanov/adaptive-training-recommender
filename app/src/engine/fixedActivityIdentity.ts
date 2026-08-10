import { WORKOUTS } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES } from './templates';
import type { FixedActivity, SessionTemplate } from './models';

/**
 * Phase 6.2c / ADR-0016 integration boundary.
 *
 * FixedActivity predates exact catalog identity. These optional fields are persisted when
 * a booked activity is intended to behave like a known authored workout for scoped
 * stimulus and weekly-role credit.
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
    /** False only for the legacy anonymous-stimulus compatibility case below. Such an
     * occurrence can contribute to an objective that is genuinely modality/category
     * agnostic, but its sentinel ids never map to event-plan coverage. */
    exactCatalogIdentity: boolean;
}

export function fixedActivityOccurrenceKey(activity: Pick<FixedActivity, 'id'>): string {
    return `fixed:${activity.id}`;
}

/**
 * Resolve a fixed activity for objective-credit bookkeeping.
 *
 * - Supplied template/workout ids must resolve exactly and consistently.
 * - A legacy activity with neither id gets an unlinked sentinel identity. This preserves
 *   backward-compatible credit for genuinely unscoped objectives (for example generic
 *   strength maintenance), while modality-scoped cycling objectives fail because the
 *   modality is `None`, and weekly coverage fails because the sentinel workout id is not
 *   in the authored catalog mapping.
 * - No title/category heuristic is ever used.
 */
export function resolveFixedActivityIdentity(activity: FixedActivity): ResolvedFixedActivityIdentity | null {
    const templateId = activity.templateId;
    const declaredWorkoutId = activity.workoutId;
    if (!templateId && !declaredWorkoutId) {
        return {
            occurrenceKey: fixedActivityOccurrenceKey(activity),
            templateId: activity.id,
            workoutId: `unlinked:${activity.id}`,
            modality: 'None',
            category: 'Rest',
            exactCatalogIdentity: false,
        };
    }

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
            exactCatalogIdentity: true,
        };
    }

    const workout = WORKOUTS.find(item => item.id === declaredWorkoutId && item.status === 'active' && !item.manualOnly);
    // Resolve back through the same priority-ordered mapping the template-first path
    // uses, so either persisted identifier shape reaches one canonical identity.
    const template = workout
        ? ENRICHED_TEMPLATES.find(candidate => workoutForTemplate(candidate.id)?.id === workout.id)
        : undefined;
    if (!workout || !template) return null;
    return {
        occurrenceKey: fixedActivityOccurrenceKey(activity),
        templateId: template.id,
        workoutId: workout.id,
        modality: template.modality,
        category: template.category,
        exactCatalogIdentity: true,
    };
}

/** Persistence accepts an identity field only when it is a real catalog link; the legacy
 * anonymous sentinel exists solely inside the engine and is never written. */
export function hasExactFixedActivityCatalogIdentity(activity: FixedActivity): boolean {
    return resolveFixedActivityIdentity(activity)?.exactCatalogIdentity === true;
}
