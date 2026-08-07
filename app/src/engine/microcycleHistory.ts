import type { TrainingRecord, WorkoutCostProfile } from './models';
import { ENRICHED_TEMPLATES } from './templates';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString } from '../utils/localDate';

export interface CompletedExposure {
    date: string;
    costProfile: WorkoutCostProfile;
    trainingRecordLike: TrainingRecord;
}

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };

function exposureForRecommendation(date: string, rec: Awaited<ReturnType<typeof recommendationService.getRecommendation>>): CompletedExposure | null {
    if (!rec || rec.adherence.followed === null || rec.adherence.skipped) return null;
    const template = rec.adherence.followed
        ? ENRICHED_TEMPLATES.find(t => t.id === rec.templateId)
        : ENRICHED_TEMPLATES.find(t => t.modality === rec.adherence.actualModality);
    if (!template) return null;
    return {
        date,
        costProfile: template.costProfile ?? ZERO_COST,
        trainingRecordLike: {
            type: rec.adherence.followed ? `${rec.modality} ${rec.category}` : `${rec.adherence.actualModality} training`,
            duration_min: rec.adherence.followed ? template.durationMin : (rec.adherence.actualDurationMin ?? template.durationMin),
            training_effect: 0,
            intensity_tag: '',
        },
    };
}

/** Reads the preceding rolling window oldest-to-newest. Only answered, completed
 * adherence contributes; unanswered and skipped days deliberately receive no credit. */
export async function reconstructRecentHistory(userId: string, throughDateExclusive: string, windowDays: number): Promise<CompletedExposure[]> {
    const exposures: CompletedExposure[] = [];
    for (let offset = windowDays; offset >= 1; offset--) {
        const date = addDaysToLocalDateString(throughDateExclusive, -offset);
        const exposure = exposureForRecommendation(date, await recommendationService.getRecommendation(userId, date));
        if (exposure) exposures.push(exposure);
    }
    return exposures;
}
