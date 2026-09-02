/**
 * Deterministic rebuild/repair (`docs/plans/training-occurrence-pr1-scope.md`
 * "rebuild/repair API or service primitive"). Recomputes an occurrence's derived
 * display-summary fields from its currently-attached, still-valid sources -- never
 * touches `sourceRefs`, `status`, or `reconciliation.manualDecision`, so a sticky manual
 * decision always survives a rebuild. A source whose underlying record is now missing or
 * invalid (deleted structured execution, etc.) is simply excluded from recomputation
 * rather than failing the whole rebuild -- ADR-0034 "Structured execution
 * removed/invalidated": the occurrence stays alive on its remaining valid evidence.
 */
import { activityService } from '../services/activityService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { recordShadowReconciliationEvent } from './metrics';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { buildProjection } from './projectionBuilder';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import { garminActivityToFacts, structuredExecutionToFacts } from './reconciliationService';

async function factsForSource(
    userId: string,
    ref: PerformedTrainingOccurrence['sourceRefs'][number],
    fallbackLocalDate: string | undefined,
): Promise<ReconciliationSourceFacts | null> {
    if (ref.kind === 'structured_execution') {
        const state = await sessionExecutionService.getExecution(userId, ref.executionId);
        return state.status === 'AVAILABLE' ? structuredExecutionToFacts(state.data) : null;
    }
    if (!fallbackLocalDate) return null;
    // No single-activity getter exists on activityService -- a bounded 2-day window read
    // anchored on the occurrence's own localDate is enough to recover this one activity's
    // current record without a new read primitive.
    const activitiesState = await activityService.getActivitiesInRange(
        userId,
        fallbackLocalDate,
        addDaysToLocalDateString(fallbackLocalDate, 1),
    );
    if (activitiesState.status !== 'AVAILABLE') return null;
    const match = activitiesState.data.find(activity => activity.activityId === ref.activityId);
    return match ? garminActivityToFacts(match, ref.provider) : null;
}

export async function rebuildOccurrence(userId: string, performedOccurrenceId: string): Promise<PerformedTrainingOccurrence | null> {
    const occurrence = await repository.getById(userId, performedOccurrenceId);
    if (!occurrence || occurrence.status !== 'active') return occurrence;

    const facts: ReconciliationSourceFacts[] = [];
    for (const ref of occurrence.sourceRefs) {
        const found = await factsForSource(userId, ref, occurrence.localDate);
        if (found) facts.push(found);
    }
    if (facts.length === 0) return occurrence; // nothing valid to recompute from -- leave the existing projection as-is, never destructive.

    const projection = buildProjection(facts);
    const rebuilt = await repository.updateProjection(userId, performedOccurrenceId, projection);
    recordShadowReconciliationEvent({ type: 'training_occurrence.projection_rebuild', userId, performedOccurrenceId });
    return rebuilt;
}

export async function rebuildDateRangeForUser(userId: string, fromDateInclusive: string, toDateInclusive: string): Promise<number> {
    const occurrences = await repository.queryActiveInDateWindow(userId, fromDateInclusive, toDateInclusive);
    for (const occurrence of occurrences) {
        await rebuildOccurrence(userId, occurrence.performedOccurrenceId);
    }
    return occurrences.length;
}
