import type {
    BodyRegion,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    ClinicalEnvelopeSource,
    EngineObjectiveInput,
    InjuryRegionMappingFamily,
    RawActivitySummary,
    SubjectiveInput,
    TrainingRecord,
    UserContext,
    UserEvent,
    UserGoal,
    UserPreferences,
    TrainingSettings,
} from './models';
import { injuryRegionMappingFamily, resolveInjuryPolicy } from './injuryPolicy';
import { goalToUserEvent } from './periodization';
import { getLocalDateString } from '../utils/localDate';
import type { HealthSymptomType } from './healthAnomalyModels';

/**
 * Deliberately narrow presentation for which an athlete's self-attributed allergy cause may
 * soften the legacy illness gate. Broader respiratory or systemic symptoms stay conservative:
 * the check-in does not diagnose allergy or rule out infection/EIB/asthma.
 */
const ALLERGY_COMPATIBLE_SYMPTOM_TYPES: readonly HealthSymptomType[] = [
    'congestion',
    'runny_nose',
    'sneezing',
];

/**
 * Explicit mild/moderate nasal allergy symptoms don't get the same clinical restriction as an
 * injury or undifferentiated illness. This is intentionally fail-closed: unknown severity,
 * absent symptom detail, any non-nasal symptom type, an uncertain/infectious cause, or severe
 * symptoms keep today's conservative `painFlag` behavior unchanged.
 */
function isAllergyLikeSymptomDay(checkin: DailySubjectiveCheckin): boolean {
    const symptoms = checkin.healthContext?.symptoms;
    if (!symptoms?.present || symptoms.suspectedCause !== 'allergy') return false;
    if (symptoms.severity !== 'mild' && symptoms.severity !== 'moderate') return false;
    if (!symptoms.types || symptoms.types.length === 0) return false;
    if (!symptoms.types.every(type => ALLERGY_COMPATIBLE_SYMPTOM_TYPES.includes(type))) return false;
    return true;
}

/** Compact origin facts for the normalized clinical envelope. This deliberately records
 * only the branch category, not raw symptoms, severity, text, or a diagnosis. */
export function resolveClinicalEnvelopeSources(
    checkin: DailySubjectiveCheckin | null | undefined,
): ClinicalEnvelopeSource[] {
    if (!checkin) return [];
    const sources: ClinicalEnvelopeSource[] = [];
    if (checkin.painOrInjury) sources.push('pain_or_injury');
    if (checkin.illnessSymptoms && !isAllergyLikeSymptomDay(checkin)) sources.push('non_allergy_illness');
    return sources;
}

/**
 * Decision-facing location context for the *current* pain/injury report only.
 *
 * Standing InjuryConstraint[] deliberately do not enter this value: they already produce
 * their own hard restrictions through resolveInjuryPolicy and are retained separately in
 * InjuryPolicyTrace for evidence lineage. This prevents an unrelated standing shoulder,
 * hip, or back constraint from being mistaken for the location of a new unstructured pain
 * report and accidentally clearing the generic Running fallback.
 */
export function resolvePainOrInjuryRegionFamilies(
    checkin: DailySubjectiveCheckin | null | undefined,
): InjuryRegionMappingFamily[] {
    if (!checkin?.painOrInjury || !checkin.tissueResponses) return [];
    const families = Object.entries(checkin.tissueResponses)
        .filter(([, response]) => response !== undefined)
        .map(([region]) => injuryRegionMappingFamily(region as BodyRegion));
    return Array.from(new Set(families)).sort();
}

/** Normalizes a raw Garmin per-day activity summary (yesterday's or today's) into the
 * engine's TrainingRecord shape, or null if no qualifying activity data is present. */
function mapTrainingRecord(raw: RawActivitySummary | null | undefined): TrainingRecord | null {
    if (!raw) return null;

    if (raw.primaryActivity) {
        return {
            type: raw.primaryActivity.type,
            duration_min: raw.primaryActivity.durationMin ?? 0,
            training_effect: raw.primaryActivity.trainingEffect ?? 0,
            intensity_tag: raw.primaryActivity.intensityTag ?? 'moderate/easy',
        };
    }
    return null;
}

