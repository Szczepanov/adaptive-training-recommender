import type { AthletePerformanceProfile, WorkoutPrescription } from '../workouts/models.ts';
import type { SessionReferenceBinding } from '../sessions/models';
import type { DataIssue, DataState, DataStateSummary } from './dataState';
import type { SubjectiveBaseline } from './subjectiveBaseline';
import type { DataConfidenceScore } from './dataConfidence';

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
    /** Current respiration rate vs its own trailing 7d/28d baseline (current - median),
     *  the same acute/chronic pairing as hrv_delta/hrv_delta_28d above -- see
     *  respiration_mad_28d for the matching noise-floor denominator. Optional/undefined on
     *  documents whose baseline predates respiration28dMad (baselineComputationVersion < 3)
     *  rather than required, following the steps_* fields' precedent for a later addition. */
    respiration_delta?: number | null;
    respiration_delta_28d?: number | null;
    /** This person's own trailing 28-day median absolute deviation (scaled to be
     *  stdev-comparable), not population stdev -- respiration's baseline is median-based
     *  (see DerivedMetrics.respiration28dMad's docstring on the Python side) specifically
     *  because a prior illness episode inside the window is exactly the kind of deviation
     *  this metric exists to detect, and a mean/stdev pair gets contaminated by it. */
    respiration_mad_28d?: number | null;
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
    steps_7d_avg?: number | null;
    steps_28d_avg?: number | null;
    steps_delta_7d?: number | null;
    steps_delta_28d?: number | null;
    /** This person's own trailing 28-day population stdev per metric -- normalizes a
     *  raw delta into "how unusual is this for *this* person" instead of comparing
     *  everyone against the same fixed absolute number. Null until 14+ days of history
     *  exist (see DerivedMetrics.hrv28dStdev on the Python side). */
    hrv_stdev_28d: number | null;
    rhr_stdev_28d: number | null;
    sleep_score_stdev_28d: number | null;
    steps_stdev_28d?: number | null;
}

export interface DailyReadiness {
    subjective: SubjectiveInput;
    objective: EngineObjectiveInput;
    /** Phase 9.2: the athlete's recent-vs-long subjective history (Phase 9.1), computed at
     *  the composition boundary and handed in as data -- the same way objective baselines
     *  already arrive precomputed on `derived.hrv7dAvg` and friends. Absent (undefined) or
     *  `null` are both a supported "no relative subjective signal" input and preserve
     *  today's behaviour exactly: nothing in `rules.ts` reads this field yet (Phase 9.3
     *  adds the drift term that will, behind a default-off selector). Adding it here does
     *  not give `evaluateReadinessAndSafetyEnvelope` a history provider, an async
     *  signature, or a Firestore read (D-SUBJPURE) -- it stays exactly as pure and
     *  synchronous as it already was. */
    subjectiveBaseline?: SubjectiveBaseline | null;
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
        restrictedModalities?: SessionTemplate['modality'][];
        impliedGuardrails?: GuardrailKey[];
        restrictedCategories?: SessionTemplate['category'][];
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
        /** Engine-facing recovery-style authority from UserPreferences. Legacy training settings
         * may only supply a fallback when no explicit preference record exists. */
        preferredRecoveryStyle?: UserPreferences['preferredRecoveryStyle'];
    };
    /** Optional only for legacy engine callers; composed recommendations always provide it. */
    trainingSettings?: TrainingSettings;
}

/** Persisted at `users/{userId}/fixed_activities/{activityId}` (ADR-0002 user-owned
 *  path, Phase 5.3) -- see docs/plans/phase-5-sequence-planning.md 5.3 for the storage
 *  contract and firestore.rules validation table this type must stay aligned with. */
