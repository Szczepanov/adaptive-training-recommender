import type { CompletedTrainingEvent, DailyRecommendation, NormalizedGarminActivity } from './models';
import type { DataState, DataStateSummary } from './dataState';
import { summarizeDataState } from './dataState';
import { completedEventToExposure, reconcileCompletedTrainingEvents } from './completedTraining';
import type { CompletedExposure } from './trainingHistory';

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
    const exposures = completedEvents.map(completedEventToExposure);
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
            // Manual entries are introduced in a later phase; their absence is known,
            // explicit, and does not make the Garmin/recommendation history unsafe.
            manualTraining: { status: 'MISSING' },
        },
        generatedAt,
        revision: `history-v1:${throughDateExclusive}:${windowDays}:${activityRevision}:${recommendationRevision}`,
    };
}