/**
 * Respiration scoring is deliberately default-off until historical replay/sensitivity
 * establishes a weight/noise-floor policy. The non-default member exists so comparison
 * tooling can exercise the real engine path without creating a second implementation.
 */
export type RespirationStrainPolicy = 'off' | 'median-mad-v1';

/**
 * Maps the Firestore canonical model (DailyRecoverySnapshot) to the internal engine
 * input model (EngineObjectiveInput) expected by the rules engine.
 * This decouples the rules engine from the Firestore schema.
 */
export function mapSnapshotToEngineInput(
    snapshot: DailyRecoverySnapshot,
    respirationStrainPolicy: RespirationStrainPolicy = 'off',
): EngineObjectiveInput {
    // Determine the sleep_min: convert from seconds
    const sleepDurationMin = snapshot.raw.sleepDurationSec
        ? Math.round(snapshot.raw.sleepDurationSec / 60)
        : null;

    // Respiration deltas existed before the v3 median/MAD cutover, but those legacy deltas
    // were computed against mean baselines. They must never enter the v3 robust-scoring
    // path. A v3+ snapshot with no 28d MAD is also intentionally inert: substituting the
    // scoring floor for an unavailable spread estimate would fabricate confidence rather
    // than represent a measured personal baseline.
    const hasRespirationMedianMadBaseline =
        respirationStrainPolicy === 'median-mad-v1'
        && (snapshot.derived.baselineComputationVersion ?? 0) >= 3
        && snapshot.derived.respiration28dMad !== null
        && snapshot.derived.respiration28dMad !== undefined;

    // Phase 2 sleep-decision-authority fields (shadow/observation-only, feeds
    // sleepRecoveryEvidence.ts only) -- absent entirely on documents predating
    // baselineComputationVersion 6, not merely null, so gate on the version rather than
    // trusting individual field presence.
    const hasSleepDecisionAuthorityBaseline = (snapshot.derived.baselineComputationVersion ?? 0) >= 6;
    const secToMin = (sec: number | null | undefined): number | null =>
        sec === null || sec === undefined ? null : sec / 60;

    return {
        total_steps: snapshot.raw.totalSteps,
        sleep_score: snapshot.raw.sleepScore,
        sleep_duration_min: sleepDurationMin,
        rhr: snapshot.raw.restingHr,
        rhr_7d_avg: snapshot.derived.restingHr7dAvg,
        rhr_delta: snapshot.derived.deltas.restingHrVs7d,
        hrv_weekly_avg: snapshot.derived.hrv7dAvg, // engine used hrv_weekly_avg, maps to 7dAvg
        hrv_last_night: snapshot.raw.hrvOvernightAvg,
        hrv_delta: snapshot.derived.deltas.hrvVs7d,
        respiration: snapshot.raw.respirationAvg,
        respiration_delta: hasRespirationMedianMadBaseline
            ? snapshot.derived.deltas.respirationVs7d
            : null,
        respiration_delta_28d: hasRespirationMedianMadBaseline
            ? snapshot.derived.deltas.respirationVs28d
            : null,
        respiration_mad_28d: hasRespirationMedianMadBaseline
            ? snapshot.derived.respiration28dMad ?? null
            : null,
        body_battery_wake: snapshot.raw.bodyBatteryWake,
        last_3_days_hard_sessions_count: snapshot.raw.last3DaysHardSessionsCount,
        yesterday_training: mapTrainingRecord(snapshot.raw.yesterdayTraining),
        today_training: mapTrainingRecord(snapshot.raw.todayTraining),

        sleep_score_delta_7d: snapshot.derived.deltas.sleepScoreVs7d,
        rhr_delta_28d: snapshot.derived.deltas.restingHrVs28d,
        hrv_delta_28d: snapshot.derived.deltas.hrvVs28d,
        sleep_score_delta_28d: snapshot.derived.deltas.sleepScoreVs28d,
        steps_7d_avg: snapshot.derived.steps7dAvg ?? null,
        steps_28d_avg: snapshot.derived.steps28dAvg ?? null,
        steps_delta_7d: snapshot.derived.deltas.stepsVs7d ?? null,
        steps_delta_28d: snapshot.derived.deltas.stepsVs28d ?? null,
        // ?? null normalizes documents written before baselineComputationVersion 2,
        // where these fields are absent (undefined) rather than explicitly null.
        hrv_stdev_28d: snapshot.derived.hrv28dStdev ?? null,
        rhr_stdev_28d: snapshot.derived.restingHr28dStdev ?? null,
        sleep_score_stdev_28d: snapshot.derived.sleepScore28dStdev ?? null,
        steps_stdev_28d: snapshot.derived.steps28dStdev ?? null,

        sleep_duration_delta_7d_min: hasSleepDecisionAuthorityBaseline
            ? secToMin(snapshot.derived.deltas.sleepDurationVs7dMedian)
            : null,
        sleep_duration_delta_28d_min: hasSleepDecisionAuthorityBaseline
            ? secToMin(snapshot.derived.deltas.sleepDurationVs28dMedian)
            : null,
        sleep_duration_accumulated_2d_deficit_min: hasSleepDecisionAuthorityBaseline
            ? secToMin(snapshot.derived.sleepDurationAccumulated2dDeficitSec)
            : null,
        sleep_duration_accumulated_3d_deficit_min: hasSleepDecisionAuthorityBaseline
            ? secToMin(snapshot.derived.sleepDurationAccumulated3dDeficitSec)
            : null,
        // Already minutes on the Python side (circular time-of-day arithmetic) -- no
        // seconds-to-minutes conversion, unlike the duration/deficit fields above.
        bedtime_deviation_7d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.bedtimeDeviationVs7dMinutes ?? null
            : null,
        bedtime_deviation_28d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.bedtimeDeviationVs28dMinutes ?? null
            : null,
        wake_time_deviation_7d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.wakeTimeDeviationVs7dMinutes ?? null
            : null,
        wake_time_deviation_28d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.wakeTimeDeviationVs28dMinutes ?? null
            : null,
        sleep_midpoint_deviation_7d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.sleepMidpointDeviationVs7dMinutes ?? null
            : null,
        sleep_midpoint_deviation_28d_min: hasSleepDecisionAuthorityBaseline
            ? snapshot.derived.deltas.sleepMidpointDeviationVs28dMinutes ?? null
            : null,
    };
}

