// --- Engine Input Models ---
export interface SubjectiveInput {
    readiness: number; // 1-10
    sleepQuality: number; // 1-10
    fatigue: number; // 1-10
    soreness: number; // 1-10
    stress: number; // 1-10
    motivation: number; // 1-10
    timeAvailable: number; // Minutes
    painFlag: boolean;     // Injury/Pain flag
    alreadyTrainedToday: boolean; // User-reported: a session was already completed today
    /** Today's explicit modality ask from the check-in (e.g. 'Running', 'Strength',
     *  'Mobility'), or null for no preference. Compared case-insensitively against
     *  SessionTemplate.modality -- see rules.ts applyModalityPreference. A value with no
     *  matching template in the catalog (e.g. 'Swimming') simply can't be honored; the
     *  engine says so in the rationale rather than silently ignoring it. */
    preferredModalityToday: string | null;
}

/** A completed training session summary, as reported for a specific day (yesterday or today). */
export interface TrainingRecord {
    type: string;
    duration_min: number;
    training_effect: number;
    intensity_tag: string;
}

export interface EngineObjectiveInput {
    total_steps: number | null;
    sleep_score: number | null;
    sleep_duration_min: number | null;
    rhr: number | null;
    rhr_7d_avg: number | null;
    rhr_delta: number | null;
    hrv_weekly_avg: number | null;
    hrv_last_night: number | null;
    hrv_delta: number | null;
    respiration: number | null;
    body_battery_wake: number | null;
    last_3_days_hard_sessions_count: number;
    yesterday_training: TrainingRecord | null;
    /** Garmin-detected activity synced for *today's* date (requires a re-sync after training to appear). */
    today_training: TrainingRecord | null;

    // --- Baseline-relative strain inputs (see rules.ts metricStrain) ---
    /** Current sleep score vs its own trailing 7d baseline (current - avg7d). Unlike
     *  rhr_delta/hrv_delta above, sleep score previously had no delta mapped at all --
     *  the engine only ever saw the absolute value. */
    sleep_score_delta_7d: number | null;
    /** Current vs the person's trailing 28-day baseline. Combined with the *Vs7d delta
     *  above, this reconstructs the 7d-vs-28d baseline drift (a slow, multi-day trend)
     *  algebraically as (delta_28d - delta_7d), without needing the raw 7d/28d averages
     *  themselves in the engine. */
    rhr_delta_28d: number | null;
    hrv_delta_28d: number | null;
    sleep_score_delta_28d: number | null;
    /** This person's own trailing 28-day population stdev per metric -- normalizes a
     *  raw delta into "how unusual is this for *this* person" instead of comparing
     *  everyone against the same fixed absolute number. Null until 14+ days of history
     *  exist (see DerivedMetrics.hrv28dStdev on the Python side). */
    hrv_stdev_28d: number | null;
    rhr_stdev_28d: number | null;
    sleep_score_stdev_28d: number | null;
}

export interface DailyReadiness {
    subjective: SubjectiveInput;
    objective: EngineObjectiveInput;
}

export interface UserContext {
    goals: {
        shortTerm: string;
        midTerm: string;
        longTerm: string;
    };
    constraints: {
        hasCableMachine: boolean;
        hasFreeWeights: boolean;
        hasTreadmill: boolean;
        hasIndoorBike: boolean;
        injuries: string[];
        maxTimeMinutes: number;
    };
    /** From UserPreferences -- previously collected in Firestore but never reaching the
     *  engine at all. Compared case-insensitively against SessionTemplate.modality. */
    preferences: {
        /** Soft de-prioritize / dislike: avoided modalities apply ranking penalties (see rules.ts). */
        avoidedModalities: string[];
        /** Soft de-prioritize: only selected if no non-deprioritized option survives
         *  today's mode/constraint filtering. */
        deprioritizedModalities: string[];
        preferredModalities: string[];
        /** Nudges the strain score toward caution -- see rules.ts CONSERVATIVE_BIAS_STRAIN_OFFSET. */
        conservativeBias: boolean;
        /** Renamed semantic preferred field: tunes borderline decision boundaries. */
        extraRecoveryMargin?: boolean;
    };
}

export type LocationContext = 'home' | 'gym' | 'travel';

export interface LocationProfile {
    id: LocationContext;
    displayName: string;
    availableEquipment: string[];
}

