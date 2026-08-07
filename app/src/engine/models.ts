import type { AthletePerformanceProfile, WorkoutPrescription } from '../workouts/models.ts';
import type { DataStateSummary } from './dataState';

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
    /** Optional only for legacy engine callers; composed recommendations always provide it. */
    trainingSettings?: TrainingSettings;
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

export type ObjectiveKey = 
  | 'threshold_quality' 
  | 'surge_repeatability' 
  | 'zone2_aerobic' 
  | 'strength_maintenance' 
  | 'race_specific_endurance' 
  | 'vo2_max';

export type ObjectivePriority = 'must_have' | 'should_have' | 'nice_to_have';

export interface WeeklyObjective {
    id: string;
    key: ObjectiveKey;
    title: string;
    requiredCredit?: number;
    targetExposures: number;
    completedExposures: number;
    targetStimulus: Record<string, number>;
    priority?: ObjectivePriority;
    /** Optional stricter completion policy for objectives whose target stimulus alone
     * is too broad to identify the intended event-specific exposure. */
    qualification?: ObjectiveQualification;
    windowStart?: string;
    windowEnd?: string;
}

export interface ObjectiveProgress {
    objectiveId: string;
    projectedCredit: number;
    completedCredit: number;
    rawCompletedCredit: number;
}

export interface MicrocycleState {
    weekStartDate: string; // YYYY-MM-DD (Monday)
    objectives: WeeklyObjective[];
}

export interface WorkoutStimulusProfile {
    aerobicEndurance?: number;     // 0.0 - 1.0 (canonical)
    thresholdPower?: number;       // 0.0 - 1.0 (canonical)
    vo2MaxPower?: number;          // 0.0 - 1.0 (canonical)
    repeatedSurges?: number;       // 0.0 - 1.0 (canonical)
    sprintPower?: number;          // 0.0 - 1.0 (canonical)
    fatigueResistance?: number;    // 0.0 - 1.0 (canonical)
    maxStrength?: number;          // 0.0 - 1.0 (canonical)

    // Legacy backward-compatibility aliases
    aerobicCapacity?: number;
    thresholdDevelopment?: number;
    surgeRepeatability?: number;
    hypertrophy?: number;
    mobilityRecovery?: number;
}

