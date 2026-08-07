import type {
    CompletedTrainingEvent,
    CompletedTrainingIntensity,
    DailyRecommendation,
    NormalizedGarminActivity,
    SessionTemplate,
    TrainingRecord,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import type { CompletedExposure } from './trainingHistory';
import { ENRICHED_TEMPLATES } from './templates';

type CompletedModality = SessionTemplate['modality'] | 'Unknown';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicCapacity: 0,
    thresholdDevelopment: 0,
    surgeRepeatability: 0,
    maxStrength: 0,
    hypertrophy: 0,
    mobilityRecovery: 0,
};
const ADHERENCE_DURATION_TOLERANCE_MIN = 20;

const DEFAULT_COST_BY_MODALITY: Record<CompletedModality, Record<CompletedTrainingIntensity, WorkoutCostProfile>> = {
    Cycling: {
        easy: { systemic: 0.2, cardiovascular: 0.25, lowerBody: 0.2, upperBody: 0, impactTissue: 0.05, neuromuscular: 0.1 },
        moderate: { systemic: 0.45, cardiovascular: 0.55, lowerBody: 0.45, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.25 },
        hard: { systemic: 0.7, cardiovascular: 0.85, lowerBody: 0.65, upperBody: 0, impactTissue: 0.15, neuromuscular: 0.5 },
        unknown: { systemic: 0.45, cardiovascular: 0.5, lowerBody: 0.45, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.25 },
    },
    Running: {
        easy: { systemic: 0.25, cardiovascular: 0.3, lowerBody: 0.35, upperBody: 0, impactTissue: 0.4, neuromuscular: 0.15 },
        moderate: { systemic: 0.55, cardiovascular: 0.6, lowerBody: 0.65, upperBody: 0, impactTissue: 0.7, neuromuscular: 0.4 },
        hard: { systemic: 0.8, cardiovascular: 0.85, lowerBody: 0.85, upperBody: 0, impactTissue: 0.9, neuromuscular: 0.65 },
        unknown: { systemic: 0.55, cardiovascular: 0.6, lowerBody: 0.65, upperBody: 0, impactTissue: 0.7, neuromuscular: 0.35 },
    },
    Strength: {
        easy: { systemic: 0.2, cardiovascular: 0.05, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.1, neuromuscular: 0.15 },
        moderate: { systemic: 0.45, cardiovascular: 0.1, lowerBody: 0.55, upperBody: 0.5, impactTissue: 0.2, neuromuscular: 0.4 },
        hard: { systemic: 0.7, cardiovascular: 0.15, lowerBody: 0.8, upperBody: 0.7, impactTissue: 0.3, neuromuscular: 0.65 },
        unknown: { systemic: 0.5, cardiovascular: 0.1, lowerBody: 0.55, upperBody: 0.5, impactTissue: 0.2, neuromuscular: 0.4 },
    },
    Field: {
        easy: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.4, upperBody: 0.05, impactTissue: 0.45, neuromuscular: 0.35 },
        moderate: { systemic: 0.6, cardiovascular: 0.65, lowerBody: 0.7, upperBody: 0.1, impactTissue: 0.75, neuromuscular: 0.65 },
        hard: { systemic: 0.8, cardiovascular: 0.8, lowerBody: 0.85, upperBody: 0.1, impactTissue: 0.9, neuromuscular: 0.8 },
        unknown: { systemic: 0.6, cardiovascular: 0.65, lowerBody: 0.7, upperBody: 0.1, impactTissue: 0.75, neuromuscular: 0.65 },
    },
    Mobility: {
        easy: { systemic: 0.05, cardiovascular: 0.05, lowerBody: 0.05, upperBody: 0.05, impactTissue: 0.05, neuromuscular: 0.05 },
        moderate: { systemic: 0.1, cardiovascular: 0.1, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
        hard: { systemic: 0.2, cardiovascular: 0.15, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.15, neuromuscular: 0.15 },
        unknown: { systemic: 0.1, cardiovascular: 0.1, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1 },
    },
    'Cross Training': {
        easy: { systemic: 0.2, cardiovascular: 0.25, lowerBody: 0.2, upperBody: 0.15, impactTissue: 0.15, neuromuscular: 0.15 },
        moderate: { systemic: 0.45, cardiovascular: 0.55, lowerBody: 0.45, upperBody: 0.25, impactTissue: 0.25, neuromuscular: 0.3 },
        hard: { systemic: 0.7, cardiovascular: 0.8, lowerBody: 0.65, upperBody: 0.35, impactTissue: 0.35, neuromuscular: 0.55 },
        unknown: { systemic: 0.45, cardiovascular: 0.55, lowerBody: 0.45, upperBody: 0.25, impactTissue: 0.25, neuromuscular: 0.3 },
    },
    None: { easy: ZERO_COST, moderate: ZERO_COST, hard: ZERO_COST, unknown: ZERO_COST },
    Unknown: {
        easy: { systemic: 0.25, cardiovascular: 0.25, lowerBody: 0.25, upperBody: 0.15, impactTissue: 0.2, neuromuscular: 0.2 },
        moderate: { systemic: 0.5, cardiovascular: 0.5, lowerBody: 0.5, upperBody: 0.25, impactTissue: 0.45, neuromuscular: 0.4 },
        hard: { systemic: 0.7, cardiovascular: 0.7, lowerBody: 0.7, upperBody: 0.3, impactTissue: 0.65, neuromuscular: 0.6 },
        unknown: { systemic: 0.5, cardiovascular: 0.5, lowerBody: 0.5, upperBody: 0.25, impactTissue: 0.45, neuromuscular: 0.4 },
    },
};

