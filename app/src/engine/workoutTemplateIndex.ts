import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES } from './templates';

/**
 * The canonical reverse identity index. A workout can intentionally be the
 * implementation for more than one engine template, so values are never
 * reduced to an arbitrary first match.
 */
export type WorkoutTemplateIndex = Readonly<Record<string, readonly string[]>>;

function buildWorkoutTemplateIndex(): WorkoutTemplateIndex {
    const byWorkoutId: Record<string, string[]> = Object.create(null) as Record<string, string[]>;

    for (const template of ENRICHED_TEMPLATES) {
        const workout = workoutForTemplate(template.id);
        if (!workout || workout.status !== 'active' || workout.manualOnly) continue;
        (byWorkoutId[workout.id] ??= []).push(template.id);
    }

    const immutableEntries = Object.entries(byWorkoutId).map(([workoutId, templateIds]) => [
        workoutId,
        Object.freeze(templateIds.slice()),
    ] as const);
    return Object.freeze(Object.fromEntries(immutableEntries)) as WorkoutTemplateIndex;
}

/** Built once from the canonical workout and engine-template catalogs. */
export const WORKOUT_TEMPLATE_INDEX = buildWorkoutTemplateIndex();

export function getTemplateIdsForWorkoutId(workoutId: string): readonly string[] {
    return WORKOUT_TEMPLATE_INDEX[workoutId] ?? [];
}

/** Returns an identity only when the canonical reverse mapping is unique. */
export function getUniqueTemplateIdForWorkoutId(workoutId: string): string | undefined {
    const templateIds = getTemplateIdsForWorkoutId(workoutId);
    return templateIds.length === 1 ? templateIds[0] : undefined;
}
