import type {
    CompletedTrainingEvent,
    CompletedTrainingIntensity,
    DailyRecommendation,
    EvidenceTier,
    NormalizedGarminActivity,
    SessionTemplate,
    TrainingRecord,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import type { CompletedExposure } from './trainingHistory';
import type { StimulusConfidence } from './stimulus';
import { ENRICHED_TEMPLATES } from './templates';
import type { DeliveredDose } from './models';
import {
    derivePowerZoneStimulusCandidate,
    extractPowerZoneFeatures,
    isGarminCyclingPowerActivity,
    type GarminStimulusPolicy,
} from './garminTelemetryEvidence';

type CompletedModality = SessionTemplate['modality'] | 'Unknown';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
export const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    sprintPower: 0,
    fatigueResistance: 0,
    maxStrength: 0,
    hypertrophy: 0,
};
const ADHERENCE_DURATION_TOLERANCE_MIN = 20;
/** Completed duration is evidence that a planned dose was delivered, not permission to
 * invent arbitrarily deep load. Once the intended catalog dose is fully delivered, extra
 * elapsed time is retained in the activity record but does not multiply estimated cost. */
const MAX_DELIVERED_DURATION_SCALE = 1;

export const DEFAULT_COST_BY_MODALITY: Record<CompletedModality, Record<CompletedTrainingIntensity, WorkoutCostProfile>> = {
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
    const tag = activity.intensityTag.toLowerCase();
    if (tag === 'hard') return 'hard';
    if (tag === 'moderate') return 'moderate';
    if (tag === 'easy') return 'easy';
    const trainingEffect = Math.max(activity.trainingEffectAerobic ?? 0, activity.trainingEffectAnaerobic ?? 0);
    if (trainingEffect >= 3) return 'hard';
    if (trainingEffect >= 2) return 'moderate';
    return trainingEffect > 0 ? 'easy' : 'unknown';
}

// --- Evidence hierarchy (Phase 5.5) ---
// docs/plans/phase-5-sequence-planning.md 5.5: generalises the coarse modality x
// intensity inference below into a named, ordered hierarchy so every inferred profile
// carries a legible reason for how confident it is, not just a flat true/false.

/** Signals classifyGarminTier actually has available. `activityTrainingLoad` is Garmin's
 *  own proprietary composite (derived from HR/pace/power across the session) -- a
 *  materially different, richer signal than the coarse 0-5 trainingEffect scalar alone,
 *  even though it still isn't per-interval structure. `averageHr` is deliberately not
 *  consulted: a single session-average HR number without zone/interval context isn't
 *  meaningfully more informative than trainingEffect, and treating it as if it were would
 *  overclaim precision this data doesn't have. */
interface GarminEvidenceSignals {
    trainingEffectAerobic: number | null;
    trainingEffectAnaerobic: number | null;
    intensityTag: string;
    activityTrainingLoad: number | null;
    modalityKnown: boolean;
}

function classifyGarminTier(signals: GarminEvidenceSignals): EvidenceTier {
    const hasTrainingEffect = (signals.trainingEffectAerobic ?? 0) > 0 || (signals.trainingEffectAnaerobic ?? 0) > 0;
    const hasTrainingLoad = signals.activityTrainingLoad !== null && signals.activityTrainingLoad > 0;
    if (hasTrainingEffect && hasTrainingLoad) return 'measuredEffort';
    if (hasTrainingEffect) return 'garminTrainingEffect';
    if (signals.intensityTag.trim() !== '') return 'durationIntensity';
    if (signals.modalityKnown) return 'athleteClassification';
    return 'genericModalityFallback';
}

/** Maps a tier to the coarse 3-value confidence CompletedExposure.stimulusConfidence
 *  (and, downstream, stimulus.ts's CONFIDENCE_CREDIT_WEIGHT) already expects -- this is
 *  the "hook" Phase 1.2(c) added; this function is what finally drives it from something
 *  more legible than an ad hoc exact/modality/hasStimulus check. */
export function stimulusConfidenceForTier(tier: EvidenceTier): StimulusConfidence {
    switch (tier) {
        case 'exactPrescribedMatch':
        case 'completedStructuredWorkout':
            return 'exact';
        // `authoredExternal` sits here deliberately (ADR-0019 D-EXTTIER): an imported
        // session is structured and intentional, but its stimulus is derived from
        // modality x intensity rather than authored against this catalog, so it is
        // discounted exactly as an inferred Garmin session is.
        case 'measuredEffort':
        case 'garminTrainingEffect':
        case 'authoredExternal':
        case 'durationIntensity':
        case 'athleteClassification':
            return 'inferred';
        case 'genericModalityFallback':
            return 'unknown';
    }
}

