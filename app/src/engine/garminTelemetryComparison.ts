import type { NormalizedGarminActivity, ObjectiveKey, WeeklyObjective, WorkoutStimulusProfile } from './models';
import { reconcileCompletedTrainingEvents } from './completedTraining';
import { deriveObjectiveCreditFromProfile } from './stimulus';
import { extractPowerZoneFeatures, isGarminCyclingPowerActivity, POWER_ZONE_CANDIDATE_POLICY } from './garminTelemetryEvidence';

const COMPARED_OBJECTIVES: ObjectiveKey[] = [
    'zone2_aerobic', 'threshold_quality', 'vo2_max', 'surge_repeatability', 'race_specific_endurance',
];

export interface GarminZoneCreditComparisonRow {
    ordinal: number;
    coverage: ReturnType<typeof extractPowerZoneFeatures>['coverage'];
    candidateEligible: boolean;
    fallbackReason?: ReturnType<typeof extractPowerZoneFeatures>['fallbackReason'] | 'below_measured_effort' | 'non_cycling';
    durationCoverageRatio?: number;
    trainingEffectCredit: Record<string, number>;
    candidateCredit: Record<string, number>;
    creditDelta: Record<string, number>;
}

export interface GarminZoneCreditComparison {
    candidatePolicyId: typeof POWER_ZONE_CANDIDATE_POLICY;
    activityCount: number;
    eligibleActivityCount: number;
    fallbackActivityCount: number;
    disagreementActivityCount: number;
    meanAbsoluteCreditDelta: number;
    rows: GarminZoneCreditComparisonRow[];
}

function objective(key: ObjectiveKey): WeeklyObjective {
    return {
        id: `comparison:${key}`, key, title: key, requiredCredit: 1,
        targetExposures: 1, completedExposures: 0, targetStimulus: {},
    };
}

function creditByObjective(
    stimulus: WorkoutStimulusProfile,
    event: ReturnType<typeof reconcileCompletedTrainingEvents>[number],
): Record<string, number> {
    return Object.fromEntries(COMPARED_OBJECTIVES.map(key => [
        key,
        deriveObjectiveCreditFromProfile(
            objective(key), stimulus, event.deliveredDose,
            { modality: event.modality === 'Unknown' ? undefined : event.modality },
            'inferred',
        ).earnedCredit,
    ]));
}

/** Builds a de-identified comparison: rows use an ordinal and contain no activity ID,
 * date, title, HR, or raw provider payload. */
export function compareGarminZoneCredit(activities: readonly NormalizedGarminActivity[]): GarminZoneCreditComparison {
    const rows = activities.map((activity, index): GarminZoneCreditComparisonRow => {
        const features = extractPowerZoneFeatures(activity);
        const trainingEffectEvent = reconcileCompletedTrainingEvents([activity], [], { garminStimulusPolicy: 'training_effect' })[0];
        const candidateEvent = reconcileCompletedTrainingEvents([activity], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' })[0];
        const candidateEligible = features.candidateEligible
            && trainingEffectEvent.evidenceTier === 'measuredEffort'
            && isGarminCyclingPowerActivity(activity.type);
        const fallbackReason = features.fallbackReason
            ?? (trainingEffectEvent.evidenceTier !== 'measuredEffort' ? 'below_measured_effort' : undefined)
            ?? (!isGarminCyclingPowerActivity(activity.type) ? 'non_cycling' : undefined);
        const trainingEffectCredit = creditByObjective(trainingEffectEvent.estimatedStimulus as WorkoutStimulusProfile, trainingEffectEvent);
        const candidateCredit = creditByObjective(candidateEvent.estimatedStimulus as WorkoutStimulusProfile, candidateEvent);
        const creditDelta = Object.fromEntries(COMPARED_OBJECTIVES.map(key => [
            key,
            Math.round(((candidateCredit[key] ?? 0) - (trainingEffectCredit[key] ?? 0)) * 100) / 100,
        ]));
        return {
            ordinal: index + 1, coverage: features.coverage, candidateEligible,
            ...(fallbackReason ? { fallbackReason } : {}),
            ...(features.durationCoverageRatio !== undefined ? { durationCoverageRatio: features.durationCoverageRatio } : {}),
            trainingEffectCredit, candidateCredit, creditDelta,
        };
    });
    const deltas = rows.flatMap(row => Object.values(row.creditDelta));
    return {
        candidatePolicyId: POWER_ZONE_CANDIDATE_POLICY,
        activityCount: rows.length,
        eligibleActivityCount: rows.filter(row => row.candidateEligible).length,
        fallbackActivityCount: rows.filter(row => !row.candidateEligible).length,
        disagreementActivityCount: rows.filter(row => Object.values(row.creditDelta).some(delta => Math.abs(delta) >= 0.01)).length,
        meanAbsoluteCreditDelta: deltas.length === 0
            ? 0
            : Math.round((deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length) * 1000) / 1000,
        rows,
    };
}
