/**
 * Ledger record types: persisted user data and observations (recovery snapshots, check-ins,
 * injury records, activities, strength logs, settings and preferences) and the vocabulary
 * they use. ADR-0052 Phase 1 (#1144): these describe what the ledger *records*, not what the
 * engine decides, so they live outside `engine/` and must never import from it.
 * `engine/models.ts` re-exports everything here for compatibility.
 */
import type { AthletePerformanceProfile } from '../workouts/models.ts';

export type PhysicalWorkDuration = 'short' | 'medium' | 'extended'; // <1h, 1-3h, 3h+
export type PhysicalWorkIntensity = 'moderate' | 'hard' | 'exhausting';
export type PhysicalWorkLoadArea =
    | 'grip_forearms'
    | 'upper_body'
    | 'lower_back_spine'
    | 'legs_carrying';

export type OccupationalBaselineSource = 'user_authored' | 'history_inferred' | 'unknown';
export interface OccupationalLoadBaseline {
    typicalDuration: PhysicalWorkDuration;
    typicalIntensity: PhysicalWorkIntensity;
    typicalLoadAreas: PhysicalWorkLoadArea[];
    source: OccupationalBaselineSource;
    confidence: number;
}

export interface PhysicalWorkCheckin {
    performed: boolean;
    duration?: PhysicalWorkDuration;
    intensity?: PhysicalWorkIntensity;
    loadAreas?: PhysicalWorkLoadArea[];
    notes?: string | null;
}

export const NUTRITION_TRACKING_ADHERENCE_LEVELS = [
    'fully_tracked',
    'mostly_tracked',
    'minimal',
    'untracked',
    'fasted',
] as const;
export type NutritionTrackingAdherence = typeof NUTRITION_TRACKING_ADHERENCE_LEVELS[number];

export type RedFlagCategory =
    | 'neurological'
    | 'acute_trauma_structural'
    | 'systemic_infection'
    | 'rapidly_worsening';

