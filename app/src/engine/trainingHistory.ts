import type { DailyRecommendation, TrainingRecord, WorkoutCostProfile } from './models';
import { ENRICHED_TEMPLATES } from './templates';

/** A completed, adherence-backed exposure reconstructed for the rolling engine. */
export interface CompletedExposure {
    date: string;
    costProfile: WorkoutCostProfile;
    trainingRecordLike: TrainingRecord;
}

/**
 * Boundary around durable adherence history. Engine code depends on this small
 * contract, not on Firebase; production injects Firestore and tests inject fixtures.
 */
export interface TrainingHistoryProvider {
    reconstruct(userId: string, throughDateExclusive: string, windowDays: number): Promise<CompletedExposure[]>;
}

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

/** Pure adapter for one persisted adherence response. Followed sessions use the exact
 * recommended template; modified sessions receive approximate modality/duration
 * credit. Unanswered and explicitly skipped sessions intentionally receive none. */
export function exposureFromRecommendation(date: string, rec: DailyRecommendation | null): CompletedExposure | null {
    if (!rec || rec.adherence.followed === null || rec.adherence.skipped) return null;
    const template = rec.adherence.followed
        ? ENRICHED_TEMPLATES.find(t => t.id === rec.templateId)
        : ENRICHED_TEMPLATES.find(t => t.modality === rec.adherence.actualModality);
    if (!template) return null;
    const trainingRecordLike: TrainingRecord = {
        type: rec.adherence.followed ? `${rec.modality} ${rec.category}` : `${rec.adherence.actualModality} training`,
        duration_min: rec.adherence.followed ? template.durationMin : (rec.adherence.actualDurationMin ?? template.durationMin),
        training_effect: 0,
        intensity_tag: '',
    };
    return { date, costProfile: template.costProfile ?? ZERO_COST, trainingRecordLike };
}