export interface ObjectiveQualification {
    /** Every specified axis in a candidate's own stimulus profile must clear its minimum. */
    minimumStimulus?: Partial<Record<keyof WorkoutStimulusProfile, number>>;
    /** Restricts credit to these modalities when non-empty. An absent or empty list is
     * intentionally modality-agnostic. */
    allowedModalities?: SessionTemplate['modality'][];
    /** Restricts credit to a catalog session category. This prevents a broadly similar
     * interval from completing an objective that explicitly requires race-specific work. */
    allowedCategories?: SessionTemplate['category'][];
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

export interface SessionHistoryEntry {
    date: string;
    templateId: string;
    category: SessionTemplate['category'];
    modality: SessionTemplate['modality'];
    sessionRole?: 'anchor' | 'supporting' | 'recovery';
}

export type SessionPlanRelationship = 
  | 'matched_as_planned'
  | 'matched_modified'
  | 'rescheduled'
  | 'missed'
  | 'unplanned'
  | 'uncertain_match';

export type SessionAdherenceStatus = SessionPlanRelationship;

export interface ExecutionRecord {
    id: string;
    date: string;
    prescribedTemplateId: string;
    athleteAdjustedTemplateId?: string;
    completedActivity?: TrainingRecord;
    status: 'prescribed' | 'adjusted' | 'completed' | 'skipped';
}

export interface PlannerState {
    completedExposures: CompletedTrainingEvent[];
    projectedExposures: ExecutionRecord[];
    weeklyObjectives: WeeklyObjective[];
    fatigueState: FatigueState;
    recentSessionHistory: SessionHistoryEntry[];
    policyVersion: string;
    engineVersion: 'v2';
}

export interface DoseVariation {
    label: string;
    durationMin: number;
    durationMax: number;
    doseRatio: number;
    prescriptionSummary: string;
}

/** Governs when a template becomes selectable relative to the athlete's governing event,
 *  independent of the generic weekly-objective/fatigue ranking. Absent = eligible always
 *  (all templates that existed before this field was added keep exactly that behavior).
 *  Only consulted on Path B (the intent-aware optimizer, rules.ts's evaluateTrainingWithIntent
 *  and planner.ts's projected loop) -- Path A's evaluateTraining has no PeriodizationResult
 *  in scope at all, so a phase-gated template is structurally unreachable there, not merely
 *  policy-excluded. See periodization.ts's isTemplatePhaseEligible. */
export interface TemplatePhaseEligibility {
    /** Never eligible in the eventless default (Base phase with no active event). */
    requiresFocusEvent?: boolean;
    /** Inclusive day-count ceiling relative to the focus event (e.g. 35 = "only within 35 days"). */
    maxDaysToEvent?: number;
    /** Inclusive day-count floor relative to the focus event. */
    minDaysToEvent?: number;
    /** Only eligible once the focus event's taper window is active. */
    requiresTaper?: boolean;
    /** Never eligible once the taper window is active (superseded by a taper-specific template). */
    excludeTaper?: boolean;
}

export interface SessionTemplate {
    id: string;
    category: 'Hard Endurance' | 'Moderate Endurance' | 'Easy Endurance' | 'Race-Specific Endurance' | 'Upper-body Strength' | 'Lower-body Strength' | 'Full-body Strength' | 'Power Maintenance' | 'Field Maintenance' | 'Technical Skill' | 'Mobility/Recovery' | 'Rest';
    modality: 'Running' | 'Cycling' | 'Strength' | 'Field' | 'Mobility' | 'Cross Training' | 'None';
    durationMin: number;
    durationMax: number;
    title: string;
    description: string;
    requiredEquipment: EquipmentKey[];
    environment: TrainingEnvironment;
    safetyTags: GuardrailKey[];
    systemicCost: number;
    objectiveTransferable?: boolean;
    easierDose?: DoseVariation;
    harderDose?: DoseVariation;
    stimulusProfile?: WorkoutStimulusProfile;
    costProfile?: WorkoutCostProfile;
    phaseEligibility?: TemplatePhaseEligibility;
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
    /** Legacy compatibility only. Safety/readiness evaluation never derives taper from
     * goal text; periodization owns taper state. */
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
    /** Normalized plan-side dose derived from periodization and remaining objectives. */
    plannedDose?: number;
    /** Final dose after the plan target, safety ceiling, and athlete adjustment meet. */
    executionDose?: number;
    adjustment?: SessionAdjustment;
    envelopes?: {
        safety: SafetyEnvelope;
        plan: PlanEnvelope;
    };
    /** Structured strain & contextual telemetry exposing decision drivers and reconciling mathematically. */
    telemetry?: DecisionScoreTelemetry;
    /** Concrete, dated session instructions resolved from the selected template. */
    prescription?: WorkoutPrescription;
    /** Assigned at the composition boundary immediately before persistence. */
    recommendationAudit?: RecommendationAudit;
    /** Engine trace retained only long enough to create the compact persisted audit. */
    decisionTrace?: {
        policyVersion: string;
        candidateScores: Array<{
            templateId: string;
            utilityScore: number;
            excludedReasons: string[];
        }>;
    };
}

export interface NextDayPlanBranch {
    tier: 'green' | 'yellow' | 'red';
    label: string;
    condition: string;
    recommendation: Recommendation;
}

/** A hypothetical tomorrow input retained separately from its evaluated result so the
 * synchronous and intent-aware evaluators always traverse the identical branches. */
export interface NextDayScenario {
    tier: 'green' | 'yellow' | 'red';
    label: string;
    condition: string;
    readiness: DailyReadiness;
}

export interface NextDayScenarioSet {
    date: string;
    isSinglePlan: boolean;
    singlePlanReason?: string;
    scenarios: {
        green: NextDayScenario;
        yellow: NextDayScenario;
        red: NextDayScenario;
    };
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
    /** Historical tracking: timestamp of the first unbiased submission (before seeing Garmin data). */
    initialSubmittedAt?: string;
    /** Historical tracking: true if saved after viewing Garmin wearable context, preserving initial data value. */
    editedAfterWearableReveal?: boolean;
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
    /** Time-horizon bucket. For a goal with a `targetDate`, this is DERIVED (see
     *  periodization.ts deriveGoalCategory) and never persisted -- goalService fills it
     *  in on every read so it's always current relative to today, with nothing to go
     *  stale. Only meaningful as user input for open-ended goals (no `targetDate`). */
    category: 'short-term' | 'mid-term' | 'long-term';
    domain: 'endurance' | 'strength' | 'mobility' | 'weight_loss' | 'general_fitness' | 'other';
    title: string;
    description?: string | null;
    priority: number; // 1-5, 5 = highest. Also the input to deriveEventPriority (A/B/C) for event goals -- no separate persisted priority field.
    status: 'active' | 'paused' | 'completed' | 'archived';
    // Optional target tracking
    targetMetric?: string | null; // e.g., '5k_time', 'bench_press_weight', 'weekly_sessions'
    targetValue?: number | null;
    targetUnit?: string | null; // e.g., 'minutes', 'kg', 'sessions'
    // Optional dates
    targetDate?: string | null; // YYYY-MM-DD
    /** Free-text description of what "success" looks like, e.g. "sub-5h finish". */
    targetOutcome?: string | null;
    // Event fields: only meaningful when `targetDate` is set. A goal with these set is
    // adapted into a `UserEvent` (see periodization.ts goalToUserEvent) and feeds the
    // periodization/taper engine; a goal without them is a plain aspirational target and
    // only ever contributes display text, same as before this feature existed.
    eventCategory?: UserEvent['category'] | null;
    /** One of EVENT_PRESETS[eventCategory]'s ids (engine/eventPresets.ts). Resolves to a
     *  demand profile at read/engine time -- never persist the profile itself, so
     *  recalibrating a preset's numbers doesn't require touching old goal docs. */
    eventPreset?: string | null;
    /** No 'rescheduled' state here by design -- rescheduling a goal is just editing
     *  targetDate while it stays 'scheduled'. Defaults to 'scheduled' when eventCategory is set. */
    eventLifecycle?: 'scheduled' | 'completed' | 'DNS' | 'DNF' | 'cancelled';
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

/** Athlete-controlled feasibility settings. Equipment is capability, while
 * guardrails are non-negotiable safety boundaries. They must not be conflated. */
export type EquipmentKey = 'free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike' | 'pullup_bar';
export type TrainingEnvironment = 'indoor' | 'outdoor' | 'either';
export type GuardrailKey = 'avoid_high_impact' | 'avoid_heavy_lower_body' | 'avoid_overhead_pressing' | 'avoid_heavy_spinal_loading';

export interface TrainingSettings {
    userId: string;
    schemaVersion: 2 | 3;
    equipment: Record<EquipmentKey, boolean>;
    guardrails: Record<GuardrailKey, boolean>;
    capabilities?: {
        powerMeter?: boolean;
        heartRateMonitor?: boolean;
        cadenceData?: boolean;
    };
    defaults: {
        weekdayMaxMinutes: number | null;
        weekendMaxMinutes: number | null;
        environment: TrainingEnvironment;
    };
    preferences: {
        preferActiveRecovery: boolean;
    };
    migration: {
        legacyReviewed: boolean;
        migratedAt: string | null;
    };
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
    explanationVerbosity: 'brief' | 'detailed' | 'technical';
    conservativeBias: boolean;
    extraRecoveryMargin?: boolean;
    // Metric preferences
    preferredUnits: {
        distance: 'km' | 'miles';
        weight: 'kg' | 'lbs';
        temperature: 'celsius' | 'fahrenheit';
    };
    performanceProfile?: AthletePerformanceProfile;
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
    trainingSettings: TrainingSettings;
    preferences: UserPreferences | null;
    /** Statuses keep unavailable/corrupt data distinct from a genuinely absent record. */
    sourceStates?: {
        recoverySnapshot: DataStateSummary;
        subjectiveCheckin: DataStateSummary;
        activeGoals: DataStateSummary;
        trainingSettings: DataStateSummary;
        preferences: DataStateSummary;
    };
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
    prescription?: WorkoutPrescription;
    /** Compact, replay-oriented metadata. It deliberately omits raw health values and notes. */
    recommendationAudit?: RecommendationAudit;
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

/** Backend-normalized Garmin activity stored at users/{uid}/activities/{activityId}. */
export interface NormalizedGarminActivity {
    activityId: string;
    date: string;
    type: string;
    durationMin: number | null;
    trainingEffectAerobic: number | null;
    trainingEffectAnaerobic: number | null;
    averageHr: number | null;
    activityTrainingLoad: number | null;
    intensityTag: string;
    syncRunId?: string;
    syncedAt?: string;
}

export type CompletedTrainingSource = 'garmin' | 'adherence' | 'manual';
export type CompletedTrainingIntensity = 'easy' | 'moderate' | 'hard' | 'unknown';
export type CompletedTrainingConfidence = 'high' | 'medium' | 'low';

/**
 * One real-world completed session after all available evidence is reconciled. It is an
 * engine-domain model, derived from durable source records; it is not itself persisted
 * in this first rollout phase.
 */
export interface CompletedTrainingEvent {
    id: string;
    date: string;
    durationMin: number | null;
    modality: SessionTemplate['modality'] | 'Unknown';
    intensity: CompletedTrainingIntensity;
    trainingEffect: number | null;
    estimatedCost: WorkoutCostProfile;
    estimatedStimulus: Partial<WorkoutStimulusProfile>;
    sources: CompletedTrainingSource[];
    confidence: CompletedTrainingConfidence;
    linkedActivityId: string | null;
    linkedRecommendationDate: string | null;
    athleteFeedback: {
        followed: boolean | null;
        notes: string | null;
    };
}

export interface RecommendationAudit {
    policyVersion: string;
    evaluatedAt: string;
    decisionContextRevision: string;
    safetyStatus: 'complete';
    history: {
        completedEventCount: number;
        unmatchedEventCount: number;
        sourceStatuses: Record<'activities' | 'recommendations' | 'manualTraining', 'AVAILABLE' | 'MISSING' | 'INVALID' | 'UNAVAILABLE'>;
    };
    envelope: {
        safetyRestrictedModalityCount: number;
        planMaxAllowableTier: PlanEnvelope['maxAllowableTier'];
    };
    candidateScores: Array<{
        templateId: string;
        utilityScore: number;
        excludedReasons: string[];
    }>;
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