function catalogIntensity(template: SessionTemplate): CompletedTrainingIntensity {
    const systemicCost = template.costProfile?.systemic ?? template.systemicCost;
    if (systemicCost >= 0.55) return 'hard';
    if (systemicCost >= 0.25) return 'moderate';
    return 'easy';
}

/** One scalar planning reference from a displayed duration range. The midpoint uses both
 * authored bounds and represents the intended dose without pretending either boundary is
 * the single prescription. */
function templateDurationReferenceMin(template: Pick<SessionTemplate, 'durationMin' | 'durationMax'>): number | undefined {
    const min = Number.isFinite(template.durationMin) && template.durationMin > 0 ? template.durationMin : undefined;
    const max = Number.isFinite(template.durationMax) && template.durationMax > 0 ? template.durationMax : undefined;
    if (min !== undefined && max !== undefined) return (min + Math.max(min, max)) / 2;
    return max ?? min;
}

/**
 * Uses a comparable catalog session as the duration reference instead of adding a
 * modality-wide duration constant. Unknown modalities deliberately have no invented
 * reference, so their cost remains unscaled until a better source exists.
 */
function catalogReferenceDurationMin(modality: CompletedModality, intensity: CompletedTrainingIntensity): number | undefined {
    const durations = ENRICHED_TEMPLATES
        .filter(template => template.modality === modality && catalogIntensity(template) === intensity)
        .map(templateDurationReferenceMin)
        .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration > 0)
        .sort((left, right) => left - right);
    if (durations.length === 0) return undefined;
    return durations[Math.floor(durations.length / 2)];
}

/**
 * Scales the existing six-dimensional base vector by the delivered evidence. A caller
 * may provide an independently measured completion ratio; when it is absent we do not
 * fabricate one from duration, because that would count the same partial session twice.
 * Duration scaling is capped at the fully delivered intended dose so an inflated or
 * unusually long recorded duration cannot create unbounded raw fatigue depth.
 */
export function scaleCostByDeliveredDose(
    costProfile: WorkoutCostProfile,
    dose: DeliveredDose,
): WorkoutCostProfile {
    const rawDurationScale = dose.plannedDurationMin && dose.plannedDurationMin > 0 && dose.completedDurationMin !== undefined
        ? Math.max(0, dose.completedDurationMin) / dose.plannedDurationMin
        : 1;
    const durationScale = Math.min(MAX_DELIVERED_DURATION_SCALE, rawDurationScale);
    const completionScale = dose.completionRatio === undefined
        ? 1
        : Math.max(0, Math.min(1, dose.completionRatio));
    const scale = durationScale * completionScale;
    return {
        systemic: costProfile.systemic * scale,
        cardiovascular: costProfile.cardiovascular * scale,
        lowerBody: costProfile.lowerBody * scale,
        upperBody: costProfile.upperBody * scale,
        impactTissue: costProfile.impactTissue * scale,
        neuromuscular: costProfile.neuromuscular * scale,
    };
}

function templateForRecommendation(recommendation: DailyRecommendation): SessionTemplate | undefined {
    return ENRICHED_TEMPLATES.find(template => template.id === recommendation.templateId);
}

function adherenceCandidate(recommendation: DailyRecommendation): { modality: CompletedModality; durationMin: number | null; plannedDurationMin: number | null; template?: SessionTemplate } | null {
    if (recommendation.adherence.followed === null || recommendation.adherence.skipped) return null;
    const template = templateForRecommendation(recommendation);
    if (recommendation.adherence.followed) {
        const plannedDurationMin = template ? templateDurationReferenceMin(template) ?? null : null;
        return {
            modality: recommendation.modality,
            durationMin: recommendation.adherence.actualDurationMin ?? plannedDurationMin,
            plannedDurationMin,
            template,
        };
    }
    if (!recommendation.adherence.actualModality) return null;
    return {
        modality: recommendation.adherence.actualModality,
        durationMin: recommendation.adherence.actualDurationMin,
        plannedDurationMin: null,
        template: undefined,
    };
}

function comparableDurationDifference(left: number | null, right: number | null): number {
    if (left === null || right === null) return 0;
    return Math.abs(left - right);
}

