/**
 * D-EXPORT v1 (#1145, ADR-0052): the canonical structured ledger export. Types, the closed
 * vocabularies and the field inventory. Engine-free by construction (the ledger boundary
 * test enforces it). The checked-in JSON Schema is `ledgerExport.schema.json`.
 *
 * There is no user id, e-mail or provider account id anywhere in this shape (I6).
 */

export const LEDGER_EXPORT_SCHEMA_VERSION = 'ledger-export-v1' as const;

export const LEDGER_STATES = [
    'measured',
    'missing',
    'unavailable',
    'invalid',
    'not_collected',
    'not_applicable',
    'stale',
    'not_recorded',
    'not_yet_supported',
] as const;
export type LedgerState = typeof LEDGER_STATES[number];

export const LEDGER_PURPOSES = ['morning', 'planning', 'diagnostic'] as const;
export type LedgerPurpose = typeof LEDGER_PURPOSES[number];

export interface LedgerValue<T> {
    /** `measured` requires a value; `stale` may retain its dated value. */
    value: T | null;
    unit?: string;
    source: string;
    state: LedgerState;
    /** Semantic Warsaw date the value describes. */
    observedOn?: string;
}

export interface SourceState {
    source: string;
    state: LedgerState;
    readAt: string | null;
    newestObservedOn: string | null;
}

export interface LedgerWindow {
    startDate: string;
    endDate: string;
    days: number;
}

/** A read collection. `measured` with no items means "read, nothing recorded". */
export interface LedgerCollection<T> {
    state: LedgerState;
    source: string;
    items: T[];
    /** Rows dropped because they carry no usable calendar date; never silently omitted. */
    droppedUndated: number;
}

/** Provider activity detail is capped per purpose, so omission is counted, not hidden. */
export interface ActivityCollection<T> extends LedgerCollection<T> {
    truncated: boolean;
    /** Activities inside the window before the detail cap was applied. */
    totalInWindow: number;
}

/** One recorded row: a stable export-local id and state-bearing leaf facts. */
export interface LedgerRecord<F extends string = string> {
    id: string;
    observedOn: string | null;
    fields: Record<F, LedgerValue<unknown>>;
}

/** A user-context row. `since` and `revisions` are never inferred from `updatedAt`. */
export interface ContextRecord<F extends string = string> extends LedgerRecord<F> {
    since: LedgerValue<string>;
    revisions: LedgerValue<unknown[]>;
}

export const LEDGER_FLAG_IDS = [
    'illness_anomaly',
    'illness_risk_symptom',
    'injury_constraint_touches_session',
    'recovery_beyond_baseline',
] as const;
export type LedgerFlagId = typeof LEDGER_FLAG_IDS[number];

export interface LedgerFlag {
    id: LedgerFlagId;
    observedOn: string;
    /** Persisted evaluation instant; null while no persisted evaluation exists. */
    evaluatedAt: string | null;
    definitionVersion: string | null;
    sessionRef?: string;
    /** null = could not evaluate; see `state`. */
    active: boolean | null;
    state: LedgerState;
    inputs: { name: string; value: LedgerValue<unknown> }[];
    threshold: string | null;
    baselineWindow?: string;
}

export const DERIVED_METRIC_IDS = [
    'biometric_baselines',
    'd_minus_1_step_normalization',
    'rolling_performed_training_load',
] as const;
export type DerivedMetricId = typeof DERIVED_METRIC_IDS[number];

export interface DerivedMetric {
    id: DerivedMetricId;
    definition: string;
    window: string;
    value: LedgerValue<number>;
    inputs: string[];
}

