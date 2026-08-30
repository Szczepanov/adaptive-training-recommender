import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';

export const HEALTH_ANOMALY_POLICIES = [
    'off',
    'shadow-v1',
    'visible-v1',
    'tighten-v1',
] as const;

export type HealthAnomalyPolicy = typeof HEALTH_ANOMALY_POLICIES[number];

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

/**
 * Module augmentation keeps the health-context contract isolated from the training-readiness
 * model while preserving DailySubjectiveCheckin as the canonical persisted check-in shape.
 */
declare module './models' {
    interface DailySubjectiveCheckin {
        healthContext?: HealthContextCheckin;
    }
}

export type HealthCoreSignal = 'rhr' | 'respiration' | 'hrv';

export interface CoreSignalEvidence {
    signal: HealthCoreSignal;
    status: 'unavailable' | 'normal' | 'moderate_anomaly' | 'strong_anomaly';
    direction: 'high' | 'low' | 'two_sided' | null;
    currentValue: number | null;
    baselineValue: number | null;
    scaleValue: number | null;
    standardizedDeviation: number | null;
    estimator: string | null;
    baselineVersion: number | null;
}

export interface CoreSignalDataQuality {
    signal: HealthCoreSignal;
    historyCount: number;
    recentDayCoverage: number;
    baselineWindowStart: string | null;
    baselineWindowEndExclusive: string | null;
    baselineAgeDays: number | null;
    zeroOrNearZeroScale: boolean;
    currentValueMissing: boolean;
    suspectedQuantizationOrTies: boolean;
}

/** Candidate estimators are observation-only in HA2; HA3 chooses how to interpret them. */
export type HealthAnomalyEstimator =
    | 'mean-stdev-28d'
    | 'median-mad-28d'
    | 'log-mean-stdev-28d';

export type HealthSignalFeatureUnavailableReason =
    | 'missing_current'
    | 'missing_baseline'
    | 'missing_scale'
    | 'insufficient_history'
    | 'incompatible_baseline_version'
    | 'near_zero_scale'
    | 'invalid_domain';

/**
 * A threshold-free comparison feature. `standardizedDeviation` is only computed when the
 * measured scale is safely non-zero; HA2 never fabricates a denominator or anomaly state.
 */
export interface HealthSignalFeatureCandidate {
    estimator: HealthAnomalyEstimator;
    status: 'available' | 'unavailable';
    unavailableReason: HealthSignalFeatureUnavailableReason | null;
    currentValue: number | null;
    baselineValue: number | null;
    scaleValue: number | null;
    deltaValue: number | null;
    standardizedDeviation: number | null;
    baselineVersion: number | null;
}

export interface HealthCoreSignalFeatures {
    signal: HealthCoreSignal;
    adverseDirection: 'high' | 'low';
    candidates: HealthSignalFeatureCandidate[];
    dataQuality: CoreSignalDataQuality;
    /** Null means the canonical snapshot does not preserve enough source-level provenance. */
    measurementProvenance: string | null;
}

/**
 * HA2 output consumed by the HA3 evaluator. Feature plumbing remains threshold-free and does
 * not decide whether physiology is normal or anomalous.
 */
export interface HealthAnomalyFeatureSet {
    date: string;
    baselineVersion: number | null;
    coreSignals: HealthCoreSignalFeatures[];
}

export interface SupportingSignalEvidence {
    code: string;
    status: 'unavailable' | 'normal' | 'adverse' | 'supportive';
    value: number | string | boolean | null;
    detail?: string | null;
}

export type ContextExplanationKind =
    | 'hard_training'
    | 'short_or_poor_sleep'
    | 'psychological_stress'
    | 'alcohol'
    | 'travel_or_jetlag'
    | 'heat_or_sauna'
    | 'dehydration'
    | 'vaccination'
    | 'medication_change'
    | 'other';

export interface ContextExplanation {
    kind: ContextExplanationKind;
    strength: 'weak' | 'moderate' | 'strong';
    explainsSignals: HealthCoreSignal[];
    evidence: string[];
}

export type PhysiologicalAnomalyState =
    | 'normal'
    | 'explained_recovery_strain'
    | 'watch_unexplained'
    | 'possible_illness_or_systemic_stress'
    | 'symptoms_reported';

export interface HealthAnomalyThresholdPolicy {
    policyVersion: string;
    moderateDeviation: number;
    strongDeviation: number;
    minimumCoreSignalsForMultiSignal: number;
    persistenceDaysForEscalation: number;
    minimumHistoryCount: number;
    minimumRecentDayCoverage: number;
    maxBaselineAgeDays: number;
    estimatorBySignal: Record<HealthCoreSignal, HealthAnomalyEstimator>;
}

export interface HealthAnomalyStructuredContext {
    /** Null means the plan-block read was unavailable/invalid rather than "no travel". */
    authoredTravelActive: boolean | null;
    authoredTravelRevision: string | null;
}

export interface HealthAnomalyRationaleFact {
    code: string;
    value?: number | string | boolean | null;
    unit?: string | null;
}