function modalityFromActivityType(type: string): CompletedModality {
    const normalized = type.toLowerCase();
    if (normalized.includes('cycl') || normalized.includes('bike')) return 'Cycling';
    if (normalized.includes('run')) return 'Running';
    if (normalized.includes('strength') || normalized.includes('weight') || normalized.includes('lift')) return 'Strength';
    if (normalized.includes('soccer') || normalized.includes('football') || normalized.includes('field')) return 'Field';
    if (normalized.includes('yoga') || normalized.includes('mobility')) return 'Mobility';
    if (normalized.includes('swim') || normalized.includes('row') || normalized.includes('ellipt') || normalized.includes('cardio')) return 'Cross Training';
    return 'Unknown';
}

function intensityFromGarmin(activity: NormalizedGarminActivity): CompletedTrainingIntensity {
    if (activity.intensityTag.toLowerCase() === 'hard') return 'hard';
    const trainingEffect = Math.max(activity.trainingEffectAerobic ?? 0, activity.trainingEffectAnaerobic ?? 0);
    if (trainingEffect >= 3) return 'hard';
    if (trainingEffect >= 1.5) return 'moderate';
    return trainingEffect > 0 ? 'easy' : 'unknown';
}

function templateForRecommendation(recommendation: DailyRecommendation): SessionTemplate | undefined {
    return ENRICHED_TEMPLATES.find(template => template.id === recommendation.templateId);
}

function adherenceCandidate(recommendation: DailyRecommendation): { modality: CompletedModality; durationMin: number | null; template?: SessionTemplate } | null {
    if (recommendation.adherence.followed === null || recommendation.adherence.skipped) return null;
    const template = templateForRecommendation(recommendation);
    if (recommendation.adherence.followed) {
        return { modality: recommendation.modality, durationMin: template?.durationMin ?? null, template };
    }
    if (!recommendation.adherence.actualModality) return null;
    return { modality: recommendation.adherence.actualModality, durationMin: recommendation.adherence.actualDurationMin, template: undefined };
}

function comparableDurationDifference(left: number | null, right: number | null): number {
    if (left === null || right === null) return 0;
    return Math.abs(left - right);
}

function candidateEventFromGarmin(activity: NormalizedGarminActivity): CompletedTrainingEvent {
    const modality = modalityFromActivityType(activity.type);
    const intensity = intensityFromGarmin(activity);
    return {
        id: `garmin:${activity.activityId}`,
        date: activity.date,
        durationMin: activity.durationMin,
        modality,
        intensity,
        trainingEffect: Math.max(activity.trainingEffectAerobic ?? 0, activity.trainingEffectAnaerobic ?? 0) || null,
        estimatedCost: DEFAULT_COST_BY_MODALITY[modality][intensity],
        estimatedStimulus: ZERO_STIMULUS,
        sources: ['garmin'],
        confidence: modality === 'Unknown' ? 'medium' : 'high',
        linkedActivityId: activity.activityId,
        linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
    };
}