export const RECOVERY_FIELDS = [
    'sleepScore', 'sleepDurationSec', 'restingHr', 'hrvOvernightAvg', 'hrvStatus', 'respirationAvg',
    'bodyBatteryWake', 'totalSteps', 'stressAvg', 'weightKg', 'bodyFatPct',
] as const;
export const CHECKIN_FIELDS = [
    'readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation',
    'painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime', 'alreadyTrainedToday', 'notes',
    'tissueResponses', 'redFlags', 'timeAvailableMin', 'indoorOnly', 'preferredModalityToday',
] as const;
export const PERFORMED_TRAINING_FIELDS = [
    'status', 'modality', 'startedAt', 'endedAt', 'durationMin', 'structuredEntries',
] as const;
export const SESSION_RESPONSE_FIELDS = [
    'window', 'sourceSession', 'occurrenceId', 'sessionRpe', 'completedFraction', 'unexpectedFatigue',
    'techniqueNote', 'note',
] as const;
export const ASSESSMENT_FIELDS = [
    'metricId', 'value', 'validity', 'invalidReason', 'assessmentAttemptId', 'attemptState', 'attemptPurpose',
] as const;
export const BODY_COMPOSITION_FIELDS = ['weightKg'] as const;
export const NUTRITION_FIELDS = [
    'energyIntakeKcal', 'proteinGrams', 'carbsGrams', 'fatGrams', 'hasIntakeData', 'adherence',
] as const;
export const ACTIVITY_FIELDS = [
    'type', 'durationMin', 'averageHr', 'maxHr', 'activityTrainingLoad', 'intensityTag',
    'sessionCost', 'segmentCountTotal', 'segmentsTruncated', 'segments',
] as const;
export const OUTCOME_FIELDS = [
    'sport', 'completed', 'placing', 'fieldSize', 'elapsedSeconds', 'distanceM', 'summary',
] as const;

export const INJURY_FIELDS = ['region', 'severity', 'reviewBy', 'note', 'restrictedModalities'] as const;
export const EQUIPMENT_FIELDS = [
    'free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar', 'outdoor_bike', 'swim_access',
] as const;
export const ENVIRONMENT_FIELDS = ['defaultEnvironment', 'weekdayMaxMinutes', 'weekendMaxMinutes'] as const;
export const GUARDRAIL_FIELDS = [
    'avoid_high_impact', 'avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading',
] as const;
export const TRAVEL_FIELDS = ['startDate', 'endDate', 'volumeScale', 'intensityScale'] as const;
export const VENUE_RESTRICTION_FIELDS = ['date', 'title', 'environment', 'equipment'] as const;
export const AVAILABILITY_FIELDS = [
    'date', 'kind', 'startLocal', 'endLocal', 'durationMin', 'title', 'fixed', 'availabilityContextOverride',
    'availabilityOverrideMin', 'environment', 'equipment',
] as const;
export const PREFERENCE_FIELDS = [
    'preferredRecoveryStyle', 'defaultWeekdayTimeMin', 'defaultWeekendTimeMin', 'preferredTimeOfDay',
    'preferredModalities', 'deprioritizedModalities', 'avoidedModalities', 'unavailableModalities',
] as const;
export const GOAL_FIELDS = [
    'title', 'description', 'domain', 'status', 'priority', 'performanceTarget', 'targetMetric', 'targetValue',
    'targetUnit', 'targetDate', 'targetOutcome', 'eventCategory', 'eventLifecycle', 'timing',
] as const;
export const USER_EVENT_FIELDS = ['title', 'startDate', 'endDate', 'lifecycle'] as const;
export const CONSTRAINT_FIELDS = ['label', 'value', 'severity', 'isActive', 'category', 'description'] as const;

export const PLAN_REVISION_FIELDS = [
    'planId', 'revision', 'contentHash', 'importedAt', 'schema', 'authorRationale',
] as const;
export const PLACEMENT_FIELDS = ['planId', 'revision', 'sessionId', 'status', 'date', 'statusHistory'] as const;
export const OVERRIDE_FIELDS = ['planId', 'sessionId', 'kind', 'date', 'reason'] as const;
export const PLANNED_TO_PERFORMED_FIELDS = ['planId', 'revision', 'sessionId', 'date', 'performedOccurrenceRef'] as const;

type Rec<F extends readonly string[]> = LedgerRecord<F[number]>;
type Ctx<F extends readonly string[]> = ContextRecord<F[number]>;