export interface DayOfWeekSchedule {
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun, 1 = Mon...
    defaultMaxTimeMin: number;
    preferredLocation: LocationContext;
}

export interface FixedActivity {
    id: string;
    title: string;
    date: string; // YYYY-MM-DD
    startTime?: string;
    durationMin: number;
    expectedStimulus?: Record<string, number>;
    expectedCost?: Record<string, number>;
    isCompleted: boolean;
}

export type EventPriority = 'A' | 'B' | 'C';
export type EventLifecycle = 'scheduled' | 'completed' | 'cancelled' | 'DNS' | 'DNF' | 'rescheduled';

export interface EventDemandProfile {
    aerobicEndurance: number;   // 0.0 - 1.0
    thresholdPower: number;     // 0.0 - 1.0
    vo2MaxPower: number;        // 0.0 - 1.0
    repeatedSurges: number;     // 0.0 - 1.0
    sprintPower: number;        // 0.0 - 1.0
    fatigueResistance: number;  // 0.0 - 1.0
    neuromuscular: number;      // 0.0 - 1.0
}

export interface UserEvent {
    id: string;
    title: string;
    date: string; // YYYY-MM-DD
    priority: EventPriority;
    lifecycle: EventLifecycle;
    category: 'running_race' | 'cycling_event' | 'triathlon' | 'strength_meet' | 'general_target';
    demandProfile: EventDemandProfile;
}

export interface WeeklyObjective {
    id: string;
    key: 'threshold_quality' | 'surge_repeatability' | 'zone2_aerobic' | 'strength_maintenance' | 'vo2_max';
    title: string;
    targetExposures: number;
    completedExposures: number;
    targetStimulus: Record<string, number>;
}

export interface MicrocycleState {
    weekStartDate: string; // YYYY-MM-DD (Monday)
    objectives: WeeklyObjective[];
}

export interface WorkoutStimulusProfile {
    aerobicCapacity: number;     // 0.0 - 1.0
    thresholdDevelopment: number;// 0.0 - 1.0
    surgeRepeatability: number;  // 0.0 - 1.0
    maxStrength: number;         // 0.0 - 1.0
    hypertrophy: number;         // 0.0 - 1.0
    mobilityRecovery: number;    // 0.0 - 1.0
}

export interface WorkoutCostProfile {
    systemic: number;        // Autonomic / HRV impact
    cardiovascular: number;  // Heart rate & aerobic strain
    lowerBody: number;       // Leg muscle strain & DOMS
    upperBody: number;       // Push/Pull muscle strain
    impactTissue: number;    // Joint / connective tissue / eccentric cost
    neuromuscular: number;   // Explosive / CNS fatigue
}

export interface DimensionalFatigue {
    systemic: number;        // 0.0 - 1.0
    cardiovascular: number;  // 0.0 - 1.0
    lowerBody: number;       // 0.0 - 1.0
    upperBody: number;       // 0.0 - 1.0
    impactTissue: number;    // 0.0 - 1.0
    neuromuscular: number;   // 0.0 - 1.0
}

export interface FatigueState {
    lastUpdatedDate: string;
    externalLoadFatigue: DimensionalFatigue;
    internalResponseStrain: DimensionalFatigue;
    combinedFatigue: DimensionalFatigue;
}

export interface ExecutionRecord {
    id: string;
    date: string;
    prescribedTemplateId: string;
    athleteAdjustedTemplateId?: string;
    completedActivity?: TrainingRecord;
    status: 'prescribed' | 'adjusted' | 'completed' | 'skipped';
}

export interface DoseVariation {
    label: string;
    durationMin: number;
    durationMax: number;
    doseRatio: number;
    prescriptionSummary: string;
}

export interface SessionTemplate {
    id: string;
    category: 'Hard Endurance' | 'Moderate Endurance' | 'Easy Endurance' | 'Upper-body Strength' | 'Lower-body Strength' | 'Full-body Strength' | 'Power Maintenance' | 'Field Maintenance' | 'Mobility/Recovery' | 'Rest';
    modality: 'Running' | 'Cycling' | 'Strength' | 'Field' | 'Mobility' | 'Cross Training' | 'None';
    durationMin: number;
    durationMax: number;
    title: string;
    description: string;
    requiredEquipment: ('free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike')[];
    systemicCost: number;
    objectiveTransferable?: boolean;
    easierDose?: DoseVariation;
    harderDose?: DoseVariation;
    stimulusProfile?: WorkoutStimulusProfile;
    costProfile?: WorkoutCostProfile;
}

