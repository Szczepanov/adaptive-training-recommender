import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../../ledger/models';

// The check-in health-context types are ledger records (ADR-0052 #1144 PR1-1, owner Q2);
// re-exported so existing importers keep one entry point for the anomaly contract.
export type { HealthContextCheckin, HealthSymptomsCheckin, HealthSymptomType } from '../../../ledger/models';

export const HEALTH_ANOMALY_POLICIES = [
    'off',
    'shadow-v1',
    'visible-v1',
    'tighten-v1',
] as const;

export type HealthAnomalyPolicy = typeof HEALTH_ANOMALY_POLICIES[number];

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

export type BaselineMaturity = 'insufficient' | 'emerging' | 'reliable';

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
    baselineMaturity?: BaselineMaturity;
    contaminatedDaysExcluded?: number;
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

export type ActivityStratum = 'post_hard_or_high_cost' | 'post_easy_or_rest';

export interface ActivityMatchedSignalExpectation {
    signal: HealthCoreSignal;
    stratum: ActivityStratum;
    stratumSampleCount: number;
    unconditionalBaseline: number | null;
    shrunkExpectedValue: number | null;
    currentValue: number | null;
    residualFromExpected: number | null;
    residualStandardizedDeviation: number | null;
    withinExpectedTrainingResponse: boolean;
}

/**
 * HA2 output consumed by the HA3 evaluator. Feature plumbing remains threshold-free and does
 * not decide whether physiology is normal or anomalous.
 */
export interface HealthAnomalyFeatureSet {
    date: string;
    baselineVersion: number | null;
    coreSignals: HealthCoreSignalFeatures[];
    activityMatchedExpectations?: ActivityMatchedSignalExpectation[];
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
    | 'insufficient_evidence'
    | 'normal'
    | 'explained_recovery_strain'
    | 'watch_unexplained'
    | 'possible_illness_or_systemic_stress'
    | 'symptoms_reported';

export type HealthAnomalyCalibrationStage =
    | 'insufficient_evidence'
    | 'emerging_baseline'
    | 'reliable_baseline'
    | 'outcome_calibrated';

export type HealthAnomalySeverity = 'none' | 'mild' | 'moderate' | 'strong';

export type HealthAnomalyEvidenceQuality =
    | 'insufficient'
    | 'emerging'
    | 'single_channel'
    | 'correlated_autonomic_only'
    | 'multi_domain_corroborated';

export interface PersonalOutcomeCalibrationSummary {
    asOfDate: string;
    priorEpisodesCount: number;
    illnessConfirmedCount: number;
    confounderExplainedCount: number;
    noIllnessCount: number;
    unknownCount: number;
    positiveRespiratoryTestsCount: number;
    negativeRespiratoryTestsCount: number;
    medianLeadTimeDays: number | null;
    calibrationEligible: boolean;
}

export type EarlyResponseLevel =
    | 'none'
    | 'level_1_early_watch'
    | 'level_2_persistent_or_corroborated'
    | 'level_3_symptoms_reported';

export interface EarlyResponseProtocol {
    level: EarlyResponseLevel;
    headline: string;
    summary: string;
    actions: string[];
    reassessTiming: string;
    nonDiagnosticNotice: string;
    redFlagWarnings: string[];
    returnToSportGuidance: string[];
    followupPromptEligible: boolean;
}

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
    emergingHistoryCount?: number;
    allowFirstNightMultiDomainEscalation?: boolean;
    downgradeResolvingRespiration?: boolean;
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
    /** Legacy name: this counter preserves consecutive adverse core physiology even when context is strong. */
    unexplainedPersistenceDays: number;
    /** Consecutive prior days where at least one adverse core signal remained unexplained by strong context. */
    priorUnexplainedDays?: number;
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
    /** Issue #809: prior high-dose sessions also explain next-day RHR/HRV strain. */
    last3DaysHighCostSessionsCount?: number;
    structuredContext?: HealthAnomalyStructuredContext | null;
    personalCalibration?: PersonalOutcomeCalibrationSummary | null;
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
    unexplainedPersistenceDays?: number;
    episodeId: string | null;
    episodeDay: number | null;
    dataQuality: CoreSignalDataQuality[];
    rationale: HealthAnomalyRationaleTokens;
    /** Observation-only HA9 evidence. It is not an input to the live training selector. */
    respirationElevation?: RespirationElevationEvidence;
    calibrationStage?: HealthAnomalyCalibrationStage;
    anomalySeverity?: HealthAnomalySeverity;
    evidenceQuality?: HealthAnomalyEvidenceQuality;
    earlyResponse?: EarlyResponseProtocol;
    activityMatchedExpectations?: ActivityMatchedSignalExpectation[];
    personalCalibration?: PersonalOutcomeCalibrationSummary | null;
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
    previousAssessmentRevisionId?: string | null;
    contaminatedDates?: string[];
    personalCalibrationRevision?: string | null;
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