export interface FixedActivity {
    id: string;
    userId: string;
    title: string;
    date: string; // YYYY-MM-DD, Warsaw-local (ADR-0003)
    startTime?: string;
    durationMin: number;
    /** Keys are the canonical WorkoutStimulusProfile axes; each value 0..1. */
    expectedStimulus?: Partial<Record<keyof WorkoutStimulusProfile, number>>;
    /** Keys are the six WorkoutCostProfile dimensions; each value 0..1. */
    expectedCost?: Partial<Record<keyof WorkoutCostProfile, number>>;
    /** Immovable (booked class, match kickoff) vs a movable placeholder the athlete could
     *  reschedule around. Load-bearing for the planner/search -- see 5.3's storage table. */
    fixed: boolean;
    environment: TrainingEnvironment;
    /** Equipment available *at* this activity, not the athlete's general profile
     *  equipment (e.g. away-game gear, a hotel gym's limited rack). Size/type bounds are
     *  enforced in validation.ts and the FixedActivity form -- firestore.rules can only
     *  bound the list's length, not iterate to check each item (see 5.3). */
    equipment: string[];
    /** Overrides the day's total available training minutes outright (e.g. a travel day:
     *  the whole day's budget shrinks, not just this activity's own duration). Absent =
     *  the normal weekday/weekend profile budget applies, reduced only by durationMin. */
    availabilityOverride?: number;
    /** Phase 6.2b / D6-B: a TRUE day-wide restriction, deliberately separate from this
     *  activity's own `environment`/`equipment` above. An outdoor football match's venue
     *  does not imply a separate same-day indoor session is also outdoor-only -- only set
     *  this when the day itself is actually constrained (e.g. travel: every session that
     *  day really is stuck at a hotel gym). Absent = this activity's venue never restricts
     *  another session on the same date. Firestore and persistence validation enforce this
     *  field's shape before it is stored. */
    availabilityContextOverride?: {
        environment?: TrainingEnvironment;
        equipment?: string[];
    };
    isCompleted: boolean;
    createdAt: string;
    updatedAt: string;
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

export interface EventTiming {
    earliestDate: string; // YYYY-MM-DD
    latestDate: string;   // YYYY-MM-DD
    planningDate: string; // = earliestDate until confirmed
    confirmedDate?: string; // YYYY-MM-DD
}

export function validateEventTiming(
    timing: EventTiming,
    documentPath: string = 'user_event'
): DataState<EventTiming> {
    const issues: DataIssue[] = [];

    if (timing.earliestDate > timing.planningDate) {
        issues.push({ code: 'EARLIEST_AFTER_PLANNING', field: 'earliestDate', documentPath });
    }
    if (timing.planningDate > timing.latestDate) {
        issues.push({ code: 'PLANNING_AFTER_LATEST', field: 'planningDate', documentPath });
    }
    if (timing.confirmedDate !== undefined && timing.confirmedDate !== null) {
        if (timing.confirmedDate < timing.earliestDate || timing.confirmedDate > timing.latestDate) {
            issues.push({ code: 'CONFIRMED_OUT_OF_RANGE', field: 'confirmedDate', documentPath });
        }
        if (timing.planningDate !== timing.confirmedDate) {
            issues.push({ code: 'PLANNING_NOT_CONFIRMED', field: 'planningDate', documentPath });
        }
    }

    if (issues.length > 0) {
        return { status: 'INVALID', issues };
    }

    return { status: 'AVAILABLE', data: timing, revision: null };
}

export interface UserEvent {
    id: string;
    title: string;
    date: string; // YYYY-MM-DD
    priority: EventPriority;
    lifecycle: EventLifecycle;
    category: 'running_race' | 'cycling_event' | 'triathlon' | 'strength_meet' | 'general_target';
    demandProfile: EventDemandProfile;
    timing?: EventTiming;
    taper?: EventTaperSpec;
}

/** Optional user-authored taper start for a dated event. Without it, taperPolicy.ts
 * supplies the sport/priority default. */
export interface EventTaperSpec {
    startDate: string;
}

/** A user-authored calendar overlay. Travel is intentionally explicit: no event date or
 * activity venue can fabricate one. These blocks are stored under the owning user. */
export interface AuthoredPlanBlock {
    id: string;
    userId: string;
    eventId?: string | null;
    phase: 'travel';
    startDate: string;
    endDate: string;
    volumeScale: number;
    intensityScale: number;
    createdAt: string;
    updatedAt: string;
}

export type PlanningMode = 'evergreen' | 'event_directed' | 'externally_planned';

// --- Externally-authored plans (ADR-0019, Phase 8) ---

export const EXTERNAL_PLAN_SCHEMA = 'adaptive-training-recommender/external-plan@1';

/** Structural mirror of `externalSession.ts`'s verdict, declared here so `Recommendation`
 * does not import from the adjudicator (which imports models). */
export interface ExternalSessionVerdictSummary {
    decision: 'proceed' | 'scale' | 'defer' | 'skip' | 'advisory';
    executionDose?: PlannedDose;
    scaledSummary?: string;
    fallbackSuggestion?: string;
    gateFailures: string[];
    rationale: string;
}

export type ExternalSessionModality = 'cycling' | 'running' | 'strength' | 'field' | 'mobility' | 'cross_training';
export type ExternalSessionIntensity = 'recovery' | 'easy' | 'moderate' | 'hard' | 'max';
export type ExternalSessionPriority = 'key' | 'supporting' | 'optional';
export type ExternalPlacementFlexibility = 'fixed' | 'preferred' | 'any_day';
export type ExternalIfMissed = 'drop' | 'reschedule_within_week' | 'carry_forward';
export type ExternalWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/** A step carries EITHER minutes OR seconds, never both. Seconds exist because cycling
 * intervals are second-granular and the first real generated plan improvised fractional
 * minutes (0.17 for a 10s effort) that could not be read back accurately. */
export interface ExternalPrescriptionStep {
    name: string;
    target?: string;
    durationMin?: number;
    durationSec?: number;
    /** Reps within one set. */
    repeat?: number;
    recoveryMin?: number;
    recoverySec?: number;
    /** Sets within this step; absent means a single set. */
    sets?: number;
    setRecoveryMin?: number;
    setRecoverySec?: number;
    notes?: string;
}

/** Displayed verbatim; no gate reads it. */
export interface ExternalPrescription {
    summary: string;
    steps?: ExternalPrescriptionStep[];
}

/** How the author wants the session cut down, and whether it can be cut down at all. */
export interface ExternalSessionScaling {
    /** D-IRREDUCIBLE: false means no useful reduced form exists — short-of-full readiness
     * defers rather than prescribing a compromise. Absent is treated as true. */
    reducible?: boolean;
    reducedSummary?: string;
    reducedDurationMin?: number;
    minimumUsefulDurationMin?: number;
    /** Advisory author text only. Never an executable substitute (D-CANDIDATE). */
    fallback?: string;
}

export interface ExternalSessionPlacement {
    week: number;
    preferredDay?: ExternalWeekday;
    flexibility: ExternalPlacementFlexibility;
    ifMissed: ExternalIfMissed;
}

/** The fields the hard feasibility gates read. Structurally a `GateableSession` once
 * adapted; `systemicCost` is deliberately absent because the schema does not accept a
 * calibrated load figure from an authoring AI (D-EXTTIER). */
export interface ExternalSessionGating {
    modality: ExternalSessionModality;
    intensity: ExternalSessionIntensity;
    durationMin: number;
    durationMax: number;
    environment: TrainingEnvironment;
    equipment: EquipmentKey[];
}

export interface ExternalPlanSession {
    id: string;
    title: string;
    priority: ExternalSessionPriority;
    placement: ExternalSessionPlacement;
    gating: ExternalSessionGating;
    objectives?: ObjectiveKey[];
    prescription: ExternalPrescription;
    scaling?: ExternalSessionScaling;
    /** D-EVENT: the target event itself. Requires `flexibility: 'fixed'` and a
     * `preferredDay`. Reconciled onto the FixedActivity contract and adjudicated for
     * advice only — it can never be told to skip. */
    isEvent?: boolean;
}

/** The imported artifact. Never edited in place once stored (D-IMMUT). */
export interface ExternalTrainingPlan {
    schema: typeof EXTERNAL_PLAN_SCHEMA;
    planId: string;
    revision: number;
    title: string;
    /** Monday of week 1, Warsaw-local (ADR-0003). The only absolute date in the plan. */
    startDate: string;
    weekCount: number;
    notes?: string;
    sessions: ExternalPlanSession[];
}

export type ExternalPlacementStatus = 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';

export interface ExternalPlacementAssignment {
    sessionId: string;
    date: string;
    status: ExternalPlacementStatus;
}

/** The mutable overlay. Rescheduling writes here, never to the stored revision. */
export interface ExternalPlanPlacement {
    userId: string;
    planId: string;
    revision: number;
    assignments: ExternalPlacementAssignment[];
    updatedAt: string;
}

/** Stored header for a plan across its revisions. */
export interface ExternalPlanHeader {
    userId: string;
    planId: string;
    revision: number;
    title: string;
    startDate: string;
    weekCount: number;
    /** SHA-256 over the canonical JSON of the stored revision (D-IMMUT). */
    contentHash: string;
    importedAt: string;
    /** Date from which this revision supersedes the previous one. */
    supersededFrom: string | null;
    updatedAt: string;
}
export type TrainingPriority =
    | 'health' | 'balanced_performance' | 'endurance'
    | 'strength_muscle' | 'speed_power' | 'sport_readiness';

/** Persisted athlete-owned planning inputs. This is deliberately distinct from
 * `trainingIntent.ts`'s per-decision `TrainingIntent`, which resolves these inputs with
 * history and readiness for one date and is never persisted as this profile. */
export interface TrainingIntentProfile {
    userId: string;
    planningMode: PlanningMode;
    priorities: TrainingPriority[];
    weeklyCommitment: {
        minSessions: number;
        targetSessions: number;
        maxSessions: number;
    };
    organizationPreference: 'auto';
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export type ObjectiveKey =
  | 'threshold_quality'
  | 'surge_repeatability'
  | 'zone2_aerobic'
  | 'strength_maintenance'
  | 'strength_development'
  | 'race_specific_endurance'
  | 'vo2_max';

export type ObjectivePriority = 'must_have' | 'should_have' | 'nice_to_have';

export interface WeeklyObjective {
    id: string;
    key: ObjectiveKey;
    title: string;
    requiredCredit?: number;
    /** Fractional credit accumulated from completed evidence. `completedExposures` is
     * retained only as a legacy display projection. */
    completedCredit?: number;
    /** Fractional credit already allocated in a future projection; never persisted. */
    projectedCredit?: number;
    targetExposures: number;
    completedExposures: number;
    targetStimulus: Partial<Record<keyof WorkoutStimulusProfile, number>>;
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

// --- Phase 5.6: one taper authority, multiple demand contributors ---
// Canonical location for periodization.ts's resolveMultiEventObjectives result shape --
// lives here (not periodization.ts) so decisionTrace/RecommendationAudit below can
// reference it without periodization.ts importing back from models.ts.

export type ObjectiveDropReason = 'inadmissible_during_taper';

export interface DroppedContributorObjective {
    eventId: string;
    eventTitle: string;
    objectiveKey: ObjectiveKey;
    reason: ObjectiveDropReason;
    /** Athlete-facing explanation, not just a machine code -- see the plan's own framing:
     *  "your B-event's threshold session was dropped because it fell in A-event race
     *  week" is actionable; a quietly reweighted plan teaches the athlete nothing. */
    message: string;
    /** Phase 6.2a: the planning date this drop was resolved for. The week-ahead loop
     *  re-resolves objective admissibility per projected day (see planner.ts), so a
     *  transition that falls mid-horizon needs its own effective date rather than always
     *  implying "today". */
    date: string;
}

export interface MicrocycleState {
    windowStartDate: string; // YYYY-MM-DD (Warsaw-local start date)
    objectives: WeeklyObjective[];
}

export interface WorkoutStimulusProfile {
    aerobicEndurance: number;     // 0.0 - 1.0 (canonical)
    thresholdPower: number;       // 0.0 - 1.0 (canonical)
    vo2MaxPower: number;          // 0.0 - 1.0 (canonical)
    repeatedSurges: number;       // 0.0 - 1.0 (canonical)
    sprintPower: number;          // 0.0 - 1.0 (canonical)
    fatigueResistance: number;    // 0.0 - 1.0 (canonical)
    maxStrength: number;          // 0.0 - 1.0 (canonical)
    hypertrophy: number;          // 0.0 - 1.0 (canonical)
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

/** Evidence used by both objective credit and external-load costing. */
export interface DeliveredDose {
    plannedDurationMin?: number;
    completedDurationMin?: number;
    completionRatio?: number;
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
    rawExternalLoadFatigue?: DimensionalFatigue;
}

export type Modality = SessionTemplate['modality'];
export type SessionRole = 'anchor' | 'supporting' | 'recovery';
export type IntensityClass = 'hard' | 'moderate' | 'easy' | 'recovery';

export interface SessionHistoryEntry {
    date: string;              // YYYY-MM-DD, Warsaw-local calendar date
    templateId?: string;
    category?: SessionTemplate['category'];
    modality: SessionTemplate['modality'];
    role?: SessionRole;        // 'anchor' | 'supporting' | 'recovery'
    intensityClass?: IntensityClass;
    systemicCost: number;
    lowerBodyCost: number;
    recoveryHours?: number;
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

/** Plan-owned session dose. Volume controls duration; intensity controls which
 * intensity-class templates may be selected. The two values intentionally do not share
 * a safety ceiling: a taper can reduce duration while retaining quality work. */
export interface PlannedDose {
    volume: number;
    intensity: number;
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
    /** Phase 9.7: the subjective-drift component (0 under production's default `'off'`
     *  policy). Optional so historical persisted telemetry without this field still parses. */
    subjectiveDrift?: number;
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
    /** Plan-owned volume and intensity targets. */
    plannedDose?: PlannedDose;
    /** Final volume after the safety ceiling and athlete adjustment meet. Intensity is
     * retained as the plan's candidate-admissibility contract. */
    executionDose?: PlannedDose;
    adjustment?: SessionAdjustment;
    envelopes?: {
        safety: SafetyEnvelope;
        plan: PlanEnvelope;
    };
    /** Structured strain & contextual telemetry exposing decision drivers and reconciling mathematically. */
    telemetry?: DecisionScoreTelemetry;
    /** Concrete, dated session instructions resolved from the selected template. */
    prescription?: WorkoutPrescription;
    /** The imported session's own instructions, carried when the recommendation came from
     * an externally-authored plan. `prescription` stays empty in that case: a synthetic
     * template has no catalog workout to resolve, and inventing one would misattribute
     * authored content to the catalog (ADR-0019 D-SHIM). */
    /** The adjudication outcome for an imported session. Present with
     * `externalPrescription`; the UI renders the decision, not just the session. */
    externalVerdict?: ExternalSessionVerdictSummary;
    externalPrescription?: {
        planId: string;
        revision: number;
        sessionId: string;
        title: string;
        prescription: ExternalPrescription;
        scaling?: ExternalSessionScaling;
        isEvent?: boolean;
    };
    /** Multidomain session bindings (M3.2 / ADR-0023 D-MSNAP). */
    primarySession?: SessionReferenceBinding;
    additionalSessions?: SessionReferenceBinding[];
    /** Assigned at the composition boundary immediately before persistence. */
    recommendationAudit?: RecommendationAudit;
    /** Engine trace retained only long enough to create the compact persisted audit. */
    decisionTrace?: {
        policyVersion: string;
        candidateScores: Array<{
            templateId: string;
            utilityScore: number;
            excludedReasons: string[];
            benefitScore?: number;
            costPenalty?: number;
        }>;
        /** Phase 5.6: contributor objectives dropped from this decision's microcycle
         *  because they fell inadmissible during the taper authority's taper window -- see
         *  periodization.ts resolveMultiEventObjectives. Empty in the overwhelmingly
         *  common single-or-no-event case. */
        droppedContributorObjectives: DroppedContributorObjective[];
        /** Present exactly when an imported session was adjudicated. Carried to the
         * persisted audit unchanged so replay can name the revision it must verify. */
        externalPlan?: ExternalDecisionProvenance;
        /** An athlete-selected replacement was adjudicated instead of being selected by
         * catalog ranking. Its occurrence ID binds that authority to the primary session. */
        authoredOccurrence?: AuthoredOccurrenceProvenance;
        /** Compact simulator-only evidence. It excludes raw wearable payloads and
         * check-in text; provenance.ts does not persist it in RecommendationAudit. */
        calibration?: {
            fatigue: {
                rawExternalLoad: DimensionalFatigue;
                clampedExternalLoad: DimensionalFatigue;
                internalResponse: DimensionalFatigue;
                combined: DimensionalFatigue;
            };
            activeObjectives: Array<{
                key: ObjectiveKey;
                completedCredit: number;
                projectedCredit: number;
                requiredCredit: number;
            }>;
            fixedActivity: {
                count: number;
                cost: WorkoutCostProfile;
                stimulus: WorkoutStimulusProfile;
            };
        };
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
            weight?: string | null;
            spo2?: string | null;
            skinTempDeviation?: string | null;
        };
    };
    raw: {
        sleepScore: number | null;
        sleepDurationSec: number | null;
        deepSleepSec?: number | null;
        remSleepSec?: number | null;
        lightSleepSec?: number | null;
        awakeSleepSec?: number | null;
        restlessMomentsCount?: number | null;
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
        weightKg?: number | null;
        bodyFatPct?: number | null;
        spo2?: {
            avgPct?: number | null;
            minPct?: number | null;
            sleepAvgPct?: number | null;
        } | null;
        skinTempDeviationCelsius?: number | null;
        recoveryTimeHours?: number | null;
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
        /** Median absolute deviation (scaled by 1.4826), not population stdev -- see
         *  EngineObjectiveInput.respiration_mad_28d. Absent (undefined) on documents
         *  written before baselineComputationVersion 3. */
        respiration28dMad?: number | null;
        steps7dAvg?: number | null;
        steps28dAvg?: number | null;
        steps28dStdev?: number | null;
        /** Observation-only median/MAD baselines for sleep score, RHR, HRV, and steps,
         *  computed *alongside* the mean/stdev fields above rather than replacing them --
         *  see docs/adr/0006's v4 amendment. Nothing in rules.ts/fatigue.ts reads these
         *  yet; they exist for a future comparison against the live mean/stdev baselines
         *  before either one is cut over (matching ADR-0014's precedent for that decision).
         *  Absent (undefined) on documents written before baselineComputationVersion 4. */
        sleepScore7dMedian?: number | null;
        sleepScore28dMedian?: number | null;
        sleepScore28dMad?: number | null;
        restingHr7dMedian?: number | null;
        restingHr28dMedian?: number | null;
        restingHr28dMad?: number | null;
        hrv7dMedian?: number | null;
        hrv28dMedian?: number | null;
        hrv28dMad?: number | null;
        steps7dMedian?: number | null;
        steps28dMedian?: number | null;
        steps28dMad?: number | null;
        /** Observation-only median/MAD baselines for body battery wake and the "metric
         *  enrichment" fields (stress avg/max, training readiness score) -- see
         *  docs/adr/0006's v5 amendment. Unlike the fields above, these metrics have no
         *  mean/stdev counterpart at all yet. Nothing in rules.ts/fatigue.ts reads these.
         *  Absent (undefined) on documents written before baselineComputationVersion 5. */
        bodyBatteryWake7dMedian?: number | null;
        bodyBatteryWake28dMedian?: number | null;
        bodyBatteryWake28dMad?: number | null;
        stressAvg7dMedian?: number | null;
        stressAvg28dMedian?: number | null;
        stressAvg28dMad?: number | null;
        stressMax7dMedian?: number | null;
        stressMax28dMedian?: number | null;
        stressMax28dMad?: number | null;
        trainingReadinessScore7dMedian?: number | null;
        trainingReadinessScore28dMedian?: number | null;
        trainingReadinessScore28dMad?: number | null;
        deltas: {
            sleepScoreVs7d: number | null;
            sleepScoreVs28d: number | null;
            restingHrVs7d: number | null;
            restingHrVs28d: number | null;
            hrvVs7d: number | null;
            hrvVs28d: number | null;
            respirationVs7d: number | null;
            respirationVs28d: number | null;
            stepsVs7d?: number | null;
            stepsVs28d?: number | null;
            /** Observation-only median-baseline deltas -- see the sibling comment above. */
            sleepScoreVs7dMedian?: number | null;
            sleepScoreVs28dMedian?: number | null;
            restingHrVs7dMedian?: number | null;
            restingHrVs28dMedian?: number | null;
            hrvVs7dMedian?: number | null;
            hrvVs28dMedian?: number | null;
            stepsVs7dMedian?: number | null;
            stepsVs28dMedian?: number | null;
            /** Observation-only median-baseline deltas for body battery wake / stress /
             *  training readiness -- see the sibling comment above. */
            bodyBatteryWakeVs7dMedian?: number | null;
            bodyBatteryWakeVs28dMedian?: number | null;
            stressAvgVs7dMedian?: number | null;
            stressAvgVs28dMedian?: number | null;
            stressMaxVs7dMedian?: number | null;
            stressMaxVs28dMedian?: number | null;
            trainingReadinessScoreVs7dMedian?: number | null;
            trainingReadinessScoreVs28dMedian?: number | null;
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
        spo2Available?: boolean;
        skinTempAvailable?: boolean;
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
    /** Per-region detail (Phase 5.4), populated when painOrInjury is flagged. Keyed by
     *  BodyRegion; see injuryPolicy.ts resolveEffectiveInjuryConstraints for how this
     *  combines with the athlete's standing InjuryConstraint[]. */
    tissueResponses?: Partial<Record<BodyRegion, RegionTissueResponse>>;
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

// --- Phase 9.0: Shadow mode and the decision journal ---

/** Deliberately the exact five values of `externalSession.ts`'s `ExternalSessionDecision`
 *  -- see `docs/plans/phase-9-0-shadow-mode-and-decision-journal.md` 9.0.2. Duplicated
 *  rather than imported, the same reasoning as `EXTERNAL_MODIFY_MAX_SYSTEMIC_COST`: this
 *  keeps the journal's evidence-only types free of any dependency on the adjudication
 *  path. `decisionJournal.test.ts` asserts the two lists never drift apart. The comparison
 *  is only meaningful because both sides speak one vocabulary: do it, do it easier, move
 *  it, skip it, your call. */
export const SHADOW_VERDICTS = ['proceed', 'scale', 'defer', 'skip', 'advisory'] as const;
export type ShadowVerdict = typeof SHADOW_VERDICTS[number];

/**
 * One document per day at `users/{userId}/decision_journal/{date}`, recording the
 * athlete's own (non-engine) verdict alongside what actually happened, so the two can be
 * compared against the engine's `daily_recommendations/{date}` verdict. Never read by any
 * selection or safety path -- `engine/externalArchitecture.test.ts` enforces that
 * structurally, the same one-way boundary D-CRITIQUE draws for the weekly critique.
 *
 * Mutation lifecycle:
 * - Morning write (creation): sets `externalVerdict`, optional `externalNote`, and locks
 *   `sawEngineVerdictFirst`.
 * - Evening write (update): sets/updates `actualVerdict` and `updatedAt`.
 * - `sawEngineVerdictFirst` and `createdAt` are immutable after creation (enforced by
 *   `firestore.rules`) -- the whole point of the field is that it cannot be rewritten
 *   after the fact.
 */
export interface DecisionJournalEntry {
    userId: string;
    date: string; // Warsaw-local, matches the recommendation doc id
    /** What the athlete's own planner said to do today. */
    externalVerdict: ShadowVerdict;
    /** Free text, the athlete's own words. Never parsed. */
    externalNote?: string;
    /** Which the athlete saw first. The honest way to handle anchoring: measure it. */
    sawEngineVerdictFirst: boolean;
    /** What they actually did, in the same vocabulary. */
    actualVerdict?: ShadowVerdict;
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
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
    /** Race-date uncertainty (ADR-0012 Task 2.3). Only meaningful alongside targetDate +
     *  eventCategory -- validated by validateGoal (see validation.ts) and carried through
     *  goalToUserEvent (periodization.ts) into UserEvent.timing unchanged. Confirming a
     *  date is a single write that sets both confirmedDate and planningDate together --
     *  see validateEventTiming's invariant above. */
    timing?: EventTiming | null;
    /** Optional explicit taper start for this event. */
    taper?: EventTaperSpec | null;
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

/** Canonical list -- the single source of truth for BodyRegion. validation.ts and any UI
 * enumerating regions (e.g. DailyCheckin.tsx) must import this rather than re-listing the
 * union, so an added region can't compile while silently missing from a validator or UI. */
export const BODY_REGIONS = [
  'knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps',
  'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist',
] as const;

export type BodyRegion = typeof BODY_REGIONS[number];

export interface InjuryConstraint {
  region?: BodyRegion;
  severity: 'monitor' | 'limit' | 'exclude';
  /** ISO date; absent = indefinite. Expired entries are ignored, not deleted. */
  reviewBy?: string;
  note?: string;
  restrictedModalities?: SessionTemplate['modality'][];
}

/** Canonical list -- the single source of truth for TissueResponseLevel; see BODY_REGIONS
 * above for why this is exported rather than re-enumerated at each call site. */
export const TISSUE_LEVELS = ['normal', 'mild', 'moderate', 'severe'] as const;

/** A single tissue-response observation point, shared across the four signals below --
 * 'normal' means no restriction warranted by that signal alone. */
export type TissueResponseLevel = typeof TISSUE_LEVELS[number];

/** Per-region subjective tissue feedback for one check-in day (Phase 5.4). One scalar
 * `soreness` value can't distinguish a knee from an Achilles from general DOMS -- this
 * captures WHERE and WHEN a response was felt, since "knee hurt during yesterday's run"
 * and "knee felt stiff this morning with no training" call for different caution.
 * Never persisted as an `InjuryConstraint` itself and never written back to
 * TrainingSettings -- see injuryPolicy.ts's resolveEffectiveInjuryConstraints for how a
 * day's tissue response may only tighten (never weaken or clear) the athlete's standing
 * InjuryConstraint[]. */
export interface RegionTissueResponse {
  region: BodyRegion;
  /** How the region felt on waking, independent of any training. */
  morningState: TissueResponseLevel;
  /** Only meaningful when a session actually happened; absent = nothing to report. */
  painDuringTraining?: TissueResponseLevel;
  /** Immediately after that session. */
  afterTrainingState?: TissueResponseLevel;
  /** The following morning's reaction to that session. */
  nextMorningReaction?: TissueResponseLevel;
  /** Linkage to the session that provoked the response (M1.7 / ADR-0023 D-MRESP). */
  sourceSessionRef?: {
    kind: 'strength' | 'execution';
    id: string;
    date: string;
  };
}

export interface TrainingSettings {
    userId: string;
    schemaVersion: 2 | 3;
    equipment: Record<EquipmentKey, boolean>;
    guardrails: Record<GuardrailKey, boolean>;
    injuries?: InjuryConstraint[];
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
    /** Hard exclusion: the modality is unavailable and must not enter any candidate set.
     * Optional only for backward-compatible reads of pre-7.7 preference documents. */
    unavailableModalities?: Exclude<SessionTemplate['modality'], 'None'>[];
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
    gearTracker?: {
        items: GearItemSummary[];
        syncedAt?: string;
    };
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface GearItemSummary {
    gearPk: string;
    uuid?: string;
    customMakeModel?: string;
    displayName?: string;
    gearType?: string;
    brand?: string;
    model?: string;
    totalDistanceKm: number;
    maximumDistanceKm?: number;
    dateBegin?: string;
    dateEnd?: string;
    status: string;
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
    /** Absent is a supported legacy-compatible input; mode resolution supplies defaults. */
    trainingIntentProfile: TrainingIntentProfile | null;
    /** Statuses keep unavailable/corrupt data distinct from a genuinely absent record. */
    sourceStates?: {
        recoverySnapshot: DataStateSummary;
        subjectiveCheckin: DataStateSummary;
        activeGoals: DataStateSummary;
        trainingSettings: DataStateSummary;
        preferences: DataStateSummary;
        trainingIntentProfile: DataStateSummary;
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
    /** Composition-time dashboard diagnostic. It is not an engine decision input. */
    dataConfidence?: DataConfidenceScore;
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
    revision?: number;
    createdAt: string;
    updatedAt: string;
    adjustment?: SessionAdjustment;
    prescription?: WorkoutPrescription;
    /** Multidomain session bindings (M3.2 / ADR-0023 D-MSNAP). */
    primarySession?: SessionReferenceBinding;
    additionalSessions?: SessionReferenceBinding[];
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

/** Discriminated intensity gauge for one logged strength set (ADR-0021 D-GAUGE). `rir` and
 *  `rpe_rts` measure the same failure-proximity construct in different vocabulary and are
 *  mutually convertible -- but only at READ time; the persisted value is always exactly
 *  what the athlete entered. `velocity_loss` and `technical` measure output quality, not
 *  proximity to failure, and are never convertible to or from the other two. Consumers
 *  that need "how close to failure" (S2.1's 1RM estimator) must branch on `scale`, not
 *  assume every gauge answers that question. */
export type IntensityGauge =
    | { scale: 'rir'; value: number }
    | { scale: 'rpe_rts'; value: number }
    | { scale: 'velocity_loss'; percent: number }
    | { scale: 'technical'; met: boolean; note?: string };

/** One logged set (ADR-0021 D-SETLOG: this is the raw source of truth, never derived
 *  data written back). `completedAt` is what makes rest duration free -- consecutive
 *  sets' timestamps are the rest interval; no separate rest field is stored. */
export interface LoggedSet {
    setIndex: number;
    weightKg: number | null;
    reps: number;
    gauge?: IntensityGauge;
    isWarmup: boolean;
    completedAt: string;
    notes?: string;
}

/** `exerciseId` is a soft reference into workouts/exercises.ts, not an enforced foreign
 *  key -- an unrecognised or null id (free-text lift) is still loggable for overload
 *  tracking; it only loses the dimensional-cost derivation in S3.1, where it degrades to a
 *  discounted evidence tier rather than a rejected write. */
export interface LoggedExercise {
    exerciseId: string | null;
    freeTextName?: string;
    sets: LoggedSet[];
}

export type StrengthSessionState = 'in_progress' | 'completed' | 'abandoned';

/** Persisted at users/{uid}/strength_sessions/{sessionId} (ADR-0021). `date` is the
 *  Warsaw-local calendar date of session START, fixed at creation and never recomputed --
 *  a session crossing midnight belongs to its start date. `updatedAt` stamps every write
 *  (the schema block in the strength-session-logging plan omitted it; added here because a
 *  document rewritten on every set, per D-SETLOG's per-set persistence requirement, needs a
 *  monotonic field for read-layer revision tracking -- the same role `syncedAt` plays for
 *  NormalizedGarminActivity). `sessionRpe` is whole-session Borg CR-10 and is never an
 *  `IntensityGauge` -- a different construct from any set-level gauge. */
export interface StrengthSession {
    userId: string;
    sessionId: string;
    date: string;
    startedAt: string;
    completedAt?: string;
    updatedAt: string;
    state: StrengthSessionState;
    sourceRecommendationDate?: string;
    exercises: LoggedExercise[];
    sessionRpe?: number;
    notes?: string;
    schemaVersion: 1;
}

/** Backend-normalized Garmin activity stored at users/{uid}/activities/{activityId}. */
export interface ActivityZoneBucket {
    zoneNumber: number;
    secondsInZone: number;
    lowBoundary?: number;
}

export interface ActivityLapSummary {
    lapIndex: number;
    durationSeconds: number;
    averagePowerWatts?: number;
    averageHrBpm?: number;
}

export interface RunningDynamics {
    groundContactTimeMs?: number | null;
    groundContactBalanceLeftPct?: number | null;
    verticalOscillationCm?: number | null;
    verticalRatioPct?: number | null;
    strideLengthM?: number | null;
    avgRunningPowerWatts?: number | null;
    maxRunningPowerWatts?: number | null;
}

export interface ActivityExerciseSet {
    setOrder: number;
    setType?: string;
    repetitionCount?: number;
    weightKg?: number;
    exerciseCategory?: string;
    exerciseName?: string;
    durationSeconds?: number;
    restDurationSeconds?: number;
}

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
    primaryBenefit?: string | null;
    epoc?: number | null;
    recoveryTimeHours?: number | null;
    trainingEffectLabel?: string | null;
    powerInZones?: ActivityZoneBucket[];
    hrInZones?: ActivityZoneBucket[];
    normalizedPower?: number;
    intensityFactor?: number;
    variabilityIndex?: number;
    laps?: ActivityLapSummary[];
    runningDynamics?: RunningDynamics;
    exerciseSets?: ActivityExerciseSet[];
    syncRunId?: string;
    syncedAt?: string;
}

export interface ActivityOverride {
    activityId: string;
    userId: string;
    date: string;
    originalType: string;
    originalIntensityTag: string;
    overriddenModality: SessionTemplate['modality'] | 'Unknown';
    overriddenIntensity: CompletedTrainingIntensity;
    rpe?: number | null;
    stimulusFocus?: keyof WorkoutStimulusProfile | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type CompletedTrainingSource = 'garmin' | 'adherence' | 'manual';
export type CompletedTrainingIntensity = 'easy' | 'moderate' | 'hard' | 'unknown';
export type CompletedTrainingConfidence = 'high' | 'medium' | 'low';

/** The evidence hierarchy for inferring completed-training stimulus (Phase 5.5) -- see
 *  docs/plans/phase-5-sequence-planning.md 5.5 and completedTraining.ts's
 *  classifyGarminTier/stimulusConfidenceForTier. Strongest to weakest evidence.
 *  `completedStructuredWorkout` is named for completeness against the plan's full ladder
 *  but is not currently reachable -- no ingested source yet carries a structured
 *  completed-workout record independent of the prescribed template. `measuredEffort` IS
 *  reachable: classifyGarminTier returns it when a Garmin activity has both a training
 *  effect and a positive `activityTrainingLoad`, Garmin's own proprietary composite
 *  (derived from HR/pace/power across the session) standing in as the closest available
 *  approximation of true per-interval power/cadence structure. */
export type EvidenceTier =
    | 'exactPrescribedMatch'
    | 'completedStructuredWorkout'
    | 'measuredEffort'
    | 'garminTrainingEffect'
    /** An externally-authored session (ADR-0019 D-EXTTIER): structured and deliberate,
     * but written against no catalog, so its stimulus is derived rather than authored. */
    | 'authoredExternal'
    | 'durationIntensity'
    | 'athleteClassification'
    | 'genericModalityFallback';

/**
 * One real-world completed session after all available evidence is reconciled. It is an
 * engine-domain model, derived from durable source records; it is not itself persisted
 * in this first rollout phase.
 */
export interface CompletedTrainingEvent {
    id: string;
    date: string;
    durationMin: number | null;
    deliveredDose?: DeliveredDose;
    modality: SessionTemplate['modality'] | 'Unknown';
    intensity: CompletedTrainingIntensity;
    trainingEffect: number | null;
    estimatedCost: WorkoutCostProfile;
    estimatedStimulus: Partial<WorkoutStimulusProfile>;
    /** True exactly when estimatedStimulus came from a real catalog template's own
     *  stimulusProfile (an adherence-confirmed session matched to a known template) rather
     *  than a coarse modality/intensity default. Drives CompletedExposure.stimulusConfidence
     *  ('exact') independent of `confidence`, which instead reflects how well-evidenced the
     *  *modality/duration match* itself is and conflates that with stimulus provenance. */
    exactTemplateMatch: boolean;
    sources: CompletedTrainingSource[];
    confidence: CompletedTrainingConfidence;
    /** Which rung of the Phase 5.5 evidence hierarchy this event's stimulus was derived
     *  from. Optional only for legacy construction paths that predate this field. */
    evidenceTier?: EvidenceTier;
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
    /** Present for intent-aware recommendations so persisted decisions retain the
     * plan-owned volume and intensity contract used to choose them. */
    plannedDose?: PlannedDose;
    executionDose?: PlannedDose;
    candidateScores: Array<{
        templateId: string;
        utilityScore: number;
        excludedReasons: string[];
    }>;
    /** Phase 5.6: carried through from the decision's decisionTrace -- see
     *  DroppedContributorObjective's own doc comment. Empty in the overwhelmingly common
     *  single-or-no-event case. */
    droppedContributorObjectives: DroppedContributorObjective[];
    /** Present exactly when the decision adjudicated an imported session (ADR-0019). */
    externalPlan?: ExternalDecisionProvenance;
    /** Present exactly when an active replacement occurrence owned the primary session. */
    authoredOccurrence?: AuthoredOccurrenceProvenance;
    /** Multidomain session bindings (M3.2 / ADR-0023 D-MSNAP). */
    primarySession?: SessionReferenceBinding;
    additionalSessions?: SessionReferenceBinding[];
}

/** A compact, replayable record that a replacement occurrence, not catalog ranking,
 * selected the primary executable session (ADR-0023 D-MAUTH). */
export interface AuthoredOccurrenceProvenance {
    occurrenceId: string;
    decision: 'proceed' | 'scale';
}

/**
 * Identifies the exact stored bytes an external decision was made from (ADR-0019 D-IMMUT).
 *
 * `contentHash` is what makes the record falsifiable: a plan re-imported under the same
 * `revision` number produces a different hash, so replay can refuse it instead of
 * reproducing a decision against content that has quietly changed underneath it.
 */
export interface ExternalDecisionProvenance {
    planId: string;
    revision: number;
    sessionId: string;
    contentHash: string;
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
