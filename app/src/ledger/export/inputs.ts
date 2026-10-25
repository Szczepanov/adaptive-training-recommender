/**
 * Inputs to the pure ledger-export builder: already-read records, never IO handles.
 *
 * Records typed in modules that import the engine (`training-occurrence/`, `responses/`,
 * `observations/`, `engine/models.ts`) are described here by narrow structural types so the
 * ledger boundary (ADR-0052, `models.architecture.test.ts`) holds. Any wider record is
 * assignable to these; fields the export does not promise are simply never read, so user
 * ids, e-mails and provider account ids in the inputs cannot reach the output.
 */
import type {
    AuthoredPlanBlock,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingSettings,
    UserConstraint,
    UserPreferences,
} from '../models.ts';
import type { LedgerPurpose, LedgerState, LegacyEngineLayer } from './schema.ts';

export interface OccurrenceInput {
    performedOccurrenceId: string;
    status: string;
    startedAt?: string;
    endedAt?: string;
    localDate?: string;
    modality?: string;
    /** Summarised from `session_executions`; absent means the summary is not available. */
    structuredEntries?: { exerciseCount: number; setCount: number };
}

export interface SessionResponseInput {
    responseId: string;
    date: string;
    window: string;
    sessionRpe?: number;
    completedFraction?: number;
    unexpectedFatigue?: boolean;
    techniqueNote?: string;
    note?: string;
}

export interface AssessmentInput {
    id: string;
    date: string;
    kind: string;
    metric: string;
    value: number | null;
    unit?: string;
}

export interface BodyCompositionInput {
    date: string;
    weightKg?: number | null;
    bodyFatPct?: number | null;
}

export interface NutritionDayInput {
    date: string;
    energyKcal?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    adherence?: string | null;
}

export interface CompetitionOutcomeInput {
    id: string;
    occurredAt: string;
    sport: string;
    result: {
        completed: boolean;
        placing?: number;
        fieldSize?: number;
        elapsedSeconds?: number;
        distanceM?: number;
        summary?: string;
    };
}

export interface FixedActivityInput {
    id: string;
    title: string;
    date: string;
    startTime?: string;
    durationMin: number;
    fixed: boolean;
    availabilityContextOverride?: { environment?: string; equipment?: string[] };
}

export interface ScheduleWindowInput {
    id: string;
    date: string;
    startLocal: string;
    endLocal: string;
    label?: string;
}

export interface GoalInput {
    id: string;
    title: string;
    domain: string;
    status: string;
    priority: number;
    targetDate?: string | null;
    targetOutcome?: string | null;
    eventCategory?: string | null;
    eventLifecycle?: string | null;
}

export interface IntentBlockInput {
    id: string;
    title?: string;
    dateRange: { startDate: string; endDate: string };
}

export interface PlanRevisionInput {
    planId: string;
    revision: number;
    contentHash: string;
    importedAt: string;
    schemaVersion: string | number;
    /** Plan-level `notes` of the imported plan. */
    notes?: string | null;
}

export interface PlacementInput {
    planId: string;
    assignments: { assignmentId: string; status: string; date?: string }[];
}

export interface PlannedToPerformedInput {
    planId: string;
    placementRef: string;
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
    'assessments',
    'body_composition',
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
    sessionResponses?: readonly SessionResponseInput[];
    assessments?: readonly AssessmentInput[];
    bodyComposition?: readonly BodyCompositionInput[];
    nutritionDays?: readonly NutritionDayInput[];
    activities?: readonly NormalizedGarminActivity[];
    competitionOutcomes?: readonly CompetitionOutcomeInput[];
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
    /** OD4: omitted or `undefined` keeps `legacyEngine` null. Opaque, never inspected. */
    legacyEngine?: LegacyEngineLayer;
}
