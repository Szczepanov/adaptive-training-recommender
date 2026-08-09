import type { CompletedTrainingEvent, DailyRecommendation, NormalizedGarminActivity } from './models';
import type { DataState, DataStateSummary } from './dataState';
import { summarizeDataState } from './dataState';
import { completedEventToExposure, reconcileCompletedTrainingEvents } from './completedTraining';
import type { CompletedExposure } from './trainingHistory';
import { workoutForTemplate } from '../workouts/prescription';

export interface TrainingHistorySnapshot {
    throughDateExclusive: string;
    windowDays: number;
    completedEvents: CompletedTrainingEvent[];
    exposures: CompletedExposure[];
    sourceStates: Record<'activities' | 'recommendations' | 'manualTraining', DataStateSummary>;
    generatedAt: string;
    revision: string;
}

export class TrainingHistorySourceError extends Error {
    readonly source: 'activities' | 'recommendations';
    readonly state: DataState<unknown>;

    constructor(source: 'activities' | 'recommendations', state: DataState<unknown>) {
        super(`Training history ${source} source is ${state.status.toLowerCase()}.`);
        this.name = 'TrainingHistorySourceError';
        this.source = source;
        this.state = state;
    }
}

function requireAvailable<T>(source: 'activities' | 'recommendations', state: DataState<T>): T {
    if (state.status !== 'AVAILABLE') throw new TrainingHistorySourceError(source, state);
    return state.data;
}

function revisionOf<T>(state: DataState<T>): string {
    return state.status === 'AVAILABLE' ? state.revision ?? 'none' : 'unavailable';
}

function exposureWithExactIdentity(
    event: CompletedTrainingEvent,
    recommendations: readonly DailyRecommendation[],
): CompletedExposure {
    const exposure = completedEventToExposure(event);
    if (!event.exactTemplateMatch || !event.linkedRecommendationDate) return exposure;
    const recommendation = recommendations.find(item => item.date === event.linkedRecommendationDate);
    if (!recommendation) return exposure;
    const workoutId = workoutForTemplate(recommendation.templateId)?.id;
    return {
        ...exposure,
        templateId: recommendation.templateId,
        ...(workoutId ? { workoutId } : {}),
        modality: recommendation.modality,
        category: recommendation.category,
    };
}

/**
 * Builds a single immutable history revision from bounded, already-validated sources.
 * A failed or invalid required source intentionally blocks normal planning instead of
 * being reinterpreted as an empty training history.
 */
export function buildTrainingHistorySnapshot(
    throughDateExclusive: string,
    windowDays: number,
    activities: DataState<NormalizedGarminActivity[]>,
    recommendations: DataState<DailyRecommendation[]>,
    generatedAt = new Date().toISOString(),
): TrainingHistorySnapshot {
    const activityRecords = requireAvailable('activities', activities);
    const recommendationRecords = requireAvailable('recommendations', recommendations);
    const completedEvents = reconcileCompletedTrainingEvents(activityRecords, recommendationRecords);
    completedEvents.sort((a, b) => a.date.localeCompare(b.date));
    // Phase 6.2c / ADR-0016: reconcileCompletedTrainingEvents already knows when an
    // exposure exactly matches an adherence-confirmed recommendation. Join the durable
    // recommendation here so the rolling history preserves template/workout identity for
    // coverage without expanding CompletedTrainingEvent's persisted/domain schema or
    // inferring roles from a title/modality later.
    const exposures = completedEvents.map(event => exposureWithExactIdentity(event, recommendationRecords));
    exposures.sort((a, b) => a.date.localeCompare(b.date));
    const activityRevision = revisionOf(activities);
    const recommendationRevision = revisionOf(recommendations);

    return {
        throughDateExclusive,
        windowDays,
        completedEvents,
        exposures,
        sourceStates: {
            activities: summarizeDataState(activities),
            recommendations: summarizeDataState(recommendations),
            manualTraining: { status: 'MISSING' },
        },
        generatedAt,
        revision: `history-v1:${throughDateExclusive}:${windowDays}:${activityRevision}:${recommendationRevision}`,
    };
}
