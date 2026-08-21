export type EvidencePlane = 'decision' | 'process_response' | 'outcome';

export type ObservationIntent = 'training' | 'testing' | 'competition';

export type OutcomeRole = 'primary' | 'secondary' | 'context';

export type MetricDirection =
    | 'higher_is_better'
    | 'lower_is_better'
    | 'target_range'
    | 'context_only';

export type MetricDomain = 'cycling' | 'running' | 'field' | 'strength' | 'general';

export interface MetricDefinition {
    id: string;
    displayName: string;
    domain: MetricDomain;
    unit: string;
    direction: MetricDirection;
    valueKind: 'scalar';
    description: string;
}

/**
 * V1 comparison context is intentionally cycling-first. Add dimensions only when a real
 * protocol needs them; do not turn this into a speculative cross-sport taxonomy.
 */
export type ComparisonDimension =
    | 'power_source_id'
    | 'bike_setup_id'
    | 'test_environment'
    | 'course_or_trainer_id'
    | 'duration_seconds'
    | 'start_mode'
    | 'warmup_revision'
    | 'feedback_rule'
    | 'weather_note';

export type ComparisonContextValue = string | number | boolean;

export type ComparisonContext = Readonly<Partial<Record<ComparisonDimension, ComparisonContextValue>>>;

/**
 * Measurement protocols describe evidence collection. They deliberately do not introduce a
 * second executable-workout language; the existing session runner remains the execution
 * authority once testing workflow integration lands in OV3.
 */
export interface ProtocolInstruction {
    id: string;
    text: string;
}

export interface MeasurementProtocol {
    id: string;
    revision: number;
    title: string;
    intent: 'testing';
    metricIds: readonly string[];
    instructions: readonly ProtocolInstruction[];
    warmupRef?: string;
    comparisonContext: {
        required: readonly ComparisonDimension[];
        seriesDefining: readonly ComparisonDimension[];
        contextOnly: readonly ComparisonDimension[];
        canonicalizationVersion: string;
    };
    familiarization: {
        required: boolean;
        minimumExposures: number;
    };
    burden: 'low' | 'moderate' | 'high';
    expectedRecoveryHours?: number;
    invalidationRules: readonly string[];
    createdAt: string;
}

export interface ComparisonSeries {
    metricId: string;
    protocolId: string;
    protocolRevision: number;
    canonicalizationVersion: string;
    key: string;
}

export type ReliabilitySource =
    | 'literature_reference'
    | 'personal_repeatability'
    | 'manual';

export interface ReliabilityEstimate {
    source: ReliabilitySource;
    statistic: 'cv_pct' | 'typical_error_pct' | 'typical_error_abs' | 'sem_abs';
    value: number;
    reference?: string;
    contextNote?: string;
    estimatedAt?: string;
}

export type ObservationValidity =
    | 'valid'
    | 'invalid'
    | 'practice'
    | 'questionable';

export interface MetricObservationHead {
    observationKey: string;
    assessmentAttemptId: string;
    metricId: string;
    headRevision: number;
    createdAt: string;
    updatedAt: string;
}

export interface MetricObservationDevice {
    provider: string;
    model?: string;
    deviceId?: string;
}

export type ObservationContextValue = string | number | boolean | null;
export type ObservationContext = Readonly<Record<string, ObservationContextValue>>;

export interface MetricObservationRevision {
    observationKey: string;
    revision: number;
    supersedesRevision?: number;
    metricId: string;
    value: number;
    unit: string;
    observedAt: string;
    source: 'manual' | 'garmin_activity' | 'garmin_lap' | 'derived';
    sourceRef?: string;
    device?: MetricObservationDevice;
    protocolRef: {
        id: string;
        revision: number;
    };
    comparisonSeriesKey: string;
    comparisonCanonicalizationVersion: string;
    assessmentAttemptId: string;
    validity: ObservationValidity;
    invalidReason?: string;
    context: ObservationContext;
    derivedFromObservationIds?: readonly string[];
    algorithmVersion?: string;
    correctionReason?: string;
    createdAt: string;
}

export type AssessmentAttemptState = 'scheduled' | 'in_progress' | 'completed' | 'abandoned';
export type AssessmentAttemptPurpose = 'familiarization' | 'baseline' | 'checkpoint' | 'post_block';

export interface AssessmentAttempt {
    id: string;
    protocolRef: { id: string; revision: number };
    scheduledDate?: string;
    startedAt?: string;
    completedAt?: string;
    state: AssessmentAttemptState;
    purpose: AssessmentAttemptPurpose;
    sourceSessionRef?: string;
    notes?: string;
}

export interface CompetitionOutcome {
    id: string;
    eventRef?: string;
    sport: 'cycling' | 'running' | 'field' | 'other';
    occurredAt: string;
    source: 'manual' | 'garmin_activity' | 'imported_result';
    sourceRef?: string;
    result: {
        completed: boolean;
        placing?: number;
        fieldSize?: number;
        elapsedSeconds?: number;
        distanceM?: number;
        courseId?: string;
        summary?: string;
    };
    metrics: Readonly<Record<string, ObservationContextValue>>;
    context: ObservationContext;
    createdAt: string;
}
