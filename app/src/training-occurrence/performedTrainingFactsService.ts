/**
 * Boundary service for reading and hydrating canonical performed training facts from Firestore.
 *
 * Isolated outside app/src/engine so the recommendation engine and adjudication layer
 * remain strictly free of static I/O and Firebase imports.
 */
import type { ActivityOverride, SessionTemplate, NormalizedGarminActivity, DailyRecommendation } from '../engine/models';
import type { SessionExecution } from '../sessions/models';
import type { CoverageSetDescriptor } from '../workouts/event-plan';
import type { WorkoutVariant } from '../workouts/models';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { isStructuredExecutionRef } from './models';
import { hydrateOccurrenceSourcesInRange } from './occurrenceSourcesHydration';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { recommendationService } from '../services/recommendationService';
import { activityOverrideService } from '../services/activityOverrideService';
import { computeContentHash } from '../engine/externalPlanHash';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { addDaysToLocalDateString, getPreviousLocalDateString } from '../utils/localDate';
import {
    deriveFactsFromOccurrence,
    categoryForWorkoutId,
    templateIdForWorkoutId,
    normalizeModality,
    recommendationOwnsExecution,
    type PerformedExposureFact,
    type CoverageCreditFact,
    type PerformedTrainingFactsSnapshot,
    type HydratedOccurrenceContext,
} from '../engine/performedTrainingFacts';

export interface GetPerformedTrainingFactsOptions {
    coverageSetDescriptor?: CoverageSetDescriptor;
    preloadedActivities?: readonly NormalizedGarminActivity[];
    /** Export-only provenance. Keep default decision snapshots and hashes unchanged. */
    includeDisplayProvenance?: boolean;
    activityOverrides?: Readonly<Record<string, ActivityOverride>> | ReadonlyMap<string, ActivityOverride>;
}

/**
 * A structured execution carries no dose/readiness field of its own, so the modify-tier
 * marker is recovered from the persisted daily recommendation it executed: a modify-tier
 * day whose recommendation applied a tier-1 easier dose variation -- the same condition
 * under which the optimizer marks `isReadinessModifiedDose` on the candidate. The execution
 * must be that recommendation's primary session (bound prescription hash, or the template
 * for records written before session bindings existed); any other structured session on
 * that date keeps full credit.
 */
function isReadinessModifiedExecution(
    execution: SessionExecution,
    templateId: string | undefined,
    recommendation: DailyRecommendation | undefined,
): boolean {
    if (!recommendation || recommendation.mode !== 'modify') return false;
    const adjustment = recommendation.adjustment;
    if (!adjustment || adjustment.direction !== 'easier' || adjustment.tier !== 1) return false;
    return recommendationOwnsExecution(execution, templateId, recommendation);
}

/** Recover the exact catalog variant from the persisted recommendation that owns the
 * execution. Power coverage needs this stricter fact because `return_to_training` may
 * remove (or intentionally underdose) the power content even when the workout id is the
 * same. Unknown ownership/legacy records fail closed later instead of guessing `full`. */