function candidateEventFromAdherence(recommendation: DailyRecommendation, candidate: NonNullable<ReturnType<typeof adherenceCandidate>>): CompletedTrainingEvent {
    const intensity: CompletedTrainingIntensity = candidate.template?.systemicCost && candidate.template.systemicCost >= 0.55 ? 'hard' : 'moderate';
    return {
        id: `adherence:${recommendation.date}`,
        date: recommendation.date,
        durationMin: candidate.durationMin,
        modality: candidate.modality,
        intensity,
        trainingEffect: null,
        estimatedCost: candidate.template?.costProfile ?? DEFAULT_COST_BY_MODALITY[candidate.modality][intensity],
        estimatedStimulus: candidate.template?.stimulusProfile ?? ZERO_STIMULUS,
        sources: ['adherence'],
        confidence: candidate.template ? 'medium' : 'low',
        linkedActivityId: null,
        linkedRecommendationDate: recommendation.date,
        athleteFeedback: { followed: recommendation.adherence.followed, notes: recommendation.adherence.notes },
    };
}

function mergeAdherenceIntoGarmin(
    event: CompletedTrainingEvent,
    recommendation: DailyRecommendation,
    candidate: NonNullable<ReturnType<typeof adherenceCandidate>>,
): CompletedTrainingEvent {
    return {
        ...event,
        sources: ['garmin', 'adherence'],
        confidence: 'high',
        linkedRecommendationDate: recommendation.date,
        // Garmin remains the measured duration/training-effect authority. Template
        // metadata improves dimensional cost/stimulus only when the athlete confirmed
        // the prescribed session was followed.
        estimatedCost: recommendation.adherence.followed && candidate.template?.costProfile
            ? candidate.template.costProfile
            : event.estimatedCost,
        estimatedStimulus: recommendation.adherence.followed && candidate.template?.stimulusProfile
            ? candidate.template.stimulusProfile
            : event.estimatedStimulus,
        athleteFeedback: { followed: recommendation.adherence.followed, notes: recommendation.adherence.notes },
    };
}

/**
 * Reconciles Garmin activities with answered adherence records into one real-world
 * training event per session. Unmatched Garmin activities are retained; unanswered or
 * explicitly skipped recommendations never fabricate a completed event.
 */
export function reconcileCompletedTrainingEvents(
    activities: NormalizedGarminActivity[],
    recommendations: DailyRecommendation[],
): CompletedTrainingEvent[] {
    const events = activities
        .map(candidateEventFromGarmin)
        .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

    for (const recommendation of [...recommendations].sort((left, right) => left.date.localeCompare(right.date))) {
        const candidate = adherenceCandidate(recommendation);
        if (!candidate) continue;

        const matchingIndex = events.reduce((bestIndex, event, index) => {
            const matchesCandidate = event.date === recommendation.date
                && event.modality === candidate.modality
                && !event.sources.includes('adherence')
                && comparableDurationDifference(event.durationMin, candidate.durationMin) <= ADHERENCE_DURATION_TOLERANCE_MIN;
            if (!matchesCandidate) return bestIndex;
            if (bestIndex === -1) return index;

            return comparableDurationDifference(event.durationMin, candidate.durationMin)
                < comparableDurationDifference(events[bestIndex].durationMin, candidate.durationMin)
                ? index
                : bestIndex;
        }, -1);

        if (matchingIndex >= 0) {
            events[matchingIndex] = mergeAdherenceIntoGarmin(events[matchingIndex], recommendation, candidate);
        } else {
            events.push(candidateEventFromAdherence(recommendation, candidate));
        }
    }

    return events.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

export function completedEventToExposure(event: CompletedTrainingEvent): CompletedExposure {
    const record: TrainingRecord = {
        type: `${event.modality} ${event.intensity}`,
        duration_min: event.durationMin ?? 0,
        training_effect: event.trainingEffect ?? 0,
        intensity_tag: event.intensity === 'unknown' ? '' : event.intensity,
    };
    const modality = event.modality === 'Unknown' ? undefined : event.modality;
    return {
        date: event.date,
        costProfile: event.estimatedCost,
        trainingRecordLike: record,
        ...(modality ? {
            modality,
            stimulusProfile: { ...ZERO_STIMULUS, ...event.estimatedStimulus },
        } : {}),
    };
}

/**
 * Derives V2 SessionPlanRelationship status between a daily recommendation and completed activity.
 */
export function deriveSessionPlanRelationship(
    recommendation?: DailyRecommendation | null,
    event?: CompletedTrainingEvent | null,
): import('./models').SessionPlanRelationship {
    if (!recommendation) return 'unplanned';
    if (!event) {
        if (recommendation.adherence.skipped) return 'missed';
        return 'uncertain_match';
    }

    if (event.date === recommendation.date) {
        if (event.modality === recommendation.modality) {
            if (recommendation.adherence.followed !== false) return 'matched_as_planned';
            return 'matched_modified';
        }
        return 'matched_modified';
    }

    if (event.modality === recommendation.modality) {
        return 'rescheduled';
    }

    return 'unplanned';
}