export interface MetricStrainTelemetry {
    acuteDeviation: number;
    multiDayDrift: number;
    totalMetricStrain: number;
}

export interface DecisionScoreTelemetry {
    metricStrain: MetricStrainTelemetry;
    contextPenalties: {
        recentHardSessions: number;
        bodyBatteryDeficit: number;
        sleepFloorPenalty: number;
        conservativeBias: number;
    };
    totalDecisionScore: number;
}

export interface SafetyEnvelope {
    clinicalFlagActive: boolean;
    clinicalReason?: string | null;
    restrictedModalities: SessionTemplate['modality'][];
}

export interface PlanEnvelope {
    maxAllowableTier: 'Rest' | 'Mobility' | 'Easy' | 'Moderate' | 'Hard';
    taperActive: boolean;
    reason?: string | null;
}

export interface SessionAdjustment {
    direction: 'easier' | 'harder';
    tier: 1 | 2 | 3 | 4;
    originalTemplateId: string;
    originalTemplateTitle: string;
    adjustedDoseLabel?: string;
    athleteReason?: 'feel_better' | 'feel_worse' | 'soreness' | 'time_constraint' | 'other';
    rationale: string;
}

export interface Recommendation {
    template: SessionTemplate;
    rationale: string;
    /** The engine's internal train/modify/recover classification that produced this
     *  template -- previously computed and discarded inside evaluateTraining, now
     *  exposed so callers (persistence, adherence analysis) don't have to re-derive it
     *  from the template category alone. */
    mode: 'train' | 'modify' | 'recover';
    activeDose?: DoseVariation;
    adjustment?: SessionAdjustment;
    envelopes?: {
        safety: SafetyEnvelope;
        plan: PlanEnvelope;
    };
    /** Structured strain & contextual telemetry exposing decision drivers and reconciling mathematically. */
    telemetry?: DecisionScoreTelemetry;
}

export interface NextDayPlanBranch {
    tier: 'green' | 'yellow' | 'red';
    label: string;
    condition: string;
    recommendation: Recommendation;
}

export interface NextDayPotentialPlan {
    date: string; // Tomorrow's date YYYY-MM-DD
    isSinglePlan: boolean;
    singlePlanReason?: string;
    branches: {
        green: NextDayPlanBranch;
        yellow: NextDayPlanBranch;
        red: NextDayPlanBranch;
    };
}

// --- Firestore Canonical Models (Phase 3) ---

/** Raw Garmin activity summary for a single day, as stored under `raw.yesterdayTraining` / `raw.todayTraining`. */
export interface RawActivitySummary {
    activityCount?: number;
    totalDurationMin?: number;
    hardActivityCount?: number;
    primaryActivity?: {
        activityId: number | string;
        type: string;
        durationMin: number | null;
        trainingEffect: number;
        intensityTag: string;
    } | null;
    type?: string;
    durationMin?: number | null;
    trainingEffect?: number;
    intensityTag?: string;
}

