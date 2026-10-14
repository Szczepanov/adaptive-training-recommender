/**
 * #895 WP5 -- failure observability. A pure projection from a `CompletedWorkoutView` (and the
 * read statuses it carries) to a verdict on each of the eight #895 section 10 failure states.
 *
 * No Firestore, `fetch` or clock: every IO outcome arrives through `view.sourceReads`, which
 * `activitiesReadModelService.ts` fills in. Policy effect: none (display/export only).
 *
 * Honesty rules:
 *  - Every state is assessed for every workout; nothing is "missing from the list".
 *  - `holds` = the failure state is observed. `clear` = observed NOT to hold.
 *    `not_applicable` = the state cannot occur for this workout. `not_observable` = the
 *    evidence needed to decide is not available; this is never collapsed into `clear`.
 *  - States are independent: co-occurring failures are all reported.
 */
import type { CompletedWorkoutView, OutboxSnapshot, ReconciliationSweepStatus } from './completedWorkoutView';
import type { TrainingResponseSessionEvidence } from './trainingResponseEvidence';

export const FAILURE_STATE_CODES = [
    'session_execution_absent',
    'entry_write_unsettled',
    'garmin_activity_absent',
    'garmin_detail_unavailable',
    'garmin_detail_empty',
    'reconciliation_no_candidate',
    'reconciliation_ambiguous',
    'read_model_projection_failed',
] as const;

export type FailureStateCode = (typeof FAILURE_STATE_CODES)[number];

/** The numbering of #895 section 10, for cross-referencing the issue. */
export const FAILURE_STATE_NUMBER: Readonly<Record<FailureStateCode, number>> = {
    session_execution_absent: 1,
    entry_write_unsettled: 2,
    garmin_activity_absent: 3,
    garmin_detail_unavailable: 4,
    garmin_detail_empty: 5,
    reconciliation_no_candidate: 6,
    reconciliation_ambiguous: 7,
    read_model_projection_failed: 8,
};

const DETAIL_NOT_EXPECTED = ['no_garmin_activity', 'detail_not_expected_for_activity_type'] as const;

/** Closed reason vocabularies per state and status. `never`-typed empty lists make an
 * impossible status/reason pair unrepresentable. */
export const STATE_REASONS = {
    session_execution_absent: {
        holds: ['no_execution_linked', 'execution_document_missing'],
        not_observable: ['execution_unreadable'],
        not_applicable: [],
    },
    entry_write_unsettled: {
        holds: ['failed_writes', 'queued_writes'],
        not_observable: ['receipts_are_device_local', 'receipts_unreadable'],
        not_applicable: ['no_execution_linked'],
    },
    garmin_activity_absent: {
        holds: ['no_provider_linked', 'activity_not_in_read_window'],
        not_observable: ['provider_activities_unreadable'],
        not_applicable: ['non_garmin_provider_only'],
    },
    garmin_detail_unavailable: {
        holds: ['detail_fetch_failed', 'detail_fetch_rate_limited'],
        not_observable: ['detail_fetch_outcome_not_persisted'],
        not_applicable: [...DETAIL_NOT_EXPECTED, 'detail_fetch_not_attempted'],
    },
    garmin_detail_empty: {
        holds: ['exercise_sets_reported_empty'],
        not_observable: ['detail_not_stored'],
        not_applicable: DETAIL_NOT_EXPECTED,
    },
    reconciliation_no_candidate: {
        holds: ['no_candidate_after_sweep', 'manually_separated'],
        not_observable: ['sweep_failed', 'sweep_incomplete', 'sweep_not_run', 'counterpart_ambiguous'],
        not_applicable: [],
    },
    reconciliation_ambiguous: {
        holds: ['competing_or_weak_candidates'],
        not_observable: [],
        not_applicable: [],
    },
    read_model_projection_failed: {
        holds: [
            'execution_unavailable',
            'execution_invalid',
            'definition_unresolved',
            'entries_unavailable',
            'provider_activities_unreadable',
        ],
        not_observable: [],
        not_applicable: [],
    },
} as const satisfies Record<FailureStateCode, {
    holds: readonly string[];
    not_observable: readonly string[];
    not_applicable: readonly string[];
}>;

export type ReasonStatus = 'holds' | 'not_observable' | 'not_applicable';

export type StateReason<C extends FailureStateCode, S extends ReasonStatus> = (typeof STATE_REASONS)[C][S][number];

type Reasons<C extends FailureStateCode, S extends ReasonStatus> = StateReason<C, S>;

