import type {
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    EngineObjectiveInput,
    RawActivitySummary,
    SubjectiveInput,
    TrainingRecord,
    UserContext,
    UserEvent,
    UserGoal,
    UserPreferences,
    TrainingSettings,
} from './models';
import { resolveInjuryRestrictions, resolveEffectiveInjuryConstraints } from './injuryPolicy';
import { goalToUserEvent } from './periodization';
import { getLocalDateString } from '../utils/localDate';

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
 * Maps the Firestore canonical model (DailyRecoverySnapshot) to the internal engine
 * input model (EngineObjectiveInput) expected by the rules engine.
 * This decouples the rules engine from the Firestore schema.
 */
export function mapSnapshotToEngineInput(snapshot: DailyRecoverySnapshot): EngineObjectiveInput {
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
        (snapshot.derived.baselineComputationVersion ?? 0) >= 3
        && snapshot.derived.respiration28dMad !== null
        && snapshot.derived.respiration28dMad !== undefined;

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
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        };
    }

    return {
        readiness: checkin.readiness ?? NEUTRAL_SCALE_VALUE,
        sleepQuality: checkin.sleepQuality ?? NEUTRAL_SCALE_VALUE,
        fatigue: checkin.fatigue ?? NEUTRAL_SCALE_VALUE,
        soreness: checkin.soreness ?? NEUTRAL_SCALE_VALUE,
        stress: checkin.mentalStress ?? NEUTRAL_SCALE_VALUE,
        motivation: checkin.motivation ?? NEUTRAL_SCALE_VALUE,
        timeAvailable: checkin.availability?.timeAvailableMin ?? DEFAULT_TIME_AVAILABLE_MIN,
        painFlag: checkin.painOrInjury || checkin.illnessSymptoms,
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
    const effectiveInjuries = resolveEffectiveInjuryConstraints(trainingSettings.injuries, todaysCheckin?.tissueResponses, dateStr);
    const resolvedInjuries = resolveInjuryRestrictions(effectiveInjuries, dateStr);
    const restrictedModalities = Array.from(new Set([
        ...resolvedInjuries.restrictedModalities,
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
            impliedGuardrails: resolvedInjuries.impliedGuardrails,
            restrictedCategories: resolvedInjuries.restrictedCategories,
            maxTimeMinutes: trainingSettings.defaults.weekdayMaxMinutes ?? trainingSettings.defaults.weekendMaxMinutes ?? DEFAULT_MAX_TIME_MINUTES,
        },
        preferences: {
            avoidedModalities: preferences?.avoidedModalities ?? [],
            deprioritizedModalities: preferences?.deprioritizedModalities ?? preferences?.avoidedModalities ?? [],
            preferredModalities: preferences?.preferredModalities ?? [],
            conservativeBias: preferences?.conservativeBias ?? false,
            preferredRecoveryStyle: preferences?.preferredRecoveryStyle,
        },
        trainingSettings,
    };
}