export interface LedgerFacts {
    recovery: LedgerCollection<Rec<typeof RECOVERY_FIELDS>>;
    checkins: LedgerCollection<Rec<typeof CHECKIN_FIELDS>>;
    performedTraining: LedgerCollection<Rec<typeof PERFORMED_TRAINING_FIELDS>>;
    sessionResponses: LedgerCollection<Rec<typeof SESSION_RESPONSE_FIELDS>>;
    assessments: LedgerCollection<Rec<typeof ASSESSMENT_FIELDS>>;
    bodyComposition: LedgerCollection<Rec<typeof BODY_COMPOSITION_FIELDS>>;
    nutrition: LedgerCollection<Rec<typeof NUTRITION_FIELDS>>;
    activities: ActivityCollection<Rec<typeof ACTIVITY_FIELDS>>;
    events: LedgerCollection<Rec<typeof OUTCOME_FIELDS>>;
}

export interface LedgerUserContext {
    injuries: LedgerCollection<Ctx<typeof INJURY_FIELDS>>;
    equipment: Ctx<typeof EQUIPMENT_FIELDS>;
    environment: Ctx<typeof ENVIRONMENT_FIELDS>;
    guardrails: Ctx<typeof GUARDRAIL_FIELDS>;
    travel: LedgerCollection<Ctx<typeof TRAVEL_FIELDS>>;
    venueRestrictions: LedgerCollection<Ctx<typeof VENUE_RESTRICTION_FIELDS>>;
    availability: LedgerCollection<Ctx<typeof AVAILABILITY_FIELDS>>;
    preferences: Ctx<typeof PREFERENCE_FIELDS>;
    goals: LedgerCollection<Ctx<typeof GOAL_FIELDS>>;
    events: LedgerCollection<Ctx<typeof USER_EVENT_FIELDS>>;
    constraints: LedgerCollection<Ctx<typeof CONSTRAINT_FIELDS>>;
    trainingDislikes: LedgerValue<string[]>;
}

export interface LedgerCoachingHistory {
    planRevisions: LedgerCollection<Rec<typeof PLAN_REVISION_FIELDS>>;
    placements: LedgerCollection<Rec<typeof PLACEMENT_FIELDS>>;
    overrides: LedgerCollection<Rec<typeof OVERRIDE_FIELDS>>;
    plannedToPerformed: LedgerCollection<Rec<typeof PLANNED_TO_PERFORMED_FIELDS>>;
}

/** Opt-in, opaque until Phase 3 deletes it; each entry names the POLICY_VERSION that produced it. */
export type LegacyEngineLayer = Readonly<Record<string, unknown>>;

export interface LedgerExport {
    schemaVersion: typeof LEDGER_EXPORT_SCHEMA_VERSION;
    exportedAt: string;
    asOfDate: string;
    window: LedgerWindow;
    purpose: LedgerPurpose;
    sources: SourceState[];
    facts: LedgerFacts;
    derived: DerivedMetric[];
    flags: LedgerFlag[];
    userContext: LedgerUserContext;
    coachingHistory: LedgerCoachingHistory;
    legacyEngine: LegacyEngineLayer | null;
}

/** Keys that carry an engine opinion; they may appear only inside `legacyEngine` (OD4). */
export const ENGINE_OPINION_KEYS = [
    'recommendation', 'recommendedWorkout', 'recoveryScore', 'planAuthority', 'periodizationPhase',
    'capabilityMaintenance', 'developmentAuthority', 'policyVersion', 'POLICY_VERSION', 'trainingIntent',
    'verdict',
] as const;

function collectionPaths(path: string, fields: readonly string[]): string[] {
    return [path, ...fields.map(field => `${path}[].fields.${field}`)];
}

function contextPaths(path: string, fields: readonly string[], isArray: boolean): string[] {
    const base = isArray ? `${path}[]` : path;
    return [
        ...(isArray ? [path] : []),
        `${base}.since`,
        `${base}.revisions`,
        ...fields.map(field => `${base}.fields.${field}`),
    ];
}