export type StateAssessment<C extends FailureStateCode> =
    | { status: 'holds'; reasons: readonly [Reasons<C, 'holds'>, ...Reasons<C, 'holds'>[]] }
    | { status: 'clear' }
    | { status: 'not_applicable'; reason: Reasons<C, 'not_applicable'> }
    | { status: 'not_observable'; reason: Reasons<C, 'not_observable'> };

export type WorkoutStateAssessments = { [C in FailureStateCode]: StateAssessment<C> };

export type ReconciliationOutcomeObservation =
    | { status: 'observed'; outcome: 'created_single_source' | 'attached_auto_link' | 'ambiguous' }
    | { status: 'not_observable'; reason: 'manual_decision' };

export interface WorkoutSourceDiagnostics {
    performedOccurrenceId: string;
    states: WorkoutStateAssessments;
    /** States that deserve a visible notice rather than only the collapsed diagnostics:
     * everything that is a real gap or an unreadable dependency. Expected single-source facts
     * (a structured session with no watch recording, a ride with no plan) are excluded. */
    attention: FailureStateCode[];
    /** Passed through, never defaulted: an unreadable receipt store is not a depth of zero. */
    outbox: OutboxSnapshot;
    reconciliationSweep: ReconciliationSweepStatus;
    reconciliationOutcome: ReconciliationOutcomeObservation;
}

/** Garmin activity types the sync fetches `exerciseSets` for. Mirrors
 * `_STRENGTH_ACTIVITY_TYPES` in `src/garmin_sync/garmin_provider.py`
 * (`qualifies_for_strength_exercise_sets`). */
const SET_DETAIL_ACTIVITY_TYPES: ReadonlySet<string> = new Set(['strength_training', 'fitness_equipment']);

function holds<C extends FailureStateCode>(...reasons: [Reasons<C, 'holds'>, ...Reasons<C, 'holds'>[]]): StateAssessment<C> {
    return { status: 'holds', reasons };
}

function sessionExecutionAbsent(view: CompletedWorkoutView): StateAssessment<'session_execution_absent'> {
    switch (view.sourceReads.structured.status) {
        case 'not_linked': return holds('no_execution_linked');
        case 'execution_missing': return holds('execution_document_missing');
        case 'execution_unavailable':
        case 'execution_invalid':
            return { status: 'not_observable', reason: 'execution_unreadable' };
        case 'available':
        case 'definition_unresolved':
        case 'entries_unavailable':
            // The execution document itself was read.
            return { status: 'clear' };
    }
}

function entryWriteUnsettled(view: CompletedWorkoutView): StateAssessment<'entry_write_unsettled'> {
    const outbox = view.sourceReads.outbox;
    switch (outbox.status) {
        case 'not_linked': return { status: 'not_applicable', reason: 'no_execution_linked' };
        case 'unreadable': return { status: 'not_observable', reason: 'receipts_unreadable' };
        case 'read': {
            const reasons: Reasons<'entry_write_unsettled', 'holds'>[] = [];
            if (outbox.failed > 0) reasons.push('failed_writes');
            if (outbox.queued > 0) reasons.push('queued_writes');
            const [first, ...rest] = reasons;
            if (first) return { status: 'holds', reasons: [first, ...rest] };
            // No receipt on this device. Receipts are per-device, so this cannot show that the
            // diary is synced -- another device may still hold an unsent write.
            return { status: 'not_observable', reason: 'receipts_are_device_local' };
        }
    }
}

function garminActivityAbsent(view: CompletedWorkoutView): StateAssessment<'garmin_activity_absent'> {
    switch (view.sourceReads.provider) {
        case 'not_linked': return holds('no_provider_linked');
        case 'non_garmin_only': return { status: 'not_applicable', reason: 'non_garmin_provider_only' };
        case 'activity_not_in_read_window': return holds('activity_not_in_read_window');
        case 'activities_unreadable': return { status: 'not_observable', reason: 'provider_activities_unreadable' };
        case 'available':
        case 'multiple_available':
            return { status: 'clear' };
        case 'multiple_incomplete': return holds('activity_not_in_read_window');
    }
}

type DetailExpectation =
    | { kind: 'no_activity' }
    | { kind: 'not_expected' }
    | { kind: 'sets'; count: number }
    | { kind: 'absent' };

