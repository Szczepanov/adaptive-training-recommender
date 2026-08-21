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
    types?: HealthSymptomType[];
}

export type HealthSymptomType =
    | 'sore_throat'
    | 'congestion'
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

export interface HealthAnomalyPersistenceInput {
    previousState: PhysiologicalAnomalyState | null;
    previousEpisodeId: string | null;
    previousEpisodeDay: number | null;
    unexplainedPersistenceDays: number;
}

export interface HealthAnomalyInput {
    date: string;
    timezone: 'Europe/Warsaw';
    recoverySnapshot: DailyRecoverySnapshot | null;
    subjectiveCheckin: DailySubjectiveCheckin | null;
    coreSignals: CoreSignalEvidence[];
    supportingSignals: SupportingSignalEvidence[];
    dataQuality: CoreSignalDataQuality[];
    last3DaysHardSessionsCount: number;
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
    policyVersion: string;
    mode: Exclude<HealthAnomalyPolicy, 'off'>;
}
