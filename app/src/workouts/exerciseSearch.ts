import type { ExerciseDefinition } from './models';

/**
 * Other names athletes search by, keyed by catalog exercise id. Kept here rather than on the
 * catalog/`ExerciseDefinition` because it is search-only and must not touch the
 * decision-affecting catalog files (policy drift, ADR-0010).
 */
export const EXERCISE_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
    suitcase_carry: ['single-arm farmer carry', 'one-arm farmer carry', 'unilateral carry'],
};

/**
 * Case-insensitive catalog search used by the swap/add exercise dialog. Besides the name and id
 * it matches aliases (a suitcase carry is what athletes call a "single-arm farmer carry"),
 * movement patterns ("carry", "jump"), muscles, equipment and modality.
 */
export function matchesExerciseQuery(exercise: ExerciseDefinition, rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return true;
    const haystack = [
        exercise.name,
        exercise.id,
        exercise.modality,
        ...(EXERCISE_SEARCH_ALIASES[exercise.id] ?? []),
        ...exercise.movementPatterns.map(pattern => pattern.replaceAll('_', ' ')),
        ...exercise.primaryMuscles,
        ...(exercise.equipment ?? []),
    ];
    return haystack.some(text => text.toLowerCase().includes(query));
}
