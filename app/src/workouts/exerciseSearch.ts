import type { ExerciseDefinition } from './models';

/**
 * Other names athletes search by, keyed by catalog exercise id. Kept here rather than on the
 * catalog/`ExerciseDefinition` because it is search-only and must not touch the
 * decision-affecting catalog files (policy drift, ADR-0010).
 */
export const EXERCISE_SEARCH_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
    ['suitcase_carry', ['single-arm farmer carry', 'one-arm farmer carry', 'unilateral carry']],
]);

/**
 * Case-insensitive catalog search used by the swap/add exercise dialog. Besides the name and id
 * it matches aliases (a suitcase carry is what athletes call a "single-arm farmer carry"),
 * movement patterns ("carry", "jump"), muscles, equipment and modality.
 */
/** Lower-case with hyphens/underscores read as spaces, so "single arm" finds "single-arm". */
function normalize(text: string): string {
    return text.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchesExerciseQuery(exercise: ExerciseDefinition, rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return true;
    const normalizedQuery = normalize(query);
    const haystack = [
        exercise.name,
        exercise.id,
        exercise.modality,
        ...(EXERCISE_SEARCH_ALIASES.get(exercise.id) ?? []),
        ...exercise.movementPatterns,
        ...exercise.primaryMuscles,
        ...(exercise.equipment ?? []),
    ];
    // A query of only separators ("--") normalizes to '', which every string contains.
    return haystack.some(text => text.toLowerCase().includes(query)
        || (normalizedQuery.length > 0 && normalize(text).includes(normalizedQuery)));
}