function detailExpectation(view: CompletedWorkoutView): DetailExpectation {
    const activity = view.garmin;
    if (!activity) return { kind: 'no_activity' };
    if (!SET_DETAIL_ACTIVITY_TYPES.has(activity.type.toLowerCase())) return { kind: 'not_expected' };
    return activity.exerciseSets === undefined ? { kind: 'absent' } : { kind: 'sets', count: activity.exerciseSets.length };
}

function notApplicableDetail(expectation: DetailExpectation): { status: 'not_applicable'; reason: (typeof DETAIL_NOT_EXPECTED)[number] } | null {
    if (expectation.kind === 'no_activity') return { status: 'not_applicable', reason: 'no_garmin_activity' };
    if (expectation.kind === 'not_expected') return { status: 'not_applicable', reason: 'detail_not_expected_for_activity_type' };
    return null;
}

function garminDetailUnavailable(view: CompletedWorkoutView): StateAssessment<'garmin_detail_unavailable'> {
    const expectation = detailExpectation(view);
    const notApplicable = notApplicableDetail(expectation);
    if (notApplicable) return notApplicable;
    // `exerciseSets` is written only when the detail endpoint succeeded (`mapper.py`), so
    // stored sets are clear whatever the status says. Without sets the persisted
    // `detailStatus.exerciseSets` (#1051) says why; a legacy record has no status, and
    // `fetched` without sets contradicts the writer invariant, so neither is guessed at.
    if (expectation.kind === 'sets') return { status: 'clear' };
    switch (view.garmin?.detailStatus?.exerciseSets?.status) {
        case 'failed': return holds('detail_fetch_failed');
        case 'rate_limited': return holds('detail_fetch_rate_limited');
        case 'not_attempted': return { status: 'not_applicable', reason: 'detail_fetch_not_attempted' };
        case 'fetched':
        case undefined:
            return { status: 'not_observable', reason: 'detail_fetch_outcome_not_persisted' };
    }
}

function garminDetailEmpty(view: CompletedWorkoutView): StateAssessment<'garmin_detail_empty'> {
    const expectation = detailExpectation(view);
    const notApplicable = notApplicableDetail(expectation);
    if (notApplicable) return notApplicable;
    if (expectation.kind === 'absent') return { status: 'not_observable', reason: 'detail_not_stored' };
    return expectation.kind === 'sets' && expectation.count === 0 ? holds('exercise_sets_reported_empty') : { status: 'clear' };
}

function reconciliationNoCandidate(view: CompletedWorkoutView): StateAssessment<'reconciliation_no_candidate'> {
    const { state, excludedSourceKeys } = view.reconciliation;
    if (state !== 'single_source') return { status: 'clear' };
    // A sticky athlete decision is a recorded fact, independent of whether a sweep ran.
    if ((excludedSourceKeys?.length ?? 0) > 0) return holds('manually_separated');
    // The other half of a persisted ambiguity is not marked; it may be the competing candidate.
    if (view.sourceReads.ambiguousCounterpart) return { status: 'not_observable', reason: 'counterpart_ambiguous' };
    switch (view.sourceReads.reconciliationSweep) {
        case 'completed': return holds('no_candidate_after_sweep');
        case 'failed': return { status: 'not_observable', reason: 'sweep_failed' };
        case 'incomplete': return { status: 'not_observable', reason: 'sweep_incomplete' };
        case 'not_run': return { status: 'not_observable', reason: 'sweep_not_run' };
    }
}

function reconciliationAmbiguous(view: CompletedWorkoutView): StateAssessment<'reconciliation_ambiguous'> {
    return view.reconciliation.state === 'ambiguous' ? holds('competing_or_weak_candidates') : { status: 'clear' };
}

function readModelProjectionFailed(view: CompletedWorkoutView): StateAssessment<'read_model_projection_failed'> {
    const reasons: Reasons<'read_model_projection_failed', 'holds'>[] = [];
    switch (view.sourceReads.structured.status) {
        case 'execution_unavailable': reasons.push('execution_unavailable'); break;
        case 'execution_invalid': reasons.push('execution_invalid'); break;
        case 'definition_unresolved': reasons.push('definition_unresolved'); break;
        case 'entries_unavailable': reasons.push('entries_unavailable'); break;
        case 'not_linked':
        case 'available':
        case 'execution_missing':
            break;
    }
    if (view.sourceReads.provider === 'activities_unreadable') reasons.push('provider_activities_unreadable');
    const [first, ...rest] = reasons;
    return first ? { status: 'holds', reasons: [first, ...rest] } : { status: 'clear' };
}

