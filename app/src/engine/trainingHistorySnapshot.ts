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

/**
 * S3.2 (ADR-0021 D-STRCOST): `'off'` (the default at the one production call site,
 * `firestoreTrainingHistory.ts`) is bit-identical to pre-S3.2 behaviour --
 * `sourceStates.manualTraining` stays `MISSING` and no strength exposure is added, exactly
 * as `buildTrainingHistorySnapshot` already did. The other member of this union is
 * unreachable from production callers (see `trainingHistorySnapshot.test.ts`'s architecture
 * guard, which asserts the literal never appears in production logic at all -- every branch
 * below checks for `'off'`, never for the enabled value) and exists only for S3.3's
 * measurement comparison. Mirrors `SubjectiveDriftPolicy`'s plumbing pattern (`rules.ts`) --
 * a selector threaded through the real function, not a second implementation of it.
 */
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

/** `MISSING` is a legitimate, common state for this source (an athlete who does no
 *  strength work has none to find) and is tolerated as zero strength exposures, not a
 *  blocking failure -- unlike `activities`/`recommendations`, which are expected to exist
 *  every day a normal recommendation is being composed. `INVALID`/`UNAVAILABLE` are real
 *  failures (a corrupt document, a failed read) and throw exactly like the other two
 *  sources: preserving the "must surface as a failure, never as silently-zero load"
 *  contract means MISSING and a genuine failure cannot be conflated in either direction. */
function requireManualTrainingUsable(state: DataState<StrengthSession[]>): StrengthSession[] {
    if (state.status === 'AVAILABLE') return state.data;
    if (state.status === 'MISSING') return [];
    throw new TrainingHistorySourceError('manualTraining', state);
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
    // Appended after generatedAt (not before it) so every existing 5-positional-argument
    // call site -- which passes an explicit generatedAt -- keeps compiling and keeps its
    // exact pre-S3.2 behaviour unchanged, rather than silently sliding its generatedAt
    // argument into the new manualTraining parameter slot.
    generatedAt = new Date().toISOString(),
    manualTraining: DataState<StrengthSession[]> = { status: 'MISSING' },
    manualTrainingPolicy: ManualTrainingPolicy = 'off',
): TrainingHistorySnapshot {
    const activityRecords = requireAvailable('activities', activities);
    const recommendationRecords = requireAvailable('recommendations', recommendations);
    const completedEvents = reconcileCompletedTrainingEvents(activityRecords, recommendationRecords);
    completedEvents.sort((a, b) => a.date.localeCompare(b.date));
    const exposures = completedEvents.map(event => exposureWithExactIdentity(event, recommendationRecords));

    // Branches check `=== 'off'` (the safe default), never the enabled value -- mirrors
    // rules.ts's subjectiveDriftStrain/evaluateReadinessAndSafetyEnvelope exactly, so the
    // architecture guard below can assert the enabled literal appears nowhere in production
    // logic at all, not merely that it's unreachable at runtime. 'off' reproduces pre-S3.2
    // behaviour exactly: sourceStates.manualTraining stays MISSING regardless of what was
    // actually fetched, and no strength exposure is added -- the selector gates both the
    // reported source state and its effect on exposures together, so a caller cannot
    // observe partial activation.
    let manualTrainingSourceState: DataStateSummary = { status: 'MISSING' };
    if (manualTrainingPolicy !== 'off') {
        manualTrainingSourceState = summarizeDataState(manualTraining);
        const strengthSessions = requireManualTrainingUsable(manualTraining);
        for (const session of strengthSessions) {
            const exposure = deriveStrengthExposure(session);
            if (exposure) exposures.push(exposure);
        }
    }
    exposures.sort((a, b) => a.date.localeCompare(b.date));

    const activityRevision = revisionOf(activities);
    const recommendationRevision = revisionOf(recommendations);
    // The revision string's shape itself must stay bit-identical when 'off' -- not just its
    // value -- so the manual-training segment is appended only when the selector is on,
    // rather than always present as a constant 'off' placeholder. A parser or snapshot test
    // asserting today's exact 4-segment revision format must see no change while off.
    let revision = `history-v1:${throughDateExclusive}:${windowDays}:${activityRevision}:${recommendationRevision}`;
    if (manualTrainingPolicy !== 'off') {
        revision += `:${revisionOf(manualTraining)}`;
    }

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
