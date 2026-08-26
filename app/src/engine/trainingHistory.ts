import type { DailyRecommendation, DeliveredDose, SessionTemplate, TrainingRecord, WorkoutCostProfile, WorkoutStimulusProfile } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { workoutForTemplate } from '../workouts/prescription';

/** A completed, adherence-backed exposure reconstructed for the rolling engine. */
export interface CompletedExposure {
    /** Stable occurrence key for idempotent replay across adaptation/fatigue/coverage
     * ledgers. It identifies the occurrence, not the workout family. */
    occurrenceKey?: string;
    date: string;
    costProfile: WorkoutCostProfile;
    trainingRecordLike: TrainingRecord;
    deliveredDose?: DeliveredDose;
    /** Exact identity is optional and fails closed for coverage when unavailable. */
    templateId?: string;
    workoutId?: string;
    recoveryHours?: number;
    stimulusProfile?: WorkoutStimulusProfile;
    stimulusConfidence?: 'exact' | 'inferred' | 'unknown';
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

export interface TrainingHistoryProvider {
    reconstruct(userId: string, throughDateExclusive: string, windowDays: number): Promise<CompletedExposure[]>;
    getSnapshot?(userId: string, throughDateExclusive: string, windowDays: number): Promise<TrainingHistorySnapshot>;
}

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

/** Pure adapter for one persisted adherence response. Followed sessions use exact catalog
 * identity; modified sessions retain only approximate modality/duration evidence. */
export function exposureFromRecommendation(date: string, rec: DailyRecommendation | null): CompletedExposure | null {
    if (!rec || rec.adherence.followed === null || rec.adherence.skipped) return null;
    const template = rec.adherence.followed
        ? ENRICHED_TEMPLATES_BY_ID.get(rec.templateId)
        : ENRICHED_TEMPLATES.find(t => t.modality === rec.adherence.actualModality);
    if (!template) return null;
    const trainingRecordLike: TrainingRecord = {
        type: rec.adherence.followed ? `${rec.modality} ${rec.category}` : `${rec.adherence.actualModality} training`,
        duration_min: rec.adherence.followed ? template.durationMin : (rec.adherence.actualDurationMin ?? template.durationMin),
        training_effect: 0,
        intensity_tag: '',
    };
    const matchingWorkout = rec.adherence.followed ? workoutForTemplate(template.id) : undefined;
    const exactWorkoutId = matchingWorkout?.id;
    const recoveryHours = matchingWorkout?.loadProfile.recoveryHours;
    return {
        occurrenceKey: `recommendation:${date}`,
        date,
        costProfile: template.costProfile ?? ZERO_COST,
        trainingRecordLike,
        stimulusConfidence: rec.adherence.followed ? 'exact' : 'unknown',
        ...(recoveryHours !== undefined ? { recoveryHours } : {}),
        ...(rec.adherence.followed && template.stimulusProfile
            ? {
                stimulusProfile: template.stimulusProfile,
                modality: template.modality,
                category: template.category,
                templateId: template.id,
                ...(exactWorkoutId ? { workoutId: exactWorkoutId } : {}),
            }
            : {}),
    };
}
