import type { NormalizedGarminActivity } from '../engine/models';
import { normalizeModality } from '../engine/performedTrainingFacts';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import type { SessionSourceRef } from '../sessions/models';
import { buildStructuredStepDetails, type StructuredStepDetail } from './structuredSetDetail';
import { hydrateOccurrenceSourcesInRange } from './occurrenceSourcesHydration';
import {
    isStructuredExecutionRef,
    type PerformedOccurrenceSourceKind,
    type ProviderActivitySourceRef,
    type ReconciliationStatus,
    type StructuredExecutionSourceRef,
} from './models';

export interface TrainingResponseSessionEvidence {
    performedOccurrenceId?: string;
    localDate: string;
    modality: string;
    identity: {
        level: 'canonical_occurrence' | 'provider_activity_only';
        reconciliationStatus?: ReconciliationStatus;
        sourceKinds: PerformedOccurrenceSourceKind[];
    };
    structured?: {
        sourceRef: StructuredExecutionSourceRef;
        executionId: string;
        sessionOccurrenceId?: string;
        prescriptionHash?: string;
        sessionSource: SessionSourceRef;
        workoutId?: string;
        steps: StructuredStepDetail[];
    };
    measuredSources: Array<{
        sourceRef: ProviderActivitySourceRef;
        provider: string;
        activityId: string;
        activity?: NormalizedGarminActivity;
    }>;
    sourceCompleteness: {
        occurrenceRead: 'available' | 'unavailable';
        structuredExecution: 'not_linked' | 'available' | 'unavailable';
        providerActivities: 'not_linked' | 'available' | 'partial' | 'ambiguous' | 'unavailable';
    };
}

export interface TrainingResponseEvidenceResult {
    evidence: TrainingResponseSessionEvidence[];
    occurrenceRead: 'available' | 'unavailable';
    providerActivityRead: 'available' | 'unavailable';
}

function activityOnlyEvidence(
    activity: NormalizedGarminActivity,
    occurrenceRead: 'available' | 'unavailable',
    providerActivityRead: 'available' | 'unavailable',
): TrainingResponseSessionEvidence {
    const modality = normalizeModality(activity.type);
    return {
        localDate: activity.date,
        modality: modality === 'Unknown' ? activity.type : modality,
        identity: { level: 'provider_activity_only', sourceKinds: ['provider_activity'] },
        measuredSources: [{
            sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: activity.activityId },
            provider: 'garmin',
            activityId: activity.activityId,
            activity,
        }],
        sourceCompleteness: {
            occurrenceRead,
            structuredExecution: occurrenceRead === 'unavailable' ? 'unavailable' : 'not_linked',
            providerActivities: providerActivityRead === 'available' ? 'available' : 'unavailable',
        },
    };
}

/** Read-time, provider-neutral projection. The input activity range is reused; every
 * attached provider ref stays explicit until a feature-specific selector chooses a source. */
export async function getTrainingResponseEvidenceInRange(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
    activities: readonly NormalizedGarminActivity[],
    providerActivityRead: 'available' | 'unavailable' = 'available',
): Promise<TrainingResponseEvidenceResult> {
    let sourceHydration: Awaited<ReturnType<typeof hydrateOccurrenceSourcesInRange>>;
    try {
        sourceHydration = await hydrateOccurrenceSourcesInRange(userId, fromDateInclusive, toDateExclusive, {
            preloadedActivities: activities,
        });
    } catch {
        return {
            evidence: activities
                .filter(activity => activity.date >= fromDateInclusive && activity.date < toDateExclusive)
                .map(activity => activityOnlyEvidence(activity, 'unavailable', providerActivityRead)),
            occurrenceRead: 'unavailable',
            providerActivityRead,
        };
    }

    const seenActivityIds = new Set<string>();
    const evidence: TrainingResponseSessionEvidence[] = await Promise.all(sourceHydration.rows.map(async ({ occurrence, providerSources }) => {
        const structuredRef = occurrence.sourceRefs.find(isStructuredExecutionRef);
        let structured: TrainingResponseSessionEvidence['structured'];
        let structuredExecution: TrainingResponseSessionEvidence['sourceCompleteness']['structuredExecution'] = 'not_linked';
        if (structuredRef) {
            try {
                const executionState = await sessionExecutionService.getExecution(userId, structuredRef.executionId);
                if (executionState.status === 'AVAILABLE') {
                    const execution = executionState.data;
                    const definitionState = await resolveSessionDefinition(
                        userId,
                        execution.sessionSource,
                        structuredRef.prescriptionHash ?? execution.prescriptionHash,
                    );
                    if (definitionState.status === 'AVAILABLE') {
                        const entries = await sessionExecutionService.getEntries(userId, execution.executionId);
                        const source = execution.sessionSource;
                        structured = {
                            sourceRef: structuredRef,
                            executionId: execution.executionId,
                            ...(structuredRef.sessionOccurrenceId ? { sessionOccurrenceId: structuredRef.sessionOccurrenceId } : {}),
                            ...(structuredRef.prescriptionHash ?? execution.prescriptionHash
                                ? { prescriptionHash: structuredRef.prescriptionHash ?? execution.prescriptionHash }
                                : {}),
                            sessionSource: source,
                            ...(source.kind === 'catalog' ? { workoutId: source.workoutId } : {}),
                            steps: buildStructuredStepDetails(definitionState.data, entries, []),
                        };
                        structuredExecution = 'available';
                    } else {
                        structuredExecution = 'unavailable';
                    }
                } else {
                    structuredExecution = 'unavailable';
                }
            } catch {
                structuredExecution = 'unavailable';
            }
        }

        const measuredSources = providerSources.map(({ ref, activity }) => {
            if (activity) seenActivityIds.add(activity.activityId);
            return { sourceRef: ref, provider: ref.provider, activityId: ref.activityId, ...(activity ? { activity } : {}) };
        });
        const availableSources = measuredSources.filter(source => source.activity).length;
        const providerActivities = measuredSources.length > 1
            ? 'ambiguous'
            : measuredSources.length === 0
            ? 'not_linked'
            : availableSources === measuredSources.length && providerActivityRead === 'available'
                ? 'available'
                : availableSources > 0
                    ? 'partial'
                    : 'unavailable';
        const fallbackActivity = measuredSources.find(source => source.activity)?.activity;
        const modality = occurrence.modality
            ?? (fallbackActivity ? normalizeModality(fallbackActivity.type) : 'Unknown');
        return {
            performedOccurrenceId: occurrence.performedOccurrenceId,
            localDate: occurrence.localDate ?? fallbackActivity?.date ?? '',
            modality: modality === 'Unknown' && fallbackActivity ? fallbackActivity.type : modality,
            identity: {
                level: 'canonical_occurrence' as const,
                reconciliationStatus: occurrence.reconciliation.state,
                sourceKinds: [...new Set(occurrence.sourceRefs.map(ref => ref.kind))],
            },
            ...(structured ? { structured } : {}),
            measuredSources,
            sourceCompleteness: {
                occurrenceRead: 'available' as const,
                structuredExecution,
                providerActivities,
            },
        };
    }));

    for (const activity of activities.filter(item => item.date >= fromDateInclusive && item.date < toDateExclusive)) {
        if (!seenActivityIds.has(activity.activityId)) {
            evidence.push(activityOnlyEvidence(activity, 'available', providerActivityRead));
        }
    }
    return { evidence, occurrenceRead: 'available', providerActivityRead };
}