export const DEFAULT_STIMULUS_BY_MODALITY: Record<CompletedModality, Record<CompletedTrainingIntensity, WorkoutStimulusProfile>> = {
    Cycling: {
        easy: { aerobicEndurance: 0.55, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0, hypertrophy: 0 },
        moderate: { aerobicEndurance: 0.70, thresholdPower: 0.20, vo2MaxPower: 0.10, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.20, maxStrength: 0, hypertrophy: 0 },
        hard: { aerobicEndurance: 0.45, thresholdPower: 0.70, vo2MaxPower: 0.50, repeatedSurges: 0.65, sprintPower: 0.20, fatigueResistance: 0.50, maxStrength: 0, hypertrophy: 0 },
        unknown: { aerobicEndurance: 0.55, thresholdPower: 0.15, vo2MaxPower: 0, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0, hypertrophy: 0 },
    },
    Running: {
        easy: { aerobicEndurance: 0.55, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0, hypertrophy: 0 },
        moderate: { aerobicEndurance: 0.70, thresholdPower: 0.20, vo2MaxPower: 0.10, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.20, maxStrength: 0, hypertrophy: 0 },
        hard: { aerobicEndurance: 0.45, thresholdPower: 0.70, vo2MaxPower: 0.50, repeatedSurges: 0.65, sprintPower: 0.20, fatigueResistance: 0.50, maxStrength: 0, hypertrophy: 0 },
        unknown: { aerobicEndurance: 0.55, thresholdPower: 0.15, vo2MaxPower: 0, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0, hypertrophy: 0 },
    },
    Strength: {
        easy: { aerobicEndurance: 0.10, thresholdPower: 0.05, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.40, hypertrophy: 0.30 },
        moderate: { aerobicEndurance: 0.15, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.70, hypertrophy: 0.60 },
        hard: { aerobicEndurance: 0.20, thresholdPower: 0.20, vo2MaxPower: 0, repeatedSurges: 0.20, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.85, hypertrophy: 0.75 },
        unknown: { aerobicEndurance: 0.15, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.55, hypertrophy: 0.45 },
    },
    Field: {
        easy: { aerobicEndurance: 0.40, thresholdPower: 0.20, vo2MaxPower: 0.10, repeatedSurges: 0.25, sprintPower: 0.20, fatigueResistance: 0.10, maxStrength: 0.10, hypertrophy: 0.10 },
        moderate: { aerobicEndurance: 0.60, thresholdPower: 0.45, vo2MaxPower: 0.30, repeatedSurges: 0.50, sprintPower: 0.30, fatigueResistance: 0.30, maxStrength: 0.20, hypertrophy: 0.20 },
        hard: { aerobicEndurance: 0.50, thresholdPower: 0.70, vo2MaxPower: 0.60, repeatedSurges: 0.75, sprintPower: 0.40, fatigueResistance: 0.40, maxStrength: 0.30, hypertrophy: 0.30 },
        unknown: { aerobicEndurance: 0.50, thresholdPower: 0.40, vo2MaxPower: 0.20, repeatedSurges: 0.45, sprintPower: 0.30, fatigueResistance: 0.20, maxStrength: 0.20, hypertrophy: 0.20 },
    },
    Mobility: {
        easy: { aerobicEndurance: 0.10, thresholdPower: 0.05, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.05, hypertrophy: 0.05 },
        moderate: { aerobicEndurance: 0.15, thresholdPower: 0.05, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.10, hypertrophy: 0.10 },
        hard: { aerobicEndurance: 0.20, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.15, hypertrophy: 0.15 },
        unknown: { aerobicEndurance: 0.15, thresholdPower: 0.05, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.10, hypertrophy: 0.10 },
    },
    'Cross Training': {
        easy: { aerobicEndurance: 0.55, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.10, maxStrength: 0.10, hypertrophy: 0.10 },
        moderate: { aerobicEndurance: 0.70, thresholdPower: 0.20, vo2MaxPower: 0.10, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.15, maxStrength: 0.15, hypertrophy: 0.15 },
        hard: { aerobicEndurance: 0.50, thresholdPower: 0.65, vo2MaxPower: 0.40, repeatedSurges: 0.60, sprintPower: 0.20, fatigueResistance: 0.30, maxStrength: 0.20, hypertrophy: 0.20 },
        unknown: { aerobicEndurance: 0.60, thresholdPower: 0.20, vo2MaxPower: 0.10, repeatedSurges: 0.15, sprintPower: 0, fatigueResistance: 0.15, maxStrength: 0.15, hypertrophy: 0.15 },
    },
    None: { easy: ZERO_STIMULUS, moderate: ZERO_STIMULUS, hard: ZERO_STIMULUS, unknown: ZERO_STIMULUS },
    // Phase 5.5: this used to be all-zero, the literal asymmetry the plan calls out --
    // DEFAULT_COST_BY_MODALITY.Unknown above already charges real cost for an
    // unclassified session, while stimulus stayed at zero, so the system saw the fatigue
    // but not the fitness benefit. Deliberately conservative and aerobic-leaning (lower
    // magnitude than every known-modality table above) since genuinely nothing is known
    // about what quality of work happened -- see genericModalityFallback's stimulusConfidence
    // ('unknown') and CONFIDENCE_CREDIT_WEIGHT.unknown, which further discount how much
    // objective credit this is allowed to redeem.
    Unknown: {
        easy: { aerobicEndurance: 0.35, thresholdPower: 0.05, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.15, maxStrength: 0.05, hypertrophy: 0.05 },
        moderate: { aerobicEndurance: 0.50, thresholdPower: 0.15, vo2MaxPower: 0.05, repeatedSurges: 0.10, sprintPower: 0, fatigueResistance: 0.25, maxStrength: 0.10, hypertrophy: 0.10 },
        hard: { aerobicEndurance: 0.40, thresholdPower: 0.35, vo2MaxPower: 0.25, repeatedSurges: 0.30, sprintPower: 0.10, fatigueResistance: 0.35, maxStrength: 0.15, hypertrophy: 0.15 },
        unknown: { aerobicEndurance: 0.30, thresholdPower: 0.10, vo2MaxPower: 0, repeatedSurges: 0.05, sprintPower: 0, fatigueResistance: 0.15, maxStrength: 0.05, hypertrophy: 0.05 },
    },
};