/** Neutral (mid-scale) fallback for a 1-10 readiness dimension the user left blank. */
const NEUTRAL_SCALE_VALUE = 5;
/** Fallback session length (minutes) when today's check-in didn't specify availability. */
const DEFAULT_TIME_AVAILABLE_MIN = 45;

/** Converts persisted goals into the event inputs consumed by periodization. Lifecycle
 * eligibility deliberately stays in evaluatePeriodizationPhase so stale/completed/DNF
 * events remain visible to its result rather than being silently discarded here. */
export function mapGoalsToUserEvents(goals: UserGoal[]): UserEvent[] {
    return goals
        .map(goalToUserEvent)
        .filter((event): event is UserEvent => event !== null);
}

/**
 * Maps the Firestore canonical model (DailySubjectiveCheckin) to the internal engine
 * input model (SubjectiveInput) expected by the rules engine. Missing 1-10 dimensions
 * default to a neutral midpoint rather than 0, so an incomplete check-in doesn't read
 * as "worst possible" fatigue/soreness/etc. to the engine.
 */
export function mapCheckinToSubjectiveInput(checkin: DailySubjectiveCheckin | null): SubjectiveInput {
    if (!checkin) {
        return {
            readiness: NEUTRAL_SCALE_VALUE,
            sleepQuality: NEUTRAL_SCALE_VALUE,
            fatigue: NEUTRAL_SCALE_VALUE,
            soreness: NEUTRAL_SCALE_VALUE,
            stress: NEUTRAL_SCALE_VALUE,
            motivation: NEUTRAL_SCALE_VALUE,
            timeAvailable: DEFAULT_TIME_AVAILABLE_MIN,
            painFlag: false,
            clinicalEnvelopeSources: [],
            painOrInjuryRegionFamilies: [],
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        };
    }

    const clinicalEnvelopeSources = resolveClinicalEnvelopeSources(checkin);
    return {
        readiness: checkin.readiness ?? NEUTRAL_SCALE_VALUE,
        sleepQuality: checkin.sleepQuality ?? NEUTRAL_SCALE_VALUE,
        fatigue: checkin.fatigue ?? NEUTRAL_SCALE_VALUE,
        soreness: checkin.soreness ?? NEUTRAL_SCALE_VALUE,
        stress: checkin.mentalStress ?? NEUTRAL_SCALE_VALUE,
        motivation: checkin.motivation ?? NEUTRAL_SCALE_VALUE,
        timeAvailable: checkin.availability?.timeAvailableMin ?? DEFAULT_TIME_AVAILABLE_MIN,
        painFlag: clinicalEnvelopeSources.length > 0,
        clinicalEnvelopeSources,
        painOrInjuryRegionFamilies: resolvePainOrInjuryRegionFamilies(checkin),
        alreadyTrainedToday: checkin.alreadyTrainedToday ?? false,
        preferredModalityToday: checkin.availability?.preferredModalityToday ?? null,
    };
}