export interface HealthAnomalyRationaleTokens {
    facts: HealthAnomalyRationaleFact[];
    explanations: string[];
    cautions: string[];
}

export type RespirationElevationStatus =
    | 'unavailable'
    | 'normal'
    | 'elevated'
    | 'strongly_elevated'
    | 'resolving';

export type RespirationElevationReasonCode =
    | 'MEASUREMENT_INELIGIBLE'
    | 'MISSING_CURRENT'
    | 'INVALID_CURRENT'
    | 'DATE_PROVENANCE_MISMATCH'
    | 'INCOMPATIBLE_BASELINE_VERSION'
    | 'INSUFFICIENT_HISTORY'
    | 'INSUFFICIENT_RECENT_COVERAGE'
    | 'MISSING_7D_BASELINE'
    | 'MISSING_28D_BASELINE'
    | 'ABOVE_ELEVATED_PERSONAL_DELTAS'
    | 'ABOVE_STRONG_PERSONAL_DELTAS'
    | 'RECENT_DELTA_NON_POSITIVE'
    | 'BELOW_ELEVATION_BOUNDARY';

export interface RespirationElevationPolicy {
    policyVersion: string;
    minimumBaselineVersion: number;
    minimumHistoryCount: number;
    minimumRecentDayCoverage: number;
    elevatedDeltaVs28d: number;
    elevatedDeltaVs7d: number;
    strongDeltaVs28d: number;
    strongDeltaVs7d: number;
}

export interface RespirationElevationInput {
    targetDate: string;
    measurementDate: string | null;
    timezone: 'Europe/Warsaw';
    currentValue: number | null;
    baseline7dValue: number | null;
    baseline28dValue: number | null;
    baselineVersion: number | null;
    historyCount: number;
    recentDayCoverage: number;
    measurementEligible: boolean;
}

export interface RespirationElevationEvidence {
    status: RespirationElevationStatus;
    currentValue: number | null;
    baseline7dValue: number | null;
    baseline28dValue: number | null;
    deltaVs7d: number | null;
    deltaVs28d: number | null;
    baselineVersion: number | null;
    historyCount: number;
    recentDayCoverage: number;
    reasonCodes: RespirationElevationReasonCode[];
    policyVersion: string;
}

export interface HealthAnomalyPersistenceInput {
    previousState: PhysiologicalAnomalyState | null;
    previousEpisodeId: string | null;
    previousEpisodeDay: number | null;
    previousAssessmentDate?: string | null;
    /** Legacy name: this counter now preserves consecutive adverse core physiology even when context is strong. */
    unexplainedPersistenceDays: number;
}

export interface HealthAnomalyInput {
    date: string;
    timezone: 'Europe/Warsaw';
    recoverySnapshot: DailyRecoverySnapshot | null;
    subjectiveCheckin: DailySubjectiveCheckin | null;
    features?: HealthAnomalyFeatureSet | null;
    /** Compatibility/testing seam for callers that have not yet adopted HA2 feature mapping. */
    coreSignals: CoreSignalEvidence[];
    supportingSignals: SupportingSignalEvidence[];
    dataQuality: CoreSignalDataQuality[];
    last3DaysHardSessionsCount: number;
    structuredContext?: HealthAnomalyStructuredContext | null;
    persistence: HealthAnomalyPersistenceInput;
}

export interface PhysiologicalAnomalyAssessment {
    state: PhysiologicalAnomalyState;
    evidenceLevel: 'none' | 'low' | 'moderate' | 'high';
    coreSignals: CoreSignalEvidence[];
    supportingSignals: SupportingSignalEvidence[];
    explanations: ContextExplanation[];
    unexplainedEvidence: string[];
    persistenceDays: number;
    episodeId: string | null;
    episodeDay: number | null;
    dataQuality: CoreSignalDataQuality[];
    rationale: HealthAnomalyRationaleTokens;
    /** Observation-only HA9 evidence. It is not an input to the live training selector. */
    respirationElevation?: RespirationElevationEvidence;
    policyVersion: string;
    thresholdPolicyVersion: string;
    mode: Exclude<HealthAnomalyPolicy, 'off'>;
}

export interface HealthAnomalySourceIdentity {
    timezone: 'Europe/Warsaw';
    recoverySnapshotRevision: string | null;
    checkinRevision: string | null;
    historyWindowStart: string;
    historyWindowEndExclusive: string;
    historySnapshotRevisions: Array<{ date: string; revision: string }>;
    travelContextRevision: string | null;
    persistenceLookbackStart: string;
}

export interface HealthAnomalyAssessmentRevision {
    userId: string;
    date: string;
    revisionId: string;
    idempotencyKey: string;
    computedAt: string;
    policyVersion: string;
    thresholdPolicy: HealthAnomalyThresholdPolicy;
    mode: Exclude<HealthAnomalyPolicy, 'off'>;
    source: HealthAnomalySourceIdentity;
    assessment: PhysiologicalAnomalyAssessment;
    schemaVersion: 1;
}