function candidateEventFromGarmin(
    activity: NormalizedGarminActivity,
    garminStimulusPolicy: GarminStimulusPolicy,
): CompletedTrainingEvent {
    const modality = modalityFromActivityType(activity.type);
    const intensity = intensityFromGarmin(activity);
    const baseCost = DEFAULT_COST_BY_MODALITY[modality][intensity];
    const deliveredDose: DeliveredDose = {
        plannedDurationMin: catalogReferenceDurationMin(modality, intensity),
        completedDurationMin: activity.durationMin ?? undefined,
    };
    const evidenceTier = classifyGarminTier({
        trainingEffectAerobic: activity.trainingEffectAerobic,
        trainingEffectAnaerobic: activity.trainingEffectAnaerobic,
        intensityTag: activity.intensityTag,
        activityTrainingLoad: activity.activityTrainingLoad,
        modalityKnown: modality !== 'Unknown',
    });
    const trainingEffectStimulus = DEFAULT_STIMULUS_BY_MODALITY[modality][intensity];
    const zoneCandidate = garminStimulusPolicy === 'power_zones_direct_share_v1'
        && evidenceTier === 'measuredEffort'
        && isGarminCyclingPowerActivity(activity.type)
        ? derivePowerZoneStimulusCandidate(extractPowerZoneFeatures(activity), trainingEffectStimulus)
        : null;
    const effectiveModality = zoneCandidate && modality === 'Unknown' ? 'Cycling' : modality;
    return {
        id: `garmin:${activity.activityId}`,
        date: activity.date,
        durationMin: activity.durationMin,
        deliveredDose,
        modality: effectiveModality,
        intensity,
        trainingEffect: Math.max(activity.trainingEffectAerobic ?? 0, activity.trainingEffectAnaerobic ?? 0) || null,
        estimatedCost: scaleCostByDeliveredDose(baseCost, deliveredDose),
        estimatedStimulus: zoneCandidate ?? trainingEffectStimulus,
        exactTemplateMatch: false,
        sources: ['garmin'],
        confidence: effectiveModality === 'Unknown' ? 'medium' : 'high',
        evidenceTier,
        linkedActivityId: activity.activityId,
        linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
    };
}

