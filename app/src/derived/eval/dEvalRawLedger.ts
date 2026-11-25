/** Raw ledger records read by `dEvalReadoutService` and consumed by the pure D-EVAL assembler. */

import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation.ts';
import type {
    ActivityOverride,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
} from '../../ledger/models.ts';
import type { PlacementAssignment, PlacementEvent } from '../../ledger/placementHistory.ts';
import type { AssessmentAttempt } from '../../observations/models.ts';
import type { CurrentObservation } from '../../observations/progress.ts';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models.ts';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome.ts';
import type { DEvalC3InjuryInput, DEvalSessionIntensity } from './dEvalC3.ts';
import type { DEvalRollbackUsage } from './dEvalReadout.ts';

export type DEvalSourceReadState = 'measured' | 'missing' | 'unavailable' | 'invalid';

export interface DEvalRawPlanSession {
    id: string;
    /** The date the stored revision itself implies, before any overlay. */
    authoredDate: string;
    /**
     * No authored day: `authoredDate` is only its plan week's first day, and the athlete may have been
     * shown it on any day of that week. The shown date is not recorded unless the session was placed.
     */
    floating: boolean;
    gating?: { intensity?: DEvalSessionIntensity };
}

export interface DEvalRawPlanRevision {
    planId: string;
    revision: number;
    contentHash: string;
    importedAt: string;
    /** When the revision took effect and the inclusive dates its own plan covers. */
    horizon: { effectiveFrom: string; startDate: string; endDate: string };
    sessions: readonly DEvalRawPlanSession[];
}

export interface DEvalRawPlacementOverlay {
    planId: string;
    revision: number;
    updatedAt?: string;
    assignments: readonly PlacementAssignment[];
    successors?: Record<string, { revision: number; sessionId: string }>;
}

export interface DEvalRawExecution {
    executionId: string;
    state: 'in_progress' | 'completed' | 'abandoned';
    date: string;
    startedAt: string;
    completedAt?: string | null;
    executedDefinition?: 'authored' | 'reduced';
    completionEvidence?: { completedFraction?: number };
    sessionSource: {
        kind: string;
        planId?: string;
        revision?: number;
        sessionId?: string;
        contentHash?: string;
    };
}

export interface DEvalRawResponse {
    responseId: string;
    window: 'immediate' | 'later_day' | 'next_morning';
    date: string;
    sourceSession: { kind: string; id: string; date: string };
    completedFraction?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface DEvalRawPlanIssue {
    planId: string;
    revision?: number;
    reason:
        | 'unverified_revision'
        | 'history_truncated'
        | 'history_invalid'
        | 'history_unavailable'
        | 'placement_invalid'
        | 'placement_unavailable';
}

export interface DEvalRawLedgerData {
    externalPlansState: DEvalSourceReadState;
    planRevisions: readonly DEvalRawPlanRevision[];
    placements: readonly DEvalRawPlacementOverlay[];
    placementHistory: readonly PlacementEvent[];
    planIssues?: readonly DEvalRawPlanIssue[];

    occurrencesState: DEvalSourceReadState;
    performedOccurrences: readonly PerformedTrainingOccurrence[];
    executionsState: DEvalSourceReadState;
    executions: readonly DEvalRawExecution[];
    responsesState: DEvalSourceReadState;
    responses: readonly DEvalRawResponse[];

    activitiesState?: DEvalSourceReadState;
    activities?: readonly NormalizedGarminActivity[];
    activityOverridesState?: DEvalSourceReadState;
    activityOverrides?: Readonly<Record<string, ActivityOverride>>;

    flagEvaluationsState: DEvalSourceReadState;
    flagEvaluations: readonly PersistedFlagEvaluation[];

    checkinsState: DEvalSourceReadState;
    checkins: readonly DailySubjectiveCheckin[];
    trainingSettingsState: DEvalSourceReadState;
    injuries: readonly DEvalC3InjuryInput[];
    healthAnomalyOutcomesState: DEvalSourceReadState;
    healthAnomalyOutcomes: readonly HealthAnomalyEpisodeOutcome[];

    observationsState: DEvalSourceReadState;
    observations: readonly CurrentObservation[];
    unreadableObservationsCount?: number;
    attemptsState: DEvalSourceReadState;
    attempts?: readonly AssessmentAttempt[];
    unreadableAttemptsCount?: number;
    attemptsTruncated?: boolean;

    preferencesState?: DEvalSourceReadState;
    engineRecommendationsEnabled?: boolean | null;
}

export interface DEvalAssemblyOptions {
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    includeBaseline?: boolean;
    criteriaCommit?: string | null;
    phase2Commit?: string | null;
    rollbackState: DEvalRollbackUsage;
    rollbackReason?: string | null;
    rollbackAtDate?: string | null;
}