export interface DailyRecoverySnapshot {
    userId: string;
    date: string;
    source: {
        garminSyncedAt: string;
        sourceSchemaVersion: number;
        timezone?: string;
        metricDates?: {
            sleep?: string | null;
            hrv?: string | null;
            restingHr?: string | null;
            bodyBatteryWake?: string | null;
            steps?: string | null;
            activitiesThrough?: string | null;
            stress?: string | null;
            bodyBattery?: string | null;
            trainingReadiness?: string | null;
            trainingStatus?: string | null;
        };
        migratedFromLegacy?: boolean;
        legacyDocumentPath?: string;
    };
    raw: {
        sleepScore: number | null;
        sleepDurationSec: number | null;
        restingHr: number | null;
        hrvOvernightAvg: number | null;
        hrvStatus: string | null;
        respirationAvg: number | null;
        bodyBatteryWake: number | null;
        bodyBatteryChange: number | null;
        bodyBatteryCharged?: number | null;
        bodyBatteryDrained?: number | null;
        totalSteps: number | null;
        last3DaysHardSessionsCount: number;
        yesterdayTraining: RawActivitySummary | null;
        /** Same-day activity synced from Garmin for `date` itself. Only populated if a
         * sync ran after the activity was uploaded -- absent doesn't mean "didn't train",
         * just "not yet synced today". Prefer the check-in's `alreadyTrainedToday` flag
         * when you need a reliable same-day signal. */
        todayTraining?: RawActivitySummary | null;
        stress?: {
            avg?: number | null;
            max?: number | null;
        } | null;
        trainingReadiness?: {
            score?: number | null;
            level?: string | null;
            feedback?: string | null;
        } | null;
        trainingStatus?: {
            statusPhrase?: string | null;
            acuteTrainingLoad?: number | null;
            acwrStatus?: string | null;
            vo2MaxRunning?: number | null;
            vo2MaxRunningDate?: string | null;
            vo2MaxCycling?: number | null;
            vo2MaxCyclingDate?: string | null;
        } | null;
    };
    derived: {
        baselineComputationVersion: number;
        sleepScore7dAvg: number | null;
        sleepScore28dAvg: number | null;
        restingHr7dAvg: number | null;
        restingHr28dAvg: number | null;
        hrv7dAvg: number | null;
        hrv28dAvg: number | null;
        respiration7dAvg: number | null;
        respiration28dAvg: number | null;
        /** Trailing 28-day population stdev per metric (this person's own night-to-night
         *  variability). Absent (undefined) on documents written before
         *  baselineComputationVersion 2 -- always read as possibly-missing, not just
         *  possibly-null. */
        hrv28dStdev?: number | null;
        restingHr28dStdev?: number | null;
        sleepScore28dStdev?: number | null;
        deltas: {
            sleepScoreVs7d: number | null;
            sleepScoreVs28d: number | null;
            restingHrVs7d: number | null;
            restingHrVs28d: number | null;
            hrvVs7d: number | null;
            hrvVs28d: number | null;
            respirationVs7d: number | null;
            respirationVs28d: number | null;
        };
    };
    dataQuality: {
        sleepScoreAvailable: boolean;
        restingHrAvailable: boolean;
        hrvAvailable: boolean;
        baseline7dReady: boolean;
        baseline28dReady: boolean;
        stressAvailable?: boolean;
        bodyBatteryDetailAvailable?: boolean;
        trainingReadinessAvailable?: boolean;
        trainingStatusAvailable?: boolean;
    };
    createdAt?: string;
    updatedAt?: string;
}

// --- Firestore Canonical Models (Phase 4) ---

