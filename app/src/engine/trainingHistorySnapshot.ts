import type { CompletedTrainingEvent, DailyRecommendation, NormalizedGarminActivity, StrengthSession } from './models';
import type { DataState, DataStateSummary } from './dataState';
import { summarizeDataState } from './dataState';
import { completedEventToExposure, reconcileCompletedTrainingEvents } from './completedTraining';
import type { CompletedExposure } from './trainingHistory';
import { workoutForTemplate } from '../workouts/prescription';
import { deriveStrengthExposure } from '../workouts/strengthExposure';

export interface TrainingHistorySnapshot {
    throughDateExclusive: string;
    windowDays: number;
    completedEvents: CompletedTrainingEvent[];
    exposures: CompletedExposure[];
    sourceStates: Record<'activities' | 'recommendations' | 'manualTraining', DataStateSummary>;
    generatedAt: string;
    revision: string;
}

export type ManualTrainingPolicy = 'off' | 'included';

export class TrainingHistorySourceError extends Error {
    readonly source: 'activities' | 'recommendations' | 'manualTraining';
    readonly state: DataState<unknown>;

    constructor(source: 'activities' | 'recommendations' | 'manualTraining', state: DataState<unknown>) {
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

function requireManualTrainingUsable(state: DataState<StrengthSession[]>): StrengthSession[] {
    if (state.status === 'AVAILABLE') return state.data;
    if (state.status === 'MISSING') return [];
    throw new TrainingHistorySourceError('manualTraining', state);
}

function manualRevisionOf(state: DataState<StrengthSession[]>): string {
    if (state.status === 'AVAILABLE') return state.revision ?? 'none';
    if (state.status === 'MISSING') return 'missing';
    return state.status.toLowerCase();
}

function exposureWithExactIdentity(
    event: CompletedTrainingEvent,
    recommendations: readonly DailyRecommendation[],
): CompletedExposure {
    // When a real event reconciles to a daily recommendation, reuse the exact same
    // occurrence key the projection path used. That makes the transition
    // projected->completed idempotent instead of counting one physical session twice.
    const occurrenceKey = event.linkedRecommendationDate
        ? `recommendation:${event.linkedRecommendationDate}`
        : `completed:${event.id}`;
    const exposure: CompletedExposure = { ...completedEventToExposure(event), occurrenceKey };
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
    manualTraining: DataState<StrengthSession[]> = { status: 'MISSING' },
    manualTrainingPolicy: ManualTrainingPolicy = 'off',
): TrainingHistorySnapshot {
    const activityRecords = requireAvailable('activities', activities);
    const recommendationRecords = requireAvailable('recommendations', recommendations);
    const completedEvents = reconcileCompletedTrainingEvents(activityRecords, recommendationRecords);
    completedEvents.sort((a, b) => a.date.localeCompare(b.date));
    const exposures = completedEvents.map(event => exposureWithExactIdentity(event, recommendationRecords));

    let manualTrainingSourceState: DataStateSummary = { status: 'MISSING' };
    if (manualTrainingPolicy !== 'off') {
        manualTrainingSourceState = summarizeDataState(manualTraining);
        const manualSessions = requireManualTrainingUsable(manualTraining);
        for (const session of manualSessions) {
            const manualExposure = deriveStrengthExposure(session);
            if (!manualExposure) continue;

            // A recommendation-linked manual log and Garmin/adherence evidence can refer
            // to the same workout. Prefer the richer set log for that occurrence instead
            // of replaying one physical session twice into fatigue and objective credit.
            const duplicateIndex = manualExposure.occurrenceKey
                ? exposures.findIndex(exposure => exposure.occurrenceKey === manualExposure.occurrenceKey)
                : -1;
            if (duplicateIndex >= 0) exposures[duplicateIndex] = manualExposure;
            else exposures.push(manualExposure);
        }
    }
    exposures.sort((a, b) => a.date.localeCompare(b.date));
    const activityRevision = revisionOf(activities);
    const recommendationRevision = revisionOf(recommendations);

    let revision = `history-v1:${throughDateExclusive}:${windowDays}:${activityRevision}:${recommendationRevision}`;
    if (manualTrainingPolicy !== 'off') revision += `:manual:${manualRevisionOf(manualTraining)}`;

    return {
        throughDateExclusive,
        windowDays,
        completedEvents,
        exposures,
        sourceStates: {
            activities: summarizeDataState(activities),
            recommendations: summarizeDataState(recommendations),
            manualTraining: manualTrainingSourceState,
        },
        generatedAt,
        revision,
    };
}
