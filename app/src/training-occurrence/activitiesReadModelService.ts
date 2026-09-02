/**
 * PR 2 (ADR-0034): the provider-agnostic occurrence query the Activities UI reads from
 * instead of `activityService.getActivitiesInRange` directly. Hydrates each canonical
 * occurrence's attached sources (structured execution + prescription + entries via
 * `comparePlannedVsPerformed`; the primary Garmin activity as-is) into a
 * `CompletedWorkoutView`. Read-only -- never writes reconciliation state itself (that
 * remains `reconciliationService.ts`'s job).
 */
import { activityService } from '../services/activityService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { comparePlannedVsPerformed } from '../sessions/performedComparison';
import { addDaysToLocalDateString, getPreviousLocalDateString } from '../utils/localDate';
import type { NormalizedGarminActivity } from '../engine/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { sourceBadgeFor } from './completedWorkoutView';
import { compareActivitiesReadModels, recordActivitiesReadModelComparison } from './activitiesReadModelDiagnostics';
import { isProviderActivityRef, isStructuredExecutionRef, type PerformedTrainingOccurrence } from './models';
import { performedTrainingOccurrenceRepository as repository } from './repository';

async function resolveStructuredDetail(
    userId: string,
    executionId: string,
): Promise<CompletedWorkoutView['structured']> {
    const executionState = await sessionExecutionService.getExecution(userId, executionId);
    if (executionState.status !== 'AVAILABLE') return undefined;
    const execution = executionState.data;

    const definitionState = await resolveSessionDefinition(userId, execution.sessionSource, execution.prescriptionHash);
    if (definitionState.status !== 'AVAILABLE') return undefined;

    const entries = await sessionExecutionService.getEntries(userId, executionId);
    return {
        title: definitionState.data.title,
        comparison: comparePlannedVsPerformed(definitionState.data, entries),
    };
}

async function hydrateOccurrence(
    userId: string,
    occurrence: PerformedTrainingOccurrence,
    activitiesById: Map<string, NormalizedGarminActivity>,
): Promise<CompletedWorkoutView> {
    const structuredRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
    // The domain is provider-neutral and may contain multiple provider sources, but the
    // v1 DTO has a specifically-Garmin telemetry slot. Never treat the first arbitrary
    // provider source as Garmin merely because it happens to precede a Garmin ref.
    // isProviderActivityRef is an explicit type predicate (see models.ts) rather than an
    // inline `ref.kind === '...'` check, so the narrowing survives `.find`/`.filter`
    // across TypeScript toolchains that don't infer it from an arrow-function body.
    const garminRef = occurrence.sourceRefs
        .filter(isProviderActivityRef)
        .find(ref => ref.provider.toLowerCase() === 'garmin');

    const structured = structuredRef ? await resolveStructuredDetail(userId, structuredRef.executionId) : undefined;
    const garmin = garminRef ? activitiesById.get(garminRef.activityId) : undefined;

    return {
        performedOccurrenceId: occurrence.performedOccurrenceId,
        localDate: occurrence.localDate,
        modality: occurrence.modality,
        startedAt: occurrence.startedAt,
        endedAt: occurrence.endedAt,
        sourceBadge: sourceBadgeFor(occurrence),
        reconciliation: occurrence.reconciliation,
        structured,
        garmin,
        garminExerciseSetsAreDiagnosticOnly: !!structuredRef,
    };
}

/** `toDateExclusive`-style range, matching `activityService.getActivitiesInRange` and
 * `repository.queryActiveInDateWindow`'s (inclusive) convention. The canonical occurrence
 * window remains exact. Provider hydration is intentionally fetched one local day wider on
 * either side because a correctly-linked Garmin source can carry an adjacent provider-local
 * date across midnight/travel/timezone boundaries while the canonical occurrence keeps the
 * structured/Warsaw display date. Activity identity, not that widened date, selects the
 * telemetry attached to each canonical row. */
export async function getCompletedWorkoutsInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<CompletedWorkoutView[]> {
    const toDateInclusiveForOccurrenceQuery = getPreviousLocalDateString(toDateExclusive);
    const hydrationFromDateInclusive = addDaysToLocalDateString(fromDateInclusive, -1);
    const hydrationToDateExclusive = addDaysToLocalDateString(toDateExclusive, 1);

    const [occurrences, activitiesState] = await Promise.all([
        repository.queryActiveInDateWindow(userId, fromDateInclusive, toDateInclusiveForOccurrenceQuery),
        activityService.getActivitiesInRange(userId, hydrationFromDateInclusive, hydrationToDateExclusive),
    ]);

    const availableActivities = activitiesState.status === 'AVAILABLE' ? activitiesState.data : [];
    const activitiesById = new Map<string, NormalizedGarminActivity>(
        availableActivities.map(activity => [activity.activityId, activity] as const),
    );

    const views = await Promise.all(occurrences.map(occurrence => hydrateOccurrence(userId, occurrence, activitiesById)));
    const sortedViews = views.sort((a, b) => (b.startedAt ?? b.localDate ?? '').localeCompare(a.startedAt ?? a.localDate ?? ''));

    // Own the dual-read comparison where both inputs are guaranteed to be available. The
    // previous UI-level best-effort log could be skipped permanently when this canonical
    // request resolved before the separate raw-activity request. Filter the widened
    // hydration payload back to the caller's exact range so diagnostic counts remain
    // apples-to-apples with the current Activities read model.
    if (activitiesState.status === 'AVAILABLE') {
        const currentRangeActivities = availableActivities.filter(
            activity => activity.date >= fromDateInclusive && activity.date < toDateExclusive,
        );
        recordActivitiesReadModelComparison(
            userId,
            compareActivitiesReadModels(currentRangeActivities, sortedViews),
        );
    }

    return sortedViews;
}
