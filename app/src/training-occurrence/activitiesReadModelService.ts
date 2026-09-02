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
import { getPreviousLocalDateString } from '../utils/localDate';
import type { NormalizedGarminActivity } from '../engine/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { sourceBadgeFor } from './completedWorkoutView';
import type { PerformedTrainingOccurrence } from './models';
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
    const structuredRef = occurrence.sourceRefs.find(ref => ref.kind === 'structured_execution');
    const providerRef = occurrence.sourceRefs.find(ref => ref.kind === 'provider_activity');

    const structured = structuredRef ? await resolveStructuredDetail(userId, structuredRef.executionId) : undefined;
    const garmin = providerRef ? activitiesById.get(providerRef.activityId) : undefined;

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
 * `repository.queryActiveInDateWindow`'s (inclusive) convention -- callers pass whatever
 * window they already use for the raw Garmin fetch today. */
export async function getCompletedWorkoutsInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<CompletedWorkoutView[]> {
    const toDateInclusiveForOccurrenceQuery = getPreviousLocalDateString(toDateExclusive);

    const [occurrences, activitiesState] = await Promise.all([
        repository.queryActiveInDateWindow(userId, fromDateInclusive, toDateInclusiveForOccurrenceQuery),
        activityService.getActivitiesInRange(userId, fromDateInclusive, toDateExclusive),
    ]);

    const activitiesById = new Map<string, NormalizedGarminActivity>(
        activitiesState.status === 'AVAILABLE'
            ? activitiesState.data.map(activity => [activity.activityId, activity] as const)
            : [],
    );

    const views = await Promise.all(occurrences.map(occurrence => hydrateOccurrence(userId, occurrence, activitiesById)));
    return views.sort((a, b) => (b.startedAt ?? b.localDate ?? '').localeCompare(a.startedAt ?? a.localDate ?? ''));
}