function workoutVariantForExecution(
    execution: SessionExecution,
    templateId: string | undefined,
    recommendation: DailyRecommendation | undefined,
): WorkoutVariant['id'] | undefined {
    if (!recommendationOwnsExecution(execution, templateId, recommendation)) return undefined;
    const prescription = recommendation?.prescription;
    if (!prescription || execution.sessionSource.kind !== 'catalog') return undefined;
    return prescription.workoutId === execution.sessionSource.workoutId ? prescription.variantId : undefined;
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
    const descriptor = options.coverageSetDescriptor ?? EVERGREEN_GENERAL_COVERAGE_SET;
    const toDateInclusive = getPreviousLocalDateString(toDateExclusive);
    if (toDateInclusive < fromDateInclusive) {
        return {
            asOfDate: toDateExclusive,
            windowDays: 0,
            revision: `canonical-facts-v1:${descriptor.id}:${fromDateInclusive}:${toDateExclusive}:empty`,
            exposures: [],
            coverageCredits: [],
        };
    }

    let overrides = options.activityOverrides;
    let overridesDegraded = false;
    if (!overrides) {
        try {
            const overridesState = await activityOverrideService.getOverridesSinceState(userId, fromDateInclusive);
            if (overridesState.status === 'AVAILABLE') {
                overrides = overridesState.data;
            } else {
                overridesDegraded = true;
            }
        } catch {
            overridesDegraded = true;
            overrides = undefined;
        }
    }

    const sourceHydration = await hydrateOccurrenceSourcesInRange(userId, fromDateInclusive, toDateExclusive, {
        preloadedActivities: options.preloadedActivities,
        activityOverrides: overrides,
    });
    const activeOccurrences = sourceHydration.rows.map(row => row.occurrence);
    const activitiesById = new Map(sourceHydration.activities.map(activity => [activity.activityId, activity]));

    // Only structured executions need the recommendation lookup. An unavailable read
    // degrades to no readiness marker rather than failing the whole facts snapshot.
    const recommendationsByDate = new Map<string, DailyRecommendation>();
    let recommendationRevision: string | null = null;
    if (activeOccurrences.some(o => o.sourceRefs.some(isStructuredExecutionRef))) {
        const recommendationsState = await recommendationService.getRecommendationsInRange(userId, fromDateInclusive, toDateExclusive);
        if (recommendationsState.status === 'AVAILABLE') {
            for (const recommendation of recommendationsState.data) recommendationsByDate.set(recommendation.date, recommendation);
            recommendationRevision = recommendationsState.revision;
        }
    }

    const exposures: PerformedExposureFact[] = [];
    const coverageCredits: CoverageCreditFact[] = [];

    for (const { occurrence, providerSources } of sourceHydration.rows) {
        const structuredRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
        const garminSource = providerSources.find(source => source.ref.provider.toLowerCase() === 'garmin');
        const garminRef = garminSource?.ref;

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

                const recommendation = recommendationsByDate.get(execution.date);
                const workoutVariantId = workoutVariantForExecution(execution, templateId, recommendation);

                hydrated.structured = {
                    executionId: execution.executionId,
                    executionState: execution.state,
                    ...(workoutId ? { workoutId } : {}),
                    ...(templateId ? { templateId } : {}),
                    ...(executionModality ? { modality: executionModality } : {}),
                    ...(category ? { category } : {}),
                    startedAt: execution.startedAt,
                    ...(execution.completedAt ? { endedAt: execution.completedAt } : {}),
                    ...(durationMin !== undefined ? { durationMin } : {}),
                    isLegacyStrength,
                    ...(workoutVariantId ? { workoutVariantId } : {}),
                    ...(isReadinessModifiedExecution(execution, templateId, recommendation)
                        ? { isReadinessModifiedDose: true }
                        : {}),
                };
            }
        }

        if (garminRef) {
            const garminActivity = garminSource?.activity ?? activitiesById.get(garminRef.activityId);
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
                ...(garminSource?.override ? { override: garminSource.override } : {}),
                ...(overridesDegraded ? { overridesUnavailable: true } : {}),
            };
        }

        const facts = deriveFactsFromOccurrence(occurrence, hydrated, descriptor);
        exposures.push(options.includeDisplayProvenance ? {
            ...facts.exposure,
            ...(hydrated.structured?.executionState ? { executionState: hydrated.structured.executionState } : {}),
            providerActivityIds: [...new Set(providerSources
                .filter(source => source.ref.provider.toLowerCase() === 'garmin')
                .map(source => source.ref.activityId))].sort(),
        } : facts.exposure);
        coverageCredits.push(...facts.coverageCredits);
    }

    exposures.sort((a, b) => a.localDate.localeCompare(b.localDate));

    const occurrenceRevision = activeOccurrences
        .map(o => `${o.performedOccurrenceId}:${o.updatedAt}`)
        .sort()
        .join('|');
    // The override service has no revision. Hash only bounded, attached semantic content;
    // free-text notes, timestamps and overrides outside these occurrences are irrelevant.
    const relevantOverrides = sourceHydration.rows.flatMap(row => row.providerSources)
        .flatMap(({ ref, override }) => ref.provider.toLowerCase() === 'garmin' && override ? [{
            activityId: ref.activityId,
            modality: override.overriddenModality,
            intensity: override.overriddenIntensity,
            stimulusFocus: override.stimulusFocus ?? null,
            rpe: override.rpe ?? null,
        }] : [])
        .sort((a, b) => a.activityId.localeCompare(b.activityId));
    const overrideRevision = overridesDegraded ? 'unavailable' : relevantOverrides.length
        ? await computeContentHash({ schema: 'performed-facts-overrides-v1', overrides: relevantOverrides })
        : undefined;
    // Coverage credits are descriptor-scoped semantic facts. Include that scope in the
    // snapshot revision so evergreen/event interpretations of the same occurrences never
    // alias as one immutable fact revision in cache/audit/replay consumers.
    // The readiness marker is derived from recommendation documents, so a recommendation
    // revision change must also change the facts revision.
    const revision = `canonical-facts-v1:${descriptor.id}:${fromDateInclusive}:${toDateExclusive}:${occurrenceRevision}`
        + (overrideRevision ? `:overrides=${overrideRevision}` : '')
        + (recommendationRevision ? `:rec=${recommendationRevision}` : '');

    return {
        asOfDate: toDateExclusive,
        windowDays: Math.max(1, Math.round((Date.parse(toDateExclusive) - Date.parse(fromDateInclusive)) / 86400000)),
        revision,
        exposures,
        coverageCredits,
        ...(overridesDegraded ? { overridesDegraded: true } : {}),
    };
}

/**
 * ADR-0036 (H4) D-LEDGER/D-REASSESS need today's own already-completed work, not just
 * history strictly before today. `getPerformedTrainingFactsInRange`'s `[from, to)`
 * convention structurally excludes `toDateExclusive` itself, so passing today's date as
 * that boundary -- as every current caller does -- always excludes today (see
 * `trainingIntent.ts`'s always-pass-`date` call). This wrapper makes "through today,
 * inclusive" an explicit, correctly-named request instead of relying on callers to
 * remember to pass tomorrow's date as the exclusive boundary.
 *
 * `getPerformedTrainingFactsInRange` itself is unchanged and untouched by this addition:
 * its hydration logic has no date-relative assumption that data must be historical (see
 * the H4 same-day verification tests), so this is a pure convenience wrapper, not a new
 * code path. Not called from any production decision path yet -- adding a same-day read
 * is a prerequisite for H4 runtime wiring, not itself a decision-affecting change.
 */
export function getPerformedTrainingFactsThroughToday(
    userId: string,
    fromDateInclusive: string,
    todayInclusive: string,
    options: GetPerformedTrainingFactsOptions = {},
): Promise<PerformedTrainingFactsSnapshot> {
    return getPerformedTrainingFactsInRange(userId, fromDateInclusive, addDaysToLocalDateString(todayInclusive, 1), options);
}
