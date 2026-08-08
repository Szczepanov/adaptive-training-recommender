import type { DailyRecommendation, DeliveredDose, SessionTemplate, TrainingRecord, WorkoutCostProfile, WorkoutStimulusProfile } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { ENRICHED_TEMPLATES } from './templates';

/** A completed, adherence-backed exposure reconstructed for the rolling engine. */
export interface CompletedExposure {
    date: string;
    costProfile: WorkoutCostProfile;
    trainingRecordLike: TrainingRecord;
    deliveredDose?: DeliveredDose;
    /** Present only when the completed work is known to match a catalog template or
     * reconciled evidence supplies an explicit stimulus vector. This prevents the
     * microcycle ledger from re-inferring a precise objective from loose title text. */
    stimulusProfile?: WorkoutStimulusProfile;
    stimulusConfidence?: 'exact' | 'inferred' | 'unknown';
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

/**
 * Boundary around durable adherence history. Engine code depends on this small
 * contract, not on Firebase; production injects Firestore and tests inject fixtures.
 */
export interface TrainingHistoryProvider {
    reconstruct(userId: string, throughDateExclusive: string, windowDays: number): Promise<CompletedExposure[]>;
    /** New providers expose the exact bounded source revision used for reconstruction.
     * Kept optional while deterministic test fixtures use the legacy contract. */
    getSnapshot?(userId: string, throughDateExclusive: string, windowDays: number): Promise<TrainingHistorySnapshot>;
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
    return {
        date,
        costProfile: template.costProfile ?? ZERO_COST,
        trainingRecordLike,
        stimulusConfidence: rec.adherence.followed ? 'exact' : 'unknown',
        // An athlete who confirms the prescribed session was followed supplies an exact
        // catalog identity. A modified session does not, so it intentionally falls back
        // to the conservative unstructured-history path.
        ...(rec.adherence.followed && template.stimulusProfile
            ? { stimulusProfile: template.stimulusProfile, modality: template.modality, category: template.category }
            : {}),
    };
}