/** Every promised field path. `[]` means "each element"; a collection path resolves to its `state`. */
export const LEDGER_EXPORT_FIELDS: readonly string[] = [
    'schemaVersion', 'exportedAt', 'asOfDate', 'window', 'purpose', 'sources', 'legacyEngine',
    ...collectionPaths('facts.recovery', RECOVERY_FIELDS),
    ...collectionPaths('facts.checkins', CHECKIN_FIELDS),
    ...collectionPaths('facts.performedTraining', PERFORMED_TRAINING_FIELDS),
    ...collectionPaths('facts.sessionResponses', SESSION_RESPONSE_FIELDS),
    ...collectionPaths('facts.assessments', ASSESSMENT_FIELDS),
    ...collectionPaths('facts.bodyComposition', BODY_COMPOSITION_FIELDS),
    ...collectionPaths('facts.nutrition', NUTRITION_FIELDS),
    ...collectionPaths('facts.activities', ACTIVITY_FIELDS),
    ...collectionPaths('facts.events', OUTCOME_FIELDS),
    'derived[].value',
    'flags[].state',
    ...contextPaths('userContext.injuries', INJURY_FIELDS, true),
    ...contextPaths('userContext.equipment', EQUIPMENT_FIELDS, false),
    ...contextPaths('userContext.environment', ENVIRONMENT_FIELDS, false),
    ...contextPaths('userContext.guardrails', GUARDRAIL_FIELDS, false),
    ...contextPaths('userContext.travel', TRAVEL_FIELDS, true),
    ...contextPaths('userContext.venueRestrictions', VENUE_RESTRICTION_FIELDS, true),
    ...contextPaths('userContext.availability', AVAILABILITY_FIELDS, true),
    ...contextPaths('userContext.preferences', PREFERENCE_FIELDS, false),
    ...contextPaths('userContext.goals', GOAL_FIELDS, true),
    ...contextPaths('userContext.events', USER_EVENT_FIELDS, true),
    ...contextPaths('userContext.constraints', CONSTRAINT_FIELDS, true),
    'userContext.trainingDislikes',
    ...collectionPaths('coachingHistory.planRevisions', PLAN_REVISION_FIELDS),
    ...collectionPaths('coachingHistory.placements', PLACEMENT_FIELDS),
    ...collectionPaths('coachingHistory.overrides', OVERRIDE_FIELDS),
    ...collectionPaths('coachingHistory.plannedToPerformed', PLANNED_TO_PERFORMED_FIELDS),
];

/** Field keys per record-bearing path; the JSON Schema `required` lists must equal these. */
export const LEDGER_RECORD_FIELD_KEYS: Readonly<Record<string, readonly string[]>> = {
    'facts.recovery': RECOVERY_FIELDS,
    'facts.checkins': CHECKIN_FIELDS,
    'facts.performedTraining': PERFORMED_TRAINING_FIELDS,
    'facts.sessionResponses': SESSION_RESPONSE_FIELDS,
    'facts.assessments': ASSESSMENT_FIELDS,
    'facts.bodyComposition': BODY_COMPOSITION_FIELDS,
    'facts.nutrition': NUTRITION_FIELDS,
    'facts.activities': ACTIVITY_FIELDS,
    'facts.events': OUTCOME_FIELDS,
    'userContext.injuries': INJURY_FIELDS,
    'userContext.equipment': EQUIPMENT_FIELDS,
    'userContext.environment': ENVIRONMENT_FIELDS,
    'userContext.guardrails': GUARDRAIL_FIELDS,
    'userContext.travel': TRAVEL_FIELDS,
    'userContext.venueRestrictions': VENUE_RESTRICTION_FIELDS,
    'userContext.availability': AVAILABILITY_FIELDS,
    'userContext.preferences': PREFERENCE_FIELDS,
    'userContext.goals': GOAL_FIELDS,
    'userContext.events': USER_EVENT_FIELDS,
    'userContext.constraints': CONSTRAINT_FIELDS,
    'coachingHistory.planRevisions': PLAN_REVISION_FIELDS,
    'coachingHistory.placements': PLACEMENT_FIELDS,
    'coachingHistory.overrides': OVERRIDE_FIELDS,
    'coachingHistory.plannedToPerformed': PLANNED_TO_PERFORMED_FIELDS,
};