export interface DailySubjectiveCheckin {
    userId: string;
    date: string; // YYYY-MM-DD
    // Readiness dimensions (1-10 scale)
    readiness: number | null;
    sleepQuality: number | null;
    fatigue: number | null;
    soreness: number | null;
    mentalStress: number | null;
    motivation: number | null;
    // Boolean flags
    painOrInjury: boolean;
    illnessSymptoms: boolean;
    unusuallyLimitedTime: boolean;
    alreadyTrainedToday: boolean; // Already completed a session today -- recommendation should be rest/recovery only
    // Availability block
    availability: {
        timeAvailableMin: number | null;
        preferredModalityToday: string | null; // e.g., 'Running', 'Cycling', 'Strength', 'Mobility', 'Any'
        indoorOnly: boolean;
    };
    // Optional free text
    notes: string | null;
    submittedAt: string;
    // Data quality metadata
    dataQuality: {
        isComplete: boolean;
        missingFields: string[];
    };
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserGoal {
    userId: string;
    category: 'short-term' | 'mid-term' | 'long-term';
    domain: 'endurance' | 'strength' | 'mobility' | 'weight_loss' | 'general_fitness' | 'other';
    title: string;
    description?: string | null;
    priority: number; // 1-5, 5 = highest
    status: 'active' | 'paused' | 'completed' | 'archived';
    // Optional target tracking
    targetMetric?: string | null; // e.g., '5k_time', 'bench_press_weight', 'weekly_sessions'
    targetValue?: number | null;
    targetUnit?: string | null; // e.g., 'minutes', 'kg', 'sessions'
    // Optional dates
    targetDate?: string | null; // YYYY-MM-DD
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserConstraint {
    userId: string;
    key: string; // Stable identifier for predefined constraints, generated for custom
    label: string;
    valueType: 'boolean' | 'number' | 'string' | 'string_array';
    type: 'boolean' | 'number' | 'string' | 'string_array';
    value: boolean | number | string | string[];
    severity: 'hard' | 'soft'; // Hard = must not violate, Soft = try to avoid
    isActive: boolean;
    category: 'equipment' | 'physical_caution' | 'schedule' | 'environment' | 'custom';
    displayName: string; // Human-readable name
    description?: string | null; // Optional explanation
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface UserPreferences {
    userId: string;
    // Recovery preferences
    preferredRecoveryStyle: 'passive' | 'active' | 'mixed';
    // Time preferences
    defaultWeekdayTimeMin: number; // Default session duration on weekdays
    defaultWeekendTimeMin: number; // Default session duration on weekends
    preferredTimeOfDay: 'morning' | 'midday' | 'evening' | 'flexible';
    // Modality preferences
    preferredModalities: string[]; // e.g., ['Running', 'Cycling', 'Strength']
    deprioritizedModalities: string[]; // Canonical Phase 4 name
    avoidedModalities: string[]; // e.g., ['Running']
    // UI/Explanation preferences
    explanationStyle: 'brief' | 'detailed' | 'technical';
    explanationVerbosity: 'brief' | 'detailed' | 'technical';
    conservativeBias: boolean;
    extraRecoveryMargin?: boolean;
    // Metric preferences
    preferredUnits: {
        distance: 'km' | 'miles';
        weight: 'kg' | 'lbs';
        temperature: 'celsius' | 'fahrenheit';
    };
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

// --- Engine Layer Models (Not stored in Firestore) ---

export interface DailyDecisionInput {
    userId: string;
    date: string;
    // Data sources
    recoverySnapshot: DailyRecoverySnapshot | null;
    subjectiveCheckin: DailySubjectiveCheckin | null;
    activeGoals: UserGoal[]; // Only goals with status === 'active'
    activeConstraints: UserConstraint[]; // Only constraints where isActive === true
    preferences: UserPreferences | null;
    // Data quality flags
    dataQuality: {
        hasRecoverySnapshot: boolean;
        hasSubjectiveCheckin: boolean;
        // True only when a check-in exists AND its own dataQuality.isComplete is true.
        // False (not just absent) when a check-in exists but is missing fields -- a
        // partially-filled check-in must not be treated as trustworthy input, since an
        // unanswered field like alreadyTrainedToday silently defaults to `false` and a
        // recommendation generated from it could miss a "you already trained" signal.
        subjectiveCheckinComplete: boolean;
        profileReady: boolean; // True if preferences exist
    };
}

/**
 * A generated recommendation, persisted at
 * users/{userId}/daily_recommendations/{date} so there's a durable record of what was
 * actually prescribed each day -- previously the engine's output was computed on page
 * load and discarded, which made "is the algorithm working?" unanswerable from data.
 * `adherence` is filled in later (typically the next day, via a quick prompt) rather
 * than at creation time -- see recommendationService.recordAdherence.
 */
export interface DailyRecommendation {
    userId: string;
    date: string;
    templateId: string;
    templateTitle: string;
    category: SessionTemplate['category'];
    modality: SessionTemplate['modality'];
    mode: 'train' | 'modify' | 'recover';
    rationale: string;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
    adjustment?: SessionAdjustment;
    adherence: {
        /** Null until the user responds to the adherence prompt for this day. */
        respondedAt: string | null;
        /** true = did the recommended session as prescribed; false = did something
         *  different (see actual* fields) or nothing at all (see skipped). Null =
         *  not yet answered. */
        followed: boolean | null;
        /** Set when followed === false and skipped === false: what was actually done
         *  instead of the recommendation. */
        actualModality: SessionTemplate['modality'] | null;
        actualDurationMin: number | null;
        /** true = did no session at all today (distinct from "did something
         *  different" -- both are followed: false, but this narrows which). */
        skipped: boolean;
        notes: string | null;
    };
}

// --- Type Utilities ---

export type GoalCategory = UserGoal['category'];
export type GoalDomain = UserGoal['domain'];
export type GoalStatus = UserGoal['status'];
export type ConstraintType = UserConstraint['type'];
export type ConstraintSeverity = UserConstraint['severity'];
export type ConstraintCategory = UserConstraint['category'];
export type RecoveryStyle = UserPreferences['preferredRecoveryStyle'];
export type TimeOfDay = UserPreferences['preferredTimeOfDay'];
export type ExplanationVerbosity = UserPreferences['explanationVerbosity'];
