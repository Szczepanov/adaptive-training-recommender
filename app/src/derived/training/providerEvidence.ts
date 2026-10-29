import type { EvidenceTier } from '../../ledger/models';

export const GARMIN_CYCLING_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
    'cycling', 'cyclocross', 'gravel_cycling', 'indoor_cycling',
    'mountain_biking', 'road_biking', 'virtual_ride',
]);

/** Canonical Garmin cycling typeKey vocabulary (e.g. `road_biking`, `virtual_ride`). Every
 * modality classifier must accept these explicitly: substring matching on "cycl"/"bike"
 * misses `road_biking`, `mountain_biking` and `virtual_ride`. */
export function isGarminCyclingActivityType(type: string): boolean {
    return GARMIN_CYCLING_ACTIVITY_TYPES.has(type.trim().toLowerCase());
}

/** Signals classifyGarminTier actually has available. `activityTrainingLoad` is Garmin's
 *  own proprietary composite (derived from HR/pace/power across the session) -- a
 *  materially different, richer signal than the coarse 0-5 trainingEffect scalar alone,
 *  even though it still isn't per-interval structure. `averageHr` is deliberately not
 *  consulted: a single session-average HR number without zone/interval context isn't
 *  meaningfully more informative than trainingEffect, and treating it as if it were would
 *  overclaim precision this data doesn't have. */
export interface GarminEvidenceSignals {
    trainingEffectAerobic: number | null;
    trainingEffectAnaerobic: number | null;
    intensityTag: string;
    activityTrainingLoad: number | null;
    modalityKnown: boolean;
}

/** Classifies a Garmin activity's evidence tier from its available summary signals.
 * Shared across live completed-training derivation, canonical performed-training facts,
 * and shadow history diffs so evidence-tier classification has a single owner. */
export function classifyGarminTier(signals: GarminEvidenceSignals): EvidenceTier {
    const hasTrainingEffect = (signals.trainingEffectAerobic ?? 0) > 0 || (signals.trainingEffectAnaerobic ?? 0) > 0;
    const hasTrainingLoad = signals.activityTrainingLoad !== null && signals.activityTrainingLoad > 0;
    if (hasTrainingEffect && hasTrainingLoad) return 'measuredEffort';
    if (hasTrainingEffect) return 'garminTrainingEffect';
    if (signals.intensityTag && signals.intensityTag.trim() !== '') return 'durationIntensity';
    if (signals.modalityKnown) return 'athleteClassification';
    return 'genericModalityFallback';
}
