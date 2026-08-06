import type {
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    EngineObjectiveInput,
    SubjectiveInput,
    UserConstraint,
    UserContext,
    UserGoal,
} from './models';

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

    const rawY = snapshot.raw.yesterdayTraining;
    let yesterdayTrainingObj = null;
    if (rawY) {
        if (rawY.primaryActivity) {
            yesterdayTrainingObj = {
                type: rawY.primaryActivity.type,
                duration_min: rawY.primaryActivity.durationMin ?? 0,
                training_effect: rawY.primaryActivity.trainingEffect ?? 0,
                intensity_tag: rawY.primaryActivity.intensityTag ?? 'moderate/easy',
            };
        } else if (rawY.type) {
            yesterdayTrainingObj = {
                type: rawY.type,
                duration_min: rawY.durationMin ?? 0,
                training_effect: rawY.trainingEffect ?? 0,
                intensity_tag: rawY.intensityTag ?? 'moderate/easy',
            };
        }
    }

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
        body_battery_wake: snapshot.raw.bodyBatteryWake,
        last_3_days_hard_sessions_count: snapshot.raw.last3DaysHardSessionsCount,
        yesterday_training: yesterdayTrainingObj,
    };
}

/** Neutral (mid-scale) fallback for a 1-10 readiness dimension the user left blank. */
const NEUTRAL_SCALE_VALUE = 5;
/** Fallback session length (minutes) when today's check-in didn't specify availability. */
const DEFAULT_TIME_AVAILABLE_MIN = 45;

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
    };
}

/** Generous default so an unset "max session time" constraint doesn't silently cap today's availability. */
const DEFAULT_MAX_TIME_MINUTES = 180;

/**
 * Maps active goals and constraints (Firestore canonical models) to the internal
 * UserContext expected by the rules engine. Equipment/schedule/physical-caution
 * constraints are looked up by their stable predefined `key` (see
 * services/constraintService.ts PREDEFINED_CONSTRAINTS); custom constraints outside
 * that key set don't currently have an engine-side effect.
 */
export function mapContextFromGoalsAndConstraints(goals: UserGoal[], constraints: UserConstraint[]): UserContext {
    const topGoalTitle = (category: UserGoal['category']): string => {
        const inCategory = goals.filter(g => g.category === category);
        if (inCategory.length === 0) return '';
        return inCategory.reduce((best, g) => (g.priority > best.priority ? g : best)).title;
    };

    const findConstraint = (key: string): UserConstraint | undefined => constraints.find(c => c.key === key);
    const isEnabled = (key: string): boolean => {
        const c = findConstraint(key);
        return c ? c.value === true : false;
    };

    const maxTimeConstraint = findConstraint('max_time_minutes');
    const maxTimeMinutes = typeof maxTimeConstraint?.value === 'number' ? maxTimeConstraint.value : DEFAULT_MAX_TIME_MINUTES;

    const injuries = constraints
        .filter(c => c.category === 'physical_caution' && c.value === true)
        .map(c => c.displayName);

    return {
        goals: {
            shortTerm: topGoalTitle('short-term'),
            midTerm: topGoalTitle('mid-term'),
            longTerm: topGoalTitle('long-term'),
        },
        constraints: {
            hasCableMachine: isEnabled('has_cable_machine'),
            hasFreeWeights: isEnabled('has_free_weights'),
            hasTreadmill: isEnabled('has_treadmill'),
            hasIndoorBike: isEnabled('has_stationary_bike'),
            injuries,
            maxTimeMinutes,
        },
    };
}
