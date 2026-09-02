/**
 * Boundary service for reading and hydrating canonical performed training facts from Firestore.
 *
 * Isolated outside app/src/engine so the recommendation engine and adjudication layer
 * remain strictly free of static I/O and Firebase imports.
 */
import type { SessionTemplate, NormalizedGarminActivity } from '../engine/models';
import type { CoverageSetDescriptor } from '../workouts/event-plan';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import {
    isProviderActivityRef,
    isStructuredExecutionRef,
} from './models';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { activityService } from '../services/activityService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { getPreviousLocalDateString } from '../utils/localDate';
import {
    deriveFactsFromOccurrence,
    categoryForWorkoutId,
    templateIdForWorkoutId,
    normalizeModality,
    type PerformedExposureFact,
    type CoverageCreditFact,
    type PerformedTrainingFactsSnapshot,
    type HydratedOccurrenceContext,
} from '../engine/performedTrainingFacts';

export interface GetPerformedTrainingFactsOptions {
    coverageSetDescriptor?: CoverageSetDescriptor;
    preloadedActivities?: readonly NormalizedGarminActivity[];
}

/**
 * Range query returning canonical recommendation facts.
 * Range convention: `fromDateInclusive` <= localDate < `toDateExclusive`.
 */
export async function getPerformedTrainingFactsInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
    options: GetPerformedTrainingFactsOptions = {},
): Promise<PerformedTrainingFactsSnapshot> {
    const toDateInclusive = getPreviousLocalDateString(toDateExclusive);
    if (toDateInclusive < fromDateInclusive) {
        return {
            asOfDate: toDateExclusive,
            windowDays: 0,
            revision: `canonical-facts-v1:${fromDateInclusive}:${toDateExclusive}:empty`,
            exposures: [],
            coverageCredits: [],
        };
    }

    const activeOccurrences = await repository.queryActiveInDateWindow(userId, fromDateInclusive, toDateInclusive);

    let activitiesById: Map<string, NormalizedGarminActivity>;
    if (options.preloadedActivities) {
        activitiesById = new Map(options.preloadedActivities.map(a => [a.activityId, a]));
    } else {
        const activitiesState = await activityService.getActivitiesInRange(userId, fromDateInclusive, toDateExclusive);
        const activities = activitiesState.status === 'AVAILABLE' ? activitiesState.data : [];
        activitiesById = new Map(activities.map(a => [a.activityId, a]));
    }

    const descriptor = options.coverageSetDescriptor ?? EVERGREEN_GENERAL_COVERAGE_SET;
    const exposures: PerformedExposureFact[] = [];
    const coverageCredits: CoverageCreditFact[] = [];

    for (const occurrence of activeOccurrences) {
        const structuredRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
        const garminRef = occurrence.sourceRefs
            .filter(isProviderActivityRef)
            .find(ref => ref.provider.toLowerCase() === 'garmin');

        const hydrated: HydratedOccurrenceContext = {};

        if (structuredRef) {
            const execState = await sessionExecutionService.getExecution(userId, structuredRef.executionId);
            if (execState.status === 'AVAILABLE') {
                const execution = execState.data;
                let workoutId: string | undefined;
                let templateId: string | undefined;
                let category: SessionTemplate['category'] | undefined;
                let isLegacyStrength = false;

                if (execution.sessionSource.kind === 'catalog') {
                    if (execution.sessionSource.workoutId === 'legacy_strength') {
                        isLegacyStrength = true;
                    } else {
                        workoutId = execution.sessionSource.workoutId;
                        templateId = templateIdForWorkoutId(workoutId);
                        category = categoryForWorkoutId(workoutId);
                    }
                } else if (execution.sessionSource.kind === 'manual' && execution.sessionSource.definitionId === 'legacy_strength') {
                    isLegacyStrength = true;
                }

                let executionModality: SessionTemplate['modality'] | undefined;
                if (workoutId) {
                    const workout = WORKOUTS_BY_ID.get(workoutId);
                    if (workout?.modality) {
                        const m = normalizeModality(workout.modality);
                        if (m !== 'Unknown') executionModality = m;
                    }
                }

                const defState = await resolveSessionDefinition(userId, execution.sessionSource, execution.prescriptionHash);
                if (defState.status === 'AVAILABLE') {
                    const def = defState.data;
                    if (!executionModality && def.dominantModality) {
                        const m = normalizeModality(def.dominantModality);
                        if (m !== 'Unknown') executionModality = m;
                    }
                }

                if (!executionModality && isLegacyStrength) {
                    executionModality = 'Strength';
                }

                const durationMin = execution.completedAt && execution.startedAt
                    ? Math.max(0, Math.round((Date.parse(execution.completedAt) - Date.parse(execution.startedAt)) / 60000))
                    : undefined;

                hydrated.structured = {
                    executionId: execution.executionId,
                    ...(workoutId ? { workoutId } : {}),
                    ...(templateId ? { templateId } : {}),
                    ...(executionModality ? { modality: executionModality } : {}),
                    ...(category ? { category } : {}),
                    startedAt: execution.startedAt,
                    ...(execution.completedAt ? { endedAt: execution.completedAt } : {}),
                    ...(durationMin !== undefined ? { durationMin } : {}),
                    isLegacyStrength,
                };
            }
        }

        if (garminRef) {
            const garminActivity = activitiesById.get(garminRef.activityId);
            const providerModality = garminActivity ? normalizeModality(garminActivity.type) : undefined;
            const duration = garminActivity?.durationMin;
            hydrated.provider = {
                activityId: garminRef.activityId,
                provider: garminRef.provider,
                ...(providerModality ? { modality: providerModality } : {}),
                ...(garminActivity?.startedAt ? { startedAt: garminActivity.startedAt } : {}),
                ...(garminActivity?.endedAt ? { endedAt: garminActivity.endedAt } : {}),
                ...(duration !== null && duration !== undefined ? { durationMin: duration } : {}),
                ...(garminActivity ? { garminActivity } : {}),
            };
        }

        const facts = deriveFactsFromOccurrence(occurrence, hydrated, descriptor);
        exposures.push(facts.exposure);
        coverageCredits.push(...facts.coverageCredits);
    }

    exposures.sort((a, b) => a.localDate.localeCompare(b.localDate));

    const occurrenceRevision = activeOccurrences
        .map(o => `${o.performedOccurrenceId}:${o.updatedAt}`)
        .sort()
        .join('|');
    const revision = `canonical-facts-v1:${fromDateInclusive}:${toDateExclusive}:${occurrenceRevision}`;

    return {
        asOfDate: toDateExclusive,
        windowDays: Math.max(1, Math.round((Date.parse(toDateExclusive) - Date.parse(fromDateInclusive)) / 86400000)),
        revision,
        exposures,
        coverageCredits,
    };
}
