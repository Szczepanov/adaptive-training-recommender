/**
 * Gates authored `select_alternative` choice options against the athlete's *already
 * resolved* modality restrictions (ADR-0023 D-MCHOICE), reusing `resolveInjuryRestrictions`
 * -- the same computation `engine/adapters.ts` performs for the day's recommendation --
 * rather than inventing a new per-exercise judgment.
 *
 * Deliberately narrow. `ExerciseDefinition.contraindicationTags` (workouts/models.ts) and
 * the M3.5 `facets.safetyTags` heuristic labels have no live consumer anywhere in the
 * engine today (`engine/planningCandidate.ts` only surfaces `contraindicationTags` as
 * descriptive text for an external plan's candidate description) -- matching against them
 * here would look like a safety gate without being one. `restrictedModalities` is the one
 * signal that is both real (already resolved from active `InjuryConstraint[]`) and
 * expressible on a bare alternative (its resolved catalog exercise's `modality`). Category-
 * level restriction is not checked here: a single exercise carries no `SessionTemplate`
 * category, and the whole session already passed that gate once at M3.3's
 * `adjudicateAuthoredSession`.
 */
import type { SessionDefinition, SessionStep } from '../sessions/models';
import type { SessionTemplate } from './models';
import type { WorkoutModality } from '../workouts/models';
import { EXERCISES_BY_ID } from '../workouts/exercises';

/**
 * `resolveInjuryRestrictions` (engine/injuryPolicy.ts) works in the engine-level,
 * capitalized `SessionTemplate['modality']` vocabulary; the catalog's `ExerciseDefinition`
 * uses the separate lowercase `WorkoutModality` vocabulary. Both name the same real
 * modalities, so this is a vocabulary bridge, not a second judgment. `WorkoutModality`'s
 * `recovery`/`cross_training` intentionally have no `SessionTemplate['modality']` counterpart
 * they'd need to match here (a restricted modality is never `None`/absent), so they map to
 * `null` and simply never match a restriction.
 */
const WORKOUT_TO_TEMPLATE_MODALITY: Record<WorkoutModality, SessionTemplate['modality'] | null> = {
    cycling: 'Cycling',
    running: 'Running',
    swimming: 'Swimming',
    walking: 'Walking',
    strength: 'Strength',
    field: 'Field',
    mobility: 'Mobility',
    recovery: null,
    cross_training: 'Cross Training',
};

/**
 * Returns the `SessionOption.id` values that must not be offered as selectable, because
 * every action on that option resolves to a currently restricted modality. An option that
 * carries no `select_alternative` action, or whose alternative is unresolved free text or
 * not found in the catalog, is never flagged here.
 */
export function ineligibleAlternativeOptionIds(
    definition: SessionDefinition,
    restrictedModalities: readonly SessionTemplate['modality'][],
): Set<string> {
    const ineligible = new Set<string>();
    if (restrictedModalities.length === 0) return ineligible;
    const restricted = new Set(restrictedModalities);

    const stepsById = new Map<string, SessionStep>();
    for (const block of definition.blocks) {
        for (const step of block.steps) stepsById.set(step.id, step);
    }

    for (const block of definition.blocks) {
        for (const choice of block.optionSets ?? []) {
            for (const option of choice.options) {
                const isRestricted = option.actions.some(action => {
                    if (action.kind !== 'select_alternative') return false;
                    const step = stepsById.get(action.targetStepId);
                    const alternative = step?.alternatives?.find(candidate => candidate.id === action.alternativeId);
                    const exerciseRef = alternative?.exerciseRef;
                    if (!exerciseRef || exerciseRef.kind !== 'catalog') return false;
                    const exercise = EXERCISES_BY_ID.get(exerciseRef.exerciseId);
                    if (!exercise) return false;
                    const templateModality = WORKOUT_TO_TEMPLATE_MODALITY[exercise.modality];
                    return templateModality !== null && restricted.has(templateModality);
                });
                if (isRestricted) ineligible.add(option.id);
            }
        }
    }

    return ineligible;
}