/** Generous default so an unset "max session time" constraint doesn't silently cap today's availability. */
const DEFAULT_MAX_TIME_MINUTES = 180;

/**
 * Maps active goals and typed training settings (Firestore canonical models) to the internal
 * UserContext expected by the rules engine. Equipment/schedule/physical-caution
 * `preferences` was previously not threaded through to the engine at all -- its
 * modality lists and conservativeBias existed only in Firestore/the Preferences screen.
 * Null (no preferences record yet) maps to all-empty/false, matching
 * preferencesService's own defaults.
 *
 * `todaysCheckin` feeds Phase 5.4's per-region tissue response into the injury gate: it
 * may only tighten the standing InjuryConstraint[] for today's decision, never persisted
 * back (see injuryPolicy.ts resolveEffectiveInjuryConstraints). Wearable-derived
 * readiness plays no part here at all -- it acts through the separate fatigue/mode
 * pipeline, so it cannot loosen what tissue response or the injury constraint decided.
 */
export function mapContextFromGoalsAndTrainingSettings(
    goals: UserGoal[],
    trainingSettings: TrainingSettings,
    preferences: UserPreferences | null,
    today?: string,
    todaysCheckin?: DailySubjectiveCheckin | null
): UserContext {
    const topGoalTitle = (category: UserGoal['category']): string => {
        const inCategory = goals.filter(g => g.category === category);
        if (inCategory.length === 0) return '';
        return inCategory.reduce((best, g) => (g.priority > best.priority ? g : best)).title;
    };

    const dateStr = today ?? getLocalDateString();
    const injuryPolicy = resolveInjuryPolicy(trainingSettings.injuries, todaysCheckin?.tissueResponses, dateStr);
    const restrictedModalities = Array.from(new Set([
        ...injuryPolicy.restrictions.restrictedModalities,
        ...(preferences?.unavailableModalities ?? []),
    ]));

    return {
        goals: {
            shortTerm: topGoalTitle('short-term'),
            midTerm: topGoalTitle('mid-term'),
            longTerm: topGoalTitle('long-term'),
        },
        constraints: {
            hasCableMachine: trainingSettings.equipment.cable_machine,
            hasFreeWeights: trainingSettings.equipment.free_weights,
            hasTreadmill: trainingSettings.equipment.treadmill,
            hasIndoorBike: trainingSettings.equipment.indoor_bike,
            restrictedModalities,
            impliedGuardrails: injuryPolicy.restrictions.impliedGuardrails,
            restrictedCategories: injuryPolicy.restrictions.restrictedCategories,
            maxTimeMinutes: trainingSettings.defaults.weekdayMaxMinutes ?? trainingSettings.defaults.weekendMaxMinutes ?? DEFAULT_MAX_TIME_MINUTES,
        },
        preferences: {
            avoidedModalities: preferences?.avoidedModalities ?? [],
            deprioritizedModalities: preferences?.deprioritizedModalities ?? preferences?.avoidedModalities ?? [],
            preferredModalities: preferences?.preferredModalities ?? [],
            conservativeBias: preferences?.conservativeBias ?? false,
            preferredRecoveryStyle: preferences?.preferredRecoveryStyle,
        },
        injuryPolicyTrace: {
            ...injuryPolicy.trace,
            clinicalEnvelopeSources: resolveClinicalEnvelopeSources(todaysCheckin),
        },
        trainingSettings,
    };
}