function needsAttention(code: FailureStateCode, states: WorkoutStateAssessments, view: CompletedWorkoutView): boolean {
    switch (code) {
        case 'session_execution_absent': {
            const state = states.session_execution_absent;
            return state.status === 'not_observable'
                || (state.status === 'holds' && state.reasons.includes('execution_document_missing'));
        }
        case 'entry_write_unsettled': {
            const state = states.entry_write_unsettled;
            return state.status === 'holds' || (state.status === 'not_observable' && state.reason === 'receipts_unreadable');
        }
        case 'garmin_activity_absent': {
            const state = states.garmin_activity_absent;
            return state.status === 'not_observable'
                || (state.status === 'holds' && state.reasons.includes('activity_not_in_read_window'));
        }
        case 'garmin_detail_unavailable':
        case 'garmin_detail_empty': {
            // When structured sets exist, Garmin's recognition is diagnostic only (ADR-0034),
            // so its gaps are not the athlete's problem.
            const state = states[code];
            return !view.garminExerciseSetsAreDiagnosticOnly && (state.status === 'holds' || state.status === 'not_observable');
        }
        case 'reconciliation_no_candidate': {
            const state = states.reconciliation_no_candidate;
            return state.status === 'not_observable' && state.reason !== 'sweep_not_run';
        }
        case 'reconciliation_ambiguous': return states.reconciliation_ambiguous.status === 'holds';
        case 'read_model_projection_failed': return states.read_model_projection_failed.status === 'holds';
    }
}

/**
 * The shared source-completeness vocabulary (#914/#916) that `trainingResponseEvidence.ts`
 * already emits for planning. WP5 extends it with the finer per-state reasons above rather than
 * forking a second enum; this total mapping keeps the two views comparable. Several attached
 * provider sources are `ambiguous`, as in `trainingResponseEvidence.ts`; `partial` needs
 * per-source results the view does not keep, so an incomplete multi-source row stays `ambiguous`
 * and the finer detail lives in state 3. Persisted reconciliation ambiguity is state 7.
 */
export function sourceCompletenessFor(view: CompletedWorkoutView): TrainingResponseSessionEvidence['sourceCompleteness'] {
    const { structured, provider } = view.sourceReads;
    return {
        occurrenceRead: 'available',
        structuredExecution: structured.status === 'not_linked'
            ? 'not_linked'
            : structured.status === 'available' ? 'available' : 'unavailable',
        providerActivities: provider === 'not_linked'
            ? 'not_linked'
            : provider === 'available'
                ? 'available'
                // Several attached provider sources are `ambiguous` in the planning vocabulary too.
                : provider === 'multiple_available' || provider === 'multiple_incomplete' ? 'ambiguous' : 'unavailable',
    };
}

export function observedReconciliationOutcome(view: CompletedWorkoutView): ReconciliationOutcomeObservation {
    const { state, manualDecision } = view.reconciliation;
    // `ReconciliationOutcome` is a return value of the matcher, not a persisted field. Any
    // manual link/unlink/keep-separate is the athlete's decision, not a matcher outcome.
    if (manualDecision) return { status: 'not_observable', reason: 'manual_decision' };
    switch (state) {
        case 'single_source': return { status: 'observed', outcome: 'created_single_source' };
        case 'ambiguous': return { status: 'observed', outcome: 'ambiguous' };
        case 'matched': return { status: 'observed', outcome: 'attached_auto_link' };
    }
}

export function projectWorkoutSourceDiagnostics(view: CompletedWorkoutView): WorkoutSourceDiagnostics {
    const states: WorkoutStateAssessments = {
        session_execution_absent: sessionExecutionAbsent(view),
        entry_write_unsettled: entryWriteUnsettled(view),
        garmin_activity_absent: garminActivityAbsent(view),
        garmin_detail_unavailable: garminDetailUnavailable(view),
        garmin_detail_empty: garminDetailEmpty(view),
        reconciliation_no_candidate: reconciliationNoCandidate(view),
        reconciliation_ambiguous: reconciliationAmbiguous(view),
        read_model_projection_failed: readModelProjectionFailed(view),
    };
    return {
        performedOccurrenceId: view.performedOccurrenceId,
        states,
        attention: FAILURE_STATE_CODES.filter(code => needsAttention(code, states, view)),
        outbox: view.sourceReads.outbox,
        reconciliationSweep: view.sourceReads.reconciliationSweep,
        reconciliationOutcome: observedReconciliationOutcome(view),
    };
}
