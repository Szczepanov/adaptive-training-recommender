import type { ExerciseDefinition } from './models.ts';
import { EXERCISES as BASE_EXERCISES } from './exercises-base.ts';
import { EXERCISE_FACET_OVERRIDES, EXPANDED_EXERCISES } from './exercise-catalog-extensions.ts';

function normalizeExpandedExercise(exercise: ExerciseDefinition): ExerciseDefinition {
  if (!exercise.facets?.fieldDomains || exercise.facets.fieldDomains.length > 0) return exercise;
  const facets = { ...exercise.facets };
  delete facets.fieldDomains;
  return { ...exercise, facets };
}

/**
 * Canonical exercise catalog.
 *
 * Keep the established exercise identities stable, enrich them with reviewed multidomain
 * facets, and append the newer facet-first definitions. Session dose/load/effort stays in
 * the session prescription instead of being encoded into increasingly specific exercise IDs.
 */
export const EXERCISES: ExerciseDefinition[] = [
  ...BASE_EXERCISES.map(exercise => {
    const reviewedFacets = EXERCISE_FACET_OVERRIDES[exercise.id];
    return reviewedFacets ? { ...exercise, facets: reviewedFacets } : exercise;
  }),
  ...EXPANDED_EXERCISES.map(normalizeExpandedExercise),
];
