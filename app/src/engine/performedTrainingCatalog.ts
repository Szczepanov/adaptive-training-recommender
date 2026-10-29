import type { SessionCategory } from '../ledger/models';
import type { SessionExecution } from '../sessions/models';
import type { DailyRecommendation } from './models';
import type { PerformedTrainingCatalog } from './performedTrainingFacts';
import { classifyWorkoutStimulusFamily, TEMPLATE_STIMULUS_FAMILY } from './stimulusRecency';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { getTemplateIdsForWorkoutId, getUniqueTemplateIdForWorkoutId } from './workoutTemplateIndex';

/**
 * Reverse workout -> engine-template inference is only safe when exactly one template
 * resolves to that workout. Some catalog workouts intentionally serve multiple engine
 * templates (for example the full-body maintenance workout), so choosing the first match
 * would fabricate prescribed identity that the structured source never proved.
 */
export function templateIdForWorkoutId(workoutId: string): string | undefined {
    return getUniqueTemplateIdForWorkoutId(workoutId);
}

/** True only when this persisted recommendation owns the structured execution. Modern
 * records bind by prescription hash; the template fallback preserves pre-binding history. */
export function recommendationOwnsExecution(
    execution: SessionExecution,
    templateId: string | undefined,
    recommendation: DailyRecommendation | undefined,
): boolean {
    if (!recommendation) return false;
    const boundHash = recommendation.primarySession?.prescriptionHash;
    if (boundHash && execution.prescriptionHash) return boundHash === execution.prescriptionHash;
    return templateId !== undefined && templateId === recommendation.templateId;
}

export function categoryForWorkoutId(workoutId: string): SessionCategory | undefined {
    const templateIds = getTemplateIdsForWorkoutId(workoutId);
    if (templateIds.length === 0) return undefined;
    const categories = new Set(templateIds.map(templateId => ENRICHED_TEMPLATES_BY_ID.get(templateId)?.category));
    return categories.size === 1 ? ENRICHED_TEMPLATES_BY_ID.get(templateIds[0])?.category : undefined;
}

export const ENGINE_PERFORMED_TRAINING_CATALOG: PerformedTrainingCatalog = {
    templateIdForWorkoutId,
    templateCategory(templateId: string): SessionCategory | undefined {
        return ENRICHED_TEMPLATES_BY_ID.get(templateId)?.category;
    },
    categoryForWorkoutId,
    stimulusFamilyForWorkout(workoutId: string) {
        return classifyWorkoutStimulusFamily(workoutId);
    },
    stimulusFamilyForTemplate(templateId: string) {
        return TEMPLATE_STIMULUS_FAMILY[templateId];
    },
};