function candidateEventFromAdherence(recommendation: DailyRecommendation, candidate: NonNullable<ReturnType<typeof adherenceCandidate>>): CompletedTrainingEvent {
    const intensity: CompletedTrainingIntensity = candidate.template?.systemicCost && candidate.template.systemicCost >= 0.55 ? 'hard' : 'moderate';
    const baseCost = candidate.template?.costProfile ?? DEFAULT_COST_BY_MODALITY[candidate.modality][intensity];
    const deliveredDose: DeliveredDose = {
        plannedDurationMin: candidate.plannedDurationMin ?? catalogReferenceDurationMin(candidate.modality, intensity),
        completedDurationMin: candidate.durationMin ?? undefined,
    };
    // No Garmin signals at all on this path -- either the athlete confirmed the exact
    // prescribed template (exactPrescribedMatch), or all that's known is a self-reported
    // modality with no measured evidence behind it (athleteClassification).
    const evidenceTier: EvidenceTier = candidate.template?.stimulusProfile ? 'exactPrescribedMatch' : 'athleteClassification';
    return {
        id: `adherence:${recommendation.date}`,
        date: recommendation.date,
        durationMin: candidate.durationMin,
        deliveredDose,
        modality: candidate.modality,
        intensity,
        trainingEffect: null,
        estimatedCost: scaleCostByDeliveredDose(baseCost, deliveredDose),
        estimatedStimulus: candidate.template?.stimulusProfile ?? DEFAULT_STIMULUS_BY_MODALITY[candidate.modality][intensity],
        exactTemplateMatch: !!candidate.template?.stimulusProfile,
        sources: ['adherence'],
        confidence: candidate.template ? 'medium' : 'low',
        evidenceTier,
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
    const intensity = event.intensity;
    const baseCost = recommendation.adherence.followed && candidate.template?.costProfile
        ? candidate.template.costProfile
        : DEFAULT_COST_BY_MODALITY[event.modality][intensity];
    const deliveredDose: DeliveredDose = {
        plannedDurationMin: candidate.plannedDurationMin ?? catalogReferenceDurationMin(event.modality, intensity),
        completedDurationMin: event.durationMin ?? undefined,
    };
    // An adherence-confirmed exact template match upgrades whatever Garmin-derived tier
    // this event already carried; otherwise the real measured Garmin evidence stands.
    const evidenceTier: EvidenceTier = recommendation.adherence.followed && candidate.template?.stimulusProfile
        ? 'exactPrescribedMatch'
        : (event.evidenceTier ?? 'garminTrainingEffect');
    return {
        ...event,
        sources: ['garmin', 'adherence'],
        confidence: 'high',
        evidenceTier,
        linkedRecommendationDate: recommendation.date,
        deliveredDose,
        // Garmin remains the measured duration/training-effect authority. Template
        // metadata improves dimensional cost/stimulus only when the athlete confirmed
        // the prescribed session was followed.
        estimatedCost: scaleCostByDeliveredDose(baseCost, deliveredDose),
        estimatedStimulus: recommendation.adherence.followed && candidate.template?.stimulusProfile
            ? candidate.template.stimulusProfile
            : event.estimatedStimulus,
        exactTemplateMatch: !!(recommendation.adherence.followed && candidate.template?.stimulusProfile),
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
    options: { garminStimulusPolicy?: GarminStimulusPolicy } = {},
): CompletedTrainingEvent[] {
    const garminStimulusPolicy = options.garminStimulusPolicy ?? 'training_effect';
    const events = activities
        .map(activity => candidateEventFromGarmin(activity, garminStimulusPolicy))
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
    const hasStimulus = Object.values(event.estimatedStimulus ?? {}).some(v => (v ?? 0) > 0);
    // Phase 5.5: driven by the named evidence tier rather than an ad hoc
    // exact/hasStimulus/modality check -- event.evidenceTier is the source of truth when
    // present; the exactTemplateMatch/hasStimulus fallback only covers legacy/test
    // construction paths that predate this field.
    const tier: EvidenceTier = event.evidenceTier
        ?? (event.exactTemplateMatch ? 'exactPrescribedMatch' : (hasStimulus && modality ? 'garminTrainingEffect' : 'genericModalityFallback'));
    const confidence = stimulusConfidenceForTier(tier);

    return {
        date: event.date,
        costProfile: event.estimatedCost,
        trainingRecordLike: record,
        ...(event.deliveredDose ? { deliveredDose: event.deliveredDose } : {}),
        stimulusConfidence: confidence,
        // A stimulus profile no longer requires a *known* modality to be attached (Phase
        // 5.5) -- genericModalityFallback still carries a real, if conservative, profile
        // (see DEFAULT_STIMULUS_BY_MODALITY.Unknown) that can credit a modality-agnostic
        // objective. `modality` itself is only ever set when genuinely known, so a
        // modality-SCOPED objective still can't be satisfied by this
        // (deriveObjectiveCreditFromProfile fails closed on that -- see stimulus.ts).
        ...(hasStimulus ? {
            stimulusProfile: { ...ZERO_STIMULUS, ...event.estimatedStimulus },
        } : {}),
        ...(modality ? { modality } : {}),
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
