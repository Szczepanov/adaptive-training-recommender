import type { PlacementEvent } from '../placementHistory.ts';
/**
 * Inputs to the pure ledger-export builder: already-read records, never IO handles.
 *
 * Records whose modules import nothing from `engine/` (`ledger/models.ts`, `responses/`,
 * `observations/`, `nutrition/`, `anthropometry/`) are used by their real types, so a model
 * change cannot drift silently. Records typed in modules that reach the engine
 * (`training-occurrence/`, and the goal, fixed-activity, schedule-window, intent-block and
 * external-plan records in `engine/`) are described by narrow structural types here, because
 * the ledger boundary (ADR-0052, `models.architecture.test.ts`) forbids the import. Any wider
 * record is assignable to a structural type. Fields the export does not promise are never
 * read, so user ids, e-mails and provider account ids in the inputs cannot reach the output.
 * Every field the builder maps is required in its structural type.
 */
import type { AnthropometryEntry } from '../../anthropometry/models.ts';
import type { NutritionDay } from '../../nutrition/models.ts';
import type {
    AssessmentAttempt,
    CompetitionOutcome,
    MetricObservationRevision,
} from '../../observations/models.ts';
import type { SessionResponse } from '../../responses/models.ts';
import type {
    AuthoredPlanBlock,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingEnvironment,
    TrainingSettings,
    UserConstraint,
    UserPreferences,
} from '../models.ts';
import type { LedgerFlag, LedgerPurpose, LedgerState, LegacyEngineLayer } from './schema.ts';

/** Structural copy of `PerformedTrainingOccurrence` (`training-occurrence/models.ts` reaches the engine). */
export interface OccurrenceInput {
    performedOccurrenceId: string;
    status: 'active' | 'merged';
    startedAt?: string;
    endedAt?: string;
    localDate?: string;
    modality?: string;
    /** Summarised from `session_executions`; absent means no summary is wired yet. */
    structuredEntries?: { exerciseCount: number; setCount: number };
}

/** Structural subset of `FixedActivity` (`engine/models.ts`). */
export interface FixedActivityInput {
    id: string;
    title: string;
    date: string;
    startTime?: string;
    durationMin: number;
    /** The day's total training-minute budget (distinct from `availabilityContextOverride`). */
    availabilityOverride?: number;
    fixed: boolean;
    availabilityContextOverride?: { environment?: TrainingEnvironment; equipment?: string[] };
}

/** Structural subset of `ScheduleWindow` (`engine/models.ts`). */
export interface ScheduleWindowInput {
    id: string;
    date: string;
    startLocal: string;
    endLocal: string;
    label?: string;
    environment?: TrainingEnvironment;
    equipment?: string[];
}

/** Structural `GoalPerformanceTarget` (`engine/performanceTargetPolicy.ts`, ADR-0041). */
export interface GoalPerformanceTargetInput {
    kind: 'performance_metric';
    metricId: string;
    subjectRef: { kind: 'exercise'; exerciseId: string } | { kind: 'performance_test'; performanceTestId: string };
    targetValue: number;
}

/** Structural subset of `UserGoal & { id }` (`engine/models.ts`; `goalService` adds the doc id). */
export interface GoalInput {
    id: string;
    title: string;
    description?: string | null;
    domain: string;
    status: 'active' | 'paused' | 'completed' | 'archived';
    priority: number;
    performanceTarget?: GoalPerformanceTargetInput | null;
    targetMetric?: string | null;
    targetValue?: number | null;
    targetUnit?: string | null;
    targetDate?: string | null;
    targetOutcome?: string | null;
    eventCategory?: string | null;
    eventLifecycle?: 'scheduled' | 'completed' | 'DNS' | 'DNF' | 'cancelled';
    timing?: {
        earliestDate: string;
        latestDate: string;
        planningDate: string;
        confirmedDate?: string;
    } | null;
}

/** Structural subset of `IntentBlock` (`engine/blockIntent.ts`). */
export interface IntentBlockInput {
    id: string;
    title?: string;
    dateRange: { startDate: string; endDate: string };
}

