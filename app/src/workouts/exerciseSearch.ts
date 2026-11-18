import type { ExerciseDefinition } from './models';

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
        ...(exercise.aliases ?? []),
        ...exercise.movementPatterns.map(pattern => pattern.replaceAll('_', ' ')),
        ...exercise.primaryMuscles,
        ...(exercise.equipment ?? []),
    ];
    return haystack.some(text => text.toLowerCase().includes(query));
}