export interface RedFlagCheckin {
    present: boolean;
    categories?: RedFlagCategory[];
    notes?: string | null;
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

export type Modality = 'Running' | 'Cycling' | 'Swimming' | 'Walking' | 'Strength' | 'Field' | 'Mobility' | 'Cross Training' | 'None';

// --- Firestore Canonical Models (Phase 3) ---

/** Raw Garmin activity summary for a single day, as stored under `raw.yesterdayTraining` / `raw.todayTraining`. */
export interface RawActivitySummary {
    activityCount?: number;
    totalDurationMin?: number;
    /** High-intensity stimulus sessions (issue #809 semantics when
     * `intensityClassificationVersion` >= 2; legacy TE/avg-HR "hard" otherwise). */
    hardActivityCount?: number;
    /** Issue #809: sessions with high/very_high session cost (dose), independent of stimulus. */
    highCostActivityCount?: number;
    /** Lowest classification version among the day's activities; absent if any is legacy. */
    intensityClassificationVersion?: number | null;
    primaryActivity?: {
        activityId: number | string;
        type: string;
        durationMin: number | null;
        trainingEffect: number;
        intensityTag: string;
        sessionCost?: ActivitySessionCost | null;
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
            energyExpenditure?: string | null;
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
        /** Issue #809: D-1..D-3 sessions with high/very_high session cost (dose). */
        last3DaysHighCostSessionsCount?: number;
        /** Lowest classification version over the D-1..D-3 window; null if any is legacy. */
        last3DaysIntensityClassificationVersion?: number | null;
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
        activeEnergyKcal?: number | null;
        restingEnergyKcal?: number | null;
        totalEnergyExpenditureKcal?: number | null;
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
        /** Sleep-duration median/MAD baseline, accumulated 2d/3d deficit (signed: positive
         *  = net shortfall, negative = net surplus, over the most recent N nights *through
         *  and including* tonight -- null if tonight's sleep duration is unavailable, never
         *  silently falling back to a stale D-1/D-2-only aggregate), and bedtime/wake-time/
         *  sleep-midpoint circular-mean baselines (minutes since local midnight -- circular,
         *  not linear, because clock times wrap at midnight). See docs/analysis/
         *  2026-08-29-sleep-decision-authority-phase-2-implementation.md. Nothing in
         *  rules.ts/fatigue.ts reads these. Absent (undefined) on documents written before
         *  baselineComputationVersion 6. */
        sleepDuration7dMedian?: number | null;
        sleepDuration28dMedian?: number | null;
        sleepDuration28dMad?: number | null;
        sleepDurationAccumulated2dDeficitSec?: number | null;
        sleepDurationAccumulated3dDeficitSec?: number | null;
        bedtime7dCircularMeanMinutes?: number | null;
        bedtime28dCircularMeanMinutes?: number | null;
        wakeTime7dCircularMeanMinutes?: number | null;
        wakeTime28dCircularMeanMinutes?: number | null;
        sleepMidpoint7dCircularMeanMinutes?: number | null;
        sleepMidpoint28dCircularMeanMinutes?: number | null;
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
            /** Sleep-duration median-baseline deltas and circular time-of-day deviations --
             *  see the sibling comment above `sleepDuration7dMedian`. Circular deltas are a
             *  signed shortest-arc difference in minutes, not a linear subtraction (which
             *  would give a huge, wrong value whenever baseline and current straddle
             *  midnight). Absent (undefined) on documents written before
             *  baselineComputationVersion 6. */
            sleepDurationVs7dMedian?: number | null;
            sleepDurationVs28dMedian?: number | null;
            bedtimeDeviationVs7dMinutes?: number | null;
            bedtimeDeviationVs28dMinutes?: number | null;
            wakeTimeDeviationVs7dMinutes?: number | null;
            wakeTimeDeviationVs28dMinutes?: number | null;
            sleepMidpointDeviationVs7dMinutes?: number | null;
            sleepMidpointDeviationVs28dMinutes?: number | null;
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

export interface HealthContextCheckin {
    /** Unknown when omitted. Explicit zero means the athlete answered none. */
    alcoholDrinksLast24h?: 0 | 1 | 2 | 3;
    travelDisruption?:
        | 'none'
        | 'local_or_no_timezone'
        | 'timezone_shift'
        | 'late_arrival_or_disrupted_sleep';
    /** Signed offset change in hours. Null/omitted means unknown. */
    timezoneShiftHours?: number | null;
    unusualHeatOrSauna?: boolean | null;
    dehydrationOrFluidLoss?: boolean | null;
    recentVaccination?: boolean | null;
    medicationChange?: boolean | null;
    closeSickContact?: boolean | null;
    /** Opaque user content. Never use the text itself as evaluator evidence. */
    otherDisruption?: string | null;
    symptoms?: HealthSymptomsCheckin;
}

export interface HealthSymptomsCheckin {
    present: boolean;
    onset?: 'today' | 'yesterday' | '2_3_days' | 'earlier' | null;
    severity?: 'mild' | 'moderate' | 'severe' | null;
    /** Null is accepted as an explicit clear for migration/update symmetry. */
    types?: HealthSymptomType[] | null;
    /** Athlete's own best guess at cause. Unset/'unsure' keeps the conservative default
     *  treatment; only an explicit 'allergy' can soften engine gating (see adapters.ts). */
    suspectedCause?: 'infectious' | 'allergy' | 'unsure' | null;
}

export type HealthSymptomType =
    | 'sore_throat'
    | 'congestion'
    | 'runny_nose'
    | 'sneezing'
    | 'cough'
    | 'fever_or_chills'
    | 'headache_or_body_aches'
    | 'gastrointestinal'
    | 'unusual_fatigue'
    | 'other';

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
    /** Clinical red flags requiring medical referral (SEP-C4). */
    redFlags?: RedFlagCheckin;
    /** Per-region detail (Phase 5.4), populated when painOrInjury is flagged. Keyed by
     *  BodyRegion; see injuryPolicy.ts resolveEffectiveInjuryConstraints for how this
     *  combines with the athlete's standing InjuryConstraint[]. */
    tissueResponses?: Partial<Record<BodyRegion, RegionTissueResponse>>;
    /** Optional unlogged non-exercise physical activity / heavy manual labor completed yesterday (D-1). */
    physicalWork?: PhysicalWorkCheckin;
    /** Athlete-authored or conservatively inferred usual occupational load context. */
    occupationalBaseline?: OccupationalLoadBaseline;
    /** Optional within-person appetite rating 1-10 (ADR-0039 D-BC-HUNGER). Zero recommendation authority. */
    hunger1To10?: number | null;
    /** Context timing for the hunger rating. Preferred comparison series is morning_pre_breakfast. */
    hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
    /** Optional subjective rating of yesterday's (D-1) calorie tracking completeness. Zero recommendation authority (ADR-0042). */
    nutritionAdherenceYesterday?: NutritionTrackingAdherence | null;
    /** Optional health context: disruptions and symptoms (ADR-0025, ADR-0032). */
    healthContext?: HealthContextCheckin;
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
export type LegacyEquipmentKey = 'free_weights' | 'cable_machine' | 'treadmill' | 'indoor_bike' | 'pullup_bar';
export type SportAccessKey = 'outdoor_bike' | 'swim_access';
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
  /** Warsaw-local calendar dates; absent creation date means unknown. */
  createdAt?: string;
  resolvedAt?: string;
  region?: BodyRegion;
  severity: 'monitor' | 'limit' | 'exclude';
  /** ISO date; absent = indefinite. Expired entries are ignored, not deleted. */
  reviewBy?: string;
  note?: string;
  restrictedModalities?: Modality[];
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
    equipment: Record<LegacyEquipmentKey, boolean> & Partial<Record<SportAccessKey, boolean>>;
    guardrails: Record<GuardrailKey, boolean>;
    injuries?: InjuryConstraint[];
    injuryHistory?: InjuryConstraint[];
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
    /** ADR-0038: durable recovery-policy enrollment epoch B. Never slides once established. */
    recoveryBootstrapDate?: string | null;
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
    unavailableModalities?: Exclude<Modality, 'None'>[];
    // UI/Explanation preferences
    explanationVerbosity: 'brief' | 'detailed' | 'technical';
    conservativeBias: boolean;
    extraRecoveryMargin?: boolean;
    /** Phase 9.0.3's shadow-mode reveal gate and Decision Journal card are an opt-in
     *  evidence-collection tool for one athlete's own manual-AI-loop comparison, not a
     *  general onboarding surface -- undefined/false (the default for every account,
     *  including brand-new ones) keeps Home showing today's recommendation immediately. */
    shadowModeEnabled?: boolean;
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
    maxHrBpm?: number;
    distanceMeters?: number;
    averageSpeedMps?: number;
}

export type ActivitySegmentType = 'work' | 'recovery' | 'sprint' | 'steady' | 'surge' | 'warmup' | 'cooldown' | 'unknown';
export type ActivitySegmentIdentitySource = 'fit_workout_step' | 'manual_lap' | 'detected' | 'unknown';
export type ActivityEvidenceConfidence = 'high' | 'moderate' | 'low';

export interface ActivityPrescribedTarget {
    kind: string;
    value?: number;
    low?: number;
    high?: number;
    text?: string;
}

export interface ActivitySegmentSummary {
    segmentIndex: number;
    segmentType: ActivitySegmentType;
    identitySource: ActivitySegmentIdentitySource;
    startOffsetSeconds?: number;
    durationSeconds: number;
    prescribedTarget?: ActivityPrescribedTarget;
    averagePowerWatts?: number;
    peak1sPowerWatts?: number;
    peak5sPowerWatts?: number;
    peak10sPowerWatts?: number;
    averageHrBpm?: number;
    endHrBpm?: number;
    maxHrBpm?: number;
    averageCadenceRpm?: number;
    maxCadenceRpm?: number;
    firstThirdPowerWatts?: number;
    middleThirdPowerWatts?: number;
    lastThirdPowerWatts?: number;
    lastThirdHrBpm?: number;
    evidenceConfidence: ActivityEvidenceConfidence;
}

export interface ActivityPowerDurationPeak {
    durationSeconds: number;
    powerWatts: number;
    confidence: ActivityEvidenceConfidence;
    elapsedBeforeSeconds?: number;
    activityHalf?: 'first' | 'second';
}

export interface ActivitySteadyHalfSummary {
    firstPowerWatts?: number;
    secondPowerWatts?: number;
    firstHrBpm?: number;
    secondHrBpm?: number;
    firstCadenceRpm?: number;
    secondCadenceRpm?: number;
}

export interface ActivityResponseTelemetry {
    derivationVersion: string;
    sourceResolution: {
        powerSeconds?: number;
        hrSeconds?: number;
        cadenceSeconds?: number;
    };
    segmentCountTotal: number;
    segmentsTruncated: boolean;
    segments: ActivitySegmentSummary[];
    powerDurationPeaks: ActivityPowerDurationPeak[];
    steadyHalves?: ActivitySteadyHalfSummary;
}

export type HrSensorTechnology = 'electrode_chest_strap' | 'optical_armband' | 'wrist_ppg' | 'external_unknown' | 'unknown';
export type HrSourceForActivity = 'external' | 'wrist' | 'mixed_possible' | 'unknown';
export type HrProvenanceConfidence = 'confirmed' | 'inferred' | 'ambiguous' | 'unknown';
export type HrActivityMotionRisk = 'low' | 'moderate' | 'high' | 'unknown';
export type HrSignalQuality = 'clean' | 'suspect' | 'poor' | 'unknown';
export type HrMeasurementConfidence = 'high' | 'moderate' | 'low' | 'unreliable' | 'unknown';
export type HrSummaryCompatibility = 'verified_same_effective_trace' | 'consistent_unproven' | 'discordant' | 'not_comparable' | 'unknown';

/** Compact activity-level HR measurement evidence, never a readiness signal. */
export interface HrMeasurement {
    externalHrSensorPresent: boolean | null;
    sourceForActivity: HrSourceForActivity;
    provenanceConfidence: HrProvenanceConfidence;
    sensorTechnology: HrSensorTechnology;
    activityMotionRisk: HrActivityMotionRisk;
    coveragePct: number | null;
    longestGapSeconds: number | null;
    signalQuality: HrSignalQuality;
    measurementConfidence: HrMeasurementConfidence;
    summaryCompatibility: HrSummaryCompatibility;
    artifactFlags: string[];
    reasons: string[];
    diagnosticVersion: string;
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

export const GARMIN_DETAIL_FETCH_STATUSES = ['fetched', 'failed', 'rate_limited', 'not_attempted'] as const;
export type GarminDetailFetchStatus = (typeof GARMIN_DETAIL_FETCH_STATUSES)[number];

/** `attemptedAt` is the UTC instant of the sync decision shared by the whole run, not a
 * per-request time and not a calendar date. */
export interface GarminExerciseSetsFetchOutcome {
    status: GarminDetailFetchStatus;
    attemptedAt: string;
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

export type ActivityStimulusDomain =
    'recovery' | 'endurance' | 'tempo' | 'threshold' | 'vo2' | 'anaerobic' | 'mixed' | 'race' | 'strength' | 'unknown';
export type ActivitySessionCost = 'low' | 'moderate' | 'high' | 'very_high' | 'unknown';

export interface NormalizedGarminActivity {
    activityId: string;
    date: string;
    /** Absolute UTC instants derived from Garmin's startTimeGMT + duration (ADR-0034) --
     * distinct from `date`, which is a Warsaw-local calendar day. Reconciliation requires
     * absolute-timestamp overlap/proximity, not date-only matching; both are absent for
     * activities ingested before this field existed, or when Garmin omitted startTimeGMT. */
    startedAt?: string;
    endedAt?: string;
    type: string;
    durationMin: number | null;
    trainingEffectAerobic: number | null;
    trainingEffectAnaerobic: number | null;
    averageHr: number | null;
    /** Peak activity HR as the provider reported it. Display only -- no decision authority. */
    maxHr?: number;
    activityTrainingLoad: number | null;
    /** Stimulus (exercise) intensity: easy | moderate | hard. From
     * `intensityClassificationVersion` 2 (issue #809) this is decoupled from session dose --
     * "hard" means a high-intensity stimulus, never merely a long/costly session. Records
     * without a version carry the legacy TE/average-HR semantics and are not reinterpreted. */
    intensityTag: string;
    /** Issue #809: physiological domain that dominated the work (recovery, endurance, tempo,
     * threshold, vo2, anaerobic, mixed, race, strength, unknown). */
    stimulusDomain?: ActivityStimulusDomain;
    /** Issue #809: total session dose (low | moderate | high | very_high | unknown); can rise
     * with duration while the stimulus stays aerobic. */
    sessionCost?: ActivitySessionCost;
    /** Issue #809: which evidence tier decided the stimulus (provenance). */
    intensityEvidence?: string;
    intensityClassificationVersion?: number;
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
    /** Issue #1051: normalized outcome of the Garmin strength `exerciseSets` fetch. Absent on
     * records synced before the status was stored and on activities the sync made no decision
     * about (older lookback, non-strength). Diagnostic evidence only; no engine decision reads it. */
    detailStatus?: { exerciseSets?: GarminExerciseSetsFetchOutcome };
    /** Issue #850: bounded, provider-neutral features derived from the transient native
     * FIT trace. Raw samples are never persisted. Display/analysis evidence only. */
    activityResponse?: ActivityResponseTelemetry;
    hrMeasurement?: HrMeasurement;
    /** PR 5 (training-occurrence plan, ADR-0034 "FIT structured-workout identity"): a
     * versioned fingerprint of a device-recorded FIT workout structure (workout name +
     * step-index set), present only when Garmin activity HR-fidelity FIT decoding is
     * enabled and found workout evidence. This is Garmin's on-device workout structure.
     * When the recorded workout is one Adaptive exported, its semantic fingerprint can equal
     * the execution's launch-time fingerprint, which reconciliation scoring
     * (`reconciliationScore.ts`) and the ADR-0051 D7 diagnostic compare. Absence means no
     * decodable workout structure, not "not yet computed". */
    fitWorkoutFingerprint?: string;
    fitWorkoutFingerprintKind?: FitWorkoutFingerprintKind;
    syncRunId?: string;
    syncedAt?: string;
}

export const FIT_WORKOUT_FINGERPRINT_KINDS = ['semantic_definition', 'index_fallback'] as const;
export type FitWorkoutFingerprintKind = (typeof FIT_WORKOUT_FINGERPRINT_KINDS)[number];
