import type { PersistedFlagEvaluation } from '../flagEvaluation.ts';
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
    executedDefinitions?: { executionId: string; executedDefinition: 'authored' | 'reduced' | 'unknown' }[];
    /** Ids of the occurrence's `structured_execution` source refs; [] = no structured work; absent = unknown. */
    structuredExecutionIds?: readonly string[];
    /** Validated per-occurrence set counts; absent = not summarised (exported `unavailable`). */
    setCounts?: { planned: SetCountInput; work: SetCountInput; warmup: SetCountInput };
}

/** A count, or why it is absent. A missing denominator is never 0. */
export type SetCountInput = { value: number } | { value: null; state: LedgerState };

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

/** Structural `GoalPerformanceTarget` (`derived/assessments/performanceTargetPolicy.ts`, ADR-0041). */
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
    /** Authored session content of the verified revision; absent when it was not read. */
    sessions?: readonly PlanSessionContentInput[];
}

/** Structural subset of `ExternalPlanSession` the export carries for upcoming placements. */
export interface PlanSessionContentInput {
    id: string;
    title: string;
    priority?: string;
    summary?: string;
    stepNotes?: readonly string[];
    fallback?: string;
}

/** Structural `ExternalPlanPlacement` (`engine/models.ts`): the mutable overlay, current state only. */
export interface PlacementInput {
    planId: string;
    revision: number;
    /** When the current overlay was last written; dates it when its history is unavailable. */
    updatedAt?: string;
    assignments: {
        sessionId: string;
        date: string;
        status: 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';
        /** Drop/move reason. Absent: written before reasons were asked; `null`: asked, left blank. */
        reason?: { code: string; note?: string } | null;
        /** Moved rows: the date the session sat on just before this move. */
        movedFrom?: string;
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

/** An execution of a plan session whose content hash matched the verified stored revision.
 * Placement outcomes use it to tell a started or unlinked session from a missed one. */
export interface PlanExecutionInput {
    planId: string;
    revision: number;
    sessionId: string;
    state: 'in_progress' | 'completed' | 'abandoned';
}

/** Evidence about a plan session that could not be verified: a planned-to-performed link or an
 * execution whose revision or content hash did not verify. Its placement's outcome is `unknown`. */
export interface UnverifiedPlanEvidenceInput {
    planId: string;
    revision: number;
    sessionId: string;
}

/**
 * A swap or omission the athlete chose during a session (Phase 3B), already resolved against the
 * definition pinned for that run. `kind: null` with `kindState` means the choice could not be
 * resolved; `stepState`/`replacementState` say why a resolved row lacks its step or replacement.
 */
export interface ChoiceOverrideInput {
    /** Stable: execution id, choice entry id and action index. */
    id: string;
    date: string;
    planId?: string;
    sessionId?: string;
    kind: 'swapped' | 'omitted' | null;
    kindState?: LedgerState;
    step?: string;
    stepState?: LedgerState;
    replacement?: string;
    replacementState?: LedgerState;
    reason?: string;
    /** The run the choice was made in, so an abandoned run or a rerun is not mistaken for the completed one. */
    executionState: 'in_progress' | 'completed' | 'abandoned';
}

/** One record per source read. Absent = not read, reported `unavailable`. */
export interface SourceReadInput {
    state?: LedgerState;
    readAt: string | null;
    newestObservedOn?: string | null;
    reason?: string;
}

export const SOURCE_KEYS = [
    'daily_recovery_snapshots',
    'daily_subjective_checkins',
    'flag_evaluations',
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
    flagEvaluations?: readonly PersistedFlagEvaluation[];
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
    /** Revisions whose history exceeded the bounded scan; only their statusHistory is unavailable. */
    placementHistoryUnavailable?: readonly { planId: string; revision: number }[];
    /** Older revisions placed only through the legacy overlay with no activation hash; only their
     * placement content and past outcomes degrade, never the whole plan-revisions source. */
    unverifiedPlanRevisions?: readonly { planId: string; revision: number }[];
    plannedToPerformed?: readonly PlannedToPerformedInput[];
    /** Hash-verified executions of plan sessions in the window. Absent = not read, so no past
     * placement can be shown as missed. */
    planExecutions?: readonly PlanExecutionInput[];
    /** Links and executions that could not be verified; their placements' outcomes are `unknown`. */
    unverifiedPlanEvidence?: readonly UnverifiedPlanEvidenceInput[];
    /** Swaps and omissions from in-session choices. Absent = executions not read. */
    choiceOverrides?: readonly ChoiceOverrideInput[];
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
     * Optional direct evaluations for existing pure-builder callers. Dates, session refs,
     * definition versions and states are preserved, subject to the HA7 release gate.
     */
    flagEvaluations?: readonly LedgerFlag[];
    /** OD4: omitted or `undefined` keeps `legacyEngine` null. Opaque, never inspected. */
    legacyEngine?: LegacyEngineLayer;
}