/** One immutable external-plan revision header plus the stored plan's `schema` and `notes`. */
export interface PlanRevisionInput {
    planId: string;
    revision: number;
    contentHash: string;
    importedAt: string;
    /** e.g. `adaptive-training-recommender/external-plan@6`. */
    schema: string;
    /** Plan-level `notes` of the imported plan. */
    notes?: string;
}

/** Structural `ExternalPlanPlacement` (`engine/models.ts`): the mutable overlay, current state only. */
export interface PlacementInput {
    planId: string;
    revision: number;
    assignments: {
        sessionId: string;
        date: string;
        status: 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';
    }[];
}

/** An occurrence-to-placement link (ADR-0034 round trip). */
/** Matches `ExternalPlanOccurrenceRef` (`sessions/models.ts`) minus the content hash. */
export interface PlannedToPerformedInput {
    planId: string;
    revision: number;
    sessionId: string;
    /** Recorded execution session date; a later mutable placement cannot redate this link. */
    date: string;
    performedOccurrenceId: string;
}

/** One record per source read. Absent = not read, reported `unavailable`. */
export interface SourceReadInput {
    state?: LedgerState;
    readAt: string | null;
    newestObservedOn?: string | null;
}

export const SOURCE_KEYS = [
    'daily_recovery_snapshots',
    'daily_subjective_checkins',
    'performed_training_occurrences',
    'session_responses',
    'assessment_attempts',
    'metric_observations',
    'anthropometry_entries',
    'nutrition_days',
    'activities',
    'competition_outcomes',
    'training_settings',
    'plan_blocks',
    'fixed_activities',
    'schedule_windows',
    'preferences',
    'goals',
    'intent_blocks',
    'constraints',
    'external_plan_revisions',
    'external_plan_placements',
    'planned_to_performed',
] as const;
export type SourceKey = typeof SOURCE_KEYS[number];

export interface LedgerExportRecords {
    recovery?: readonly DailyRecoverySnapshot[];
    checkins?: readonly DailySubjectiveCheckin[];
    performedOccurrences?: readonly OccurrenceInput[];
    sessionResponses?: readonly SessionResponse[];
    assessmentAttempts?: readonly AssessmentAttempt[];
    /** Current heads of `metric_observations` (ADR-0046/0047). */
    metricObservations?: readonly MetricObservationRevision[];
    anthropometry?: readonly AnthropometryEntry[];
    nutritionDays?: readonly NutritionDay[];
    activities?: readonly NormalizedGarminActivity[];
    competitionOutcomes?: readonly CompetitionOutcome[];
    /** `null` = read, none stored. */
    trainingSettings?: TrainingSettings | null;
    planBlocks?: readonly AuthoredPlanBlock[];
    fixedActivities?: readonly FixedActivityInput[];
    scheduleWindows?: readonly ScheduleWindowInput[];
    preferences?: UserPreferences | null;
    goals?: readonly GoalInput[];
    intentBlocks?: readonly IntentBlockInput[];
    constraints?: readonly UserConstraint[];
    planRevisions?: readonly PlanRevisionInput[];
    placements?: readonly PlacementInput[];
    placementHistory?: readonly PlacementEvent[];
    plannedToPerformed?: readonly PlannedToPerformedInput[];
}

export interface BuildLedgerExportInput {
    records: LedgerExportRecords;
    sources?: Partial<Record<SourceKey, SourceReadInput>>;
    /** Warsaw calendar date (I2). */
    asOfDate: string;
    /** Honoured for `diagnostic`; for other purposes it can only narrow the preset window. */
    window?: { startDate: string; endDate: string };
    purpose: LedgerPurpose;
    /** Injected; the builder never reads the clock. */
    exportedAt: string;
    /**
     * Persisted flag evaluations (D-FLAGS), passed through unchanged: dates, session refs,
     * definition versions and unevaluable states are never recomputed. A flag id with no
     * supplied evaluation stays `not_yet_supported`.
     */
    flagEvaluations?: readonly LedgerFlag[];
    /** OD4: omitted or `undefined` keeps `legacyEngine` null. Opaque, never inspected. */
    legacyEngine?: LegacyEngineLayer;
}
