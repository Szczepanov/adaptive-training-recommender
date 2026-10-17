/**
 * #895 WP5 -- user-initiated, bounded diagnostics export. Pure: the caller supplies the
 * timestamp and the window; nothing here reads a clock, storage or the network.
 *
 * Privacy (invariant I6): ids, source keys, states, reasons and timestamps only. Everything is
 * copied field-by-field from an allow-list -- the `CompletedWorkoutView` is never spread, so a
 * telemetry or free-text field added to it later cannot leak into an export by accident.
 */
import type { CompletedWorkoutView, OutboxSnapshot, ReconciliationSweepStatus, StructuredSourceRead } from './completedWorkoutView';
import {
    FAILURE_STATE_CODES,
    FAILURE_STATE_NUMBER,
    projectWorkoutSourceDiagnostics,
    sourceCompletenessFor,
    type FailureStateCode,
    type ReconciliationOutcomeObservation,
    type StateAssessment,
} from './workoutSourceDiagnostics';
import type { TrainingResponseSessionEvidence } from './trainingResponseEvidence';
import {
    countFitWorkoutIdentityObservations,
    countUnlinkedSameDayFitPairs,
    type FitIdentityObservationStatus,
    type FitWorkoutIdentityObservation,
    type SingleSourceFitEvidence,
    type UnlinkedSameDayFitPairs,
} from './fitWorkoutIdentityDiagnostics';

export const WORKOUT_DIAGNOSTICS_EXPORT_SCHEMA = 'workout-source-diagnostics-v2';
export const MAX_EXPORT_WORKOUTS = 100;
const MAX_EXPORT_SOURCE_KEYS = 20;

const SCOPE_NOTES = [
    'Diary write receipts (outbox) are read from this device only; zero here is not proof of "synced", and other devices cannot be checked from this one.',
    'not_observable means the evidence needed to decide was not available. It is never an empty, zero or healthy result.',
    'Contains identifiers, source keys, states, reasons and timestamps only; no telemetry, exercise data or credentials.',
    'fitWorkoutIdentity compares FIT workout fingerprints only (ADR-0051 D7); fingerprints themselves are not exported.',
    'unlinkedSameDayFitPairs counts unlinked structured/recording rows on the same local date by fingerprint equality; the date selects rows to count and never links them.',
] as const;

export type ExportedStateAssessment =
    | { number: number; status: 'holds'; reasons: readonly string[] }
    | { number: number; status: 'clear' }
    | { number: number; status: 'not_applicable'; reason: string }
    | { number: number; status: 'not_observable'; reason: string };

export interface ExportedWorkout {
    performedOccurrenceId: string;
    localDate: string | null;
    startedAt: string | null;
    endedAt: string | null;
    modality: string | null;
    sourceKeys: string[];
    sourceKeyCount: number;
    reconciliation: {
        state: CompletedWorkoutView['reconciliation']['state'];
        matcherVersion: string | null;
        policyVersion: string | null;
        confidence: number | null;
        manualDecision: { decision: string; decidedAt: string } | null;
        excludedSourceKeys: string[];
    };
    reconciliationOutcome: ReconciliationOutcomeObservation;
    reconciliationSweep: string;
    sourceReads: { structured: StructuredSourceRead; provider: string };
    /** The shared #914/#916 vocabulary, so this export lines up with planning-side evidence. */
    sourceCompleteness: TrainingResponseSessionEvidence['sourceCompleteness'];
    outbox: OutboxSnapshot;
    states: Record<FailureStateCode, ExportedStateAssessment>;
    attention: FailureStateCode[];
    fitWorkoutIdentity: FitWorkoutIdentityObservation;
}

interface ExportEnvelope {
    schema: typeof WORKOUT_DIAGNOSTICS_EXPORT_SCHEMA;
    generatedAt: string;
    window: { from: string; toExclusive: string };
    /** Whether the window's reconciliation sweep evaluated every source; only `completed`
     * licenses reading an empty or single-source window as "nothing / no candidate". */
    reconciliationSweep: ReconciliationSweepStatus | 'unknown';
    scopeNotes: readonly string[];
}

export interface AvailableWorkoutDiagnosticsExport extends ExportEnvelope {
    projection: 'available';
    totalWorkouts: number;
    truncated: boolean;
    outboxDepth: { queued: number; failed: number; workoutsWithUnreadableReceipts: number };
    /** Over every workout in the window, not only the exported (possibly truncated) slice. */
    fitWorkoutIdentityCounts: Record<FitIdentityObservationStatus, number>;
    /** Mismatched pairs are never linked, so they are only visible here (ADR-0051 D7). */
    unlinkedSameDayFitPairs: UnlinkedSameDayFitPairs;
    workouts: ExportedWorkout[];
    windowState?: never;
}

/** The window itself could not be projected (state 8). Counts are `null`, not 0: unknown stays unknown. */
export interface FailedWorkoutDiagnosticsExport extends ExportEnvelope {
    projection: 'failed';
    totalWorkouts: null;
    truncated: null;
    outboxDepth: null;
    fitWorkoutIdentityCounts: null;
    unlinkedSameDayFitPairs: null;
    workouts: null;
    windowState: { number: 8; code: 'read_model_projection_failed'; status: 'holds' };
}

export type WorkoutDiagnosticsExport = AvailableWorkoutDiagnosticsExport | FailedWorkoutDiagnosticsExport;

export type WorkoutDiagnosticsResult =
    | { status: 'available'; workouts: readonly CompletedWorkoutView[] }
    | { status: 'projection_failed' };

function compareNewestFirst(a: CompletedWorkoutView, b: CompletedWorkoutView): number {
    return (b.localDate ?? '').localeCompare(a.localDate ?? '')
        || (b.startedAt ?? '').localeCompare(a.startedAt ?? '')
        || a.performedOccurrenceId.localeCompare(b.performedOccurrenceId);
}

/** Rebuilt member by member: a field later added to a read-status union cannot reach the export. */
function exportStructuredRead(read: StructuredSourceRead): StructuredSourceRead {
    switch (read.status) {
        case 'definition_unresolved': return { status: 'definition_unresolved', definition: read.definition };
        case 'not_linked':
        case 'available':
        case 'execution_missing':
        case 'execution_invalid':
        case 'execution_unavailable':
        case 'entries_unavailable':
            return { status: read.status };
    }
}

function exportOutbox(outbox: OutboxSnapshot): OutboxSnapshot {
    return outbox.status === 'read'
        ? { status: 'read', queued: outbox.queued, failed: outbox.failed }
        : { status: outbox.status };
}

function exportOutcome(outcome: ReconciliationOutcomeObservation): ReconciliationOutcomeObservation {
    return outcome.status === 'observed'
        ? { status: 'observed', outcome: outcome.outcome }
        : { status: 'not_observable', reason: outcome.reason };
}

function exportStates(view: CompletedWorkoutView): Record<FailureStateCode, ExportedStateAssessment> {
    const { states } = projectWorkoutSourceDiagnostics(view);
    const entries = FAILURE_STATE_CODES.map(code => {
        const assessment: StateAssessment<FailureStateCode> = states[code];
        const number = FAILURE_STATE_NUMBER[code];
        switch (assessment.status) {
            case 'holds': return [code, { number, status: 'holds', reasons: [...assessment.reasons] }] as const;
            case 'clear': return [code, { number, status: 'clear' }] as const;
            case 'not_applicable': return [code, { number, status: 'not_applicable', reason: assessment.reason }] as const;
            case 'not_observable': return [code, { number, status: 'not_observable', reason: assessment.reason }] as const;
        }
    });
    return Object.fromEntries(entries) as Record<FailureStateCode, ExportedStateAssessment>;
}

function fitIdentityFor(view: CompletedWorkoutView): FitWorkoutIdentityObservation {
    return view.fitWorkoutIdentity ?? { status: 'not_observable', reason: 'not_projected' };
}

/** Rebuilt member by member, like the read statuses: no fingerprint can ride along. */
function exportFitIdentity(observation: FitWorkoutIdentityObservation): FitWorkoutIdentityObservation {
    switch (observation.status) {
        case 'semantic_match': return { status: 'semantic_match' };
        case 'semantic_mismatch': return { status: 'semantic_mismatch', reason: observation.reason };
        case 'not_comparable': return { status: 'not_comparable', reason: observation.reason };
        case 'not_applicable': return { status: 'not_applicable', reason: observation.reason };
        case 'not_observable': return { status: 'not_observable', reason: observation.reason };
    }
}

function exportWorkout(view: CompletedWorkoutView): ExportedWorkout {
    const diagnostics = projectWorkoutSourceDiagnostics(view);
    const { reconciliation } = view;
    const sourceKeys = [...view.sourceKeys].sort();
    return {
        performedOccurrenceId: view.performedOccurrenceId,
        localDate: view.localDate ?? null,
        startedAt: view.startedAt ?? null,
        endedAt: view.endedAt ?? null,
        modality: view.modality ?? null,
        sourceKeys: sourceKeys.slice(0, MAX_EXPORT_SOURCE_KEYS),
        sourceKeyCount: sourceKeys.length,
        reconciliation: {
            state: reconciliation.state,
            matcherVersion: reconciliation.matcherVersion ?? null,
            policyVersion: reconciliation.policyVersion ?? null,
            confidence: reconciliation.confidence ?? null,
            // The decision and when it was made are debugging evidence; the actor (a user id)
            // and the free-text reason are deliberately not exported.
            manualDecision: reconciliation.manualDecision
                ? { decision: reconciliation.manualDecision.decision, decidedAt: reconciliation.manualDecision.decidedAt }
                : null,
            excludedSourceKeys: [...(reconciliation.excludedSourceKeys ?? [])].sort().slice(0, MAX_EXPORT_SOURCE_KEYS),
        },
        reconciliationOutcome: exportOutcome(diagnostics.reconciliationOutcome),
        reconciliationSweep: diagnostics.reconciliationSweep,
        sourceReads: { structured: exportStructuredRead(view.sourceReads.structured), provider: view.sourceReads.provider },
        sourceCompleteness: sourceCompletenessFor(view),
        outbox: exportOutbox(diagnostics.outbox),
        states: exportStates(view),
        attention: diagnostics.attention,
        fitWorkoutIdentity: exportFitIdentity(fitIdentityFor(view)),
    };
}

function outboxDepth(workouts: readonly CompletedWorkoutView[]): AvailableWorkoutDiagnosticsExport['outboxDepth'] {
    return workouts.reduce((depth, { sourceReads: { outbox } }) => {
        if (outbox.status === 'read') return { ...depth, queued: depth.queued + outbox.queued, failed: depth.failed + outbox.failed };
        if (outbox.status === 'unreadable') return { ...depth, workoutsWithUnreadableReceipts: depth.workoutsWithUnreadableReceipts + 1 };
        return depth;
    }, { queued: 0, failed: 0, workoutsWithUnreadableReceipts: 0 });
}

export function buildWorkoutDiagnosticsExport(input: {
    window: { from: string; toExclusive: string };
    generatedAt: string;
    /** `unknown` when the caller never observed the sweep (not the same as `not_run`). */
    reconciliationSweep: ReconciliationSweepStatus | 'unknown';
    result: WorkoutDiagnosticsResult;
}): WorkoutDiagnosticsExport {
    const envelope: ExportEnvelope = {
        schema: WORKOUT_DIAGNOSTICS_EXPORT_SCHEMA,
        generatedAt: input.generatedAt,
        window: { from: input.window.from, toExclusive: input.window.toExclusive },
        reconciliationSweep: input.reconciliationSweep,
        scopeNotes: SCOPE_NOTES,
    };
    if (input.result.status === 'projection_failed') {
        return {
            ...envelope,
            projection: 'failed',
            totalWorkouts: null,
            truncated: null,
            outboxDepth: null,
            fitWorkoutIdentityCounts: null,
            unlinkedSameDayFitPairs: null,
            workouts: null,
            windowState: { number: 8, code: 'read_model_projection_failed', status: 'holds' },
        };
    }
    const ordered = [...input.result.workouts].sort(compareNewestFirst);
    return {
        ...envelope,
        projection: 'available',
        totalWorkouts: ordered.length,
        truncated: ordered.length > MAX_EXPORT_WORKOUTS,
        outboxDepth: outboxDepth(ordered),
        fitWorkoutIdentityCounts: countFitWorkoutIdentityObservations(ordered.map(fitIdentityFor)),
        unlinkedSameDayFitPairs: countUnlinkedSameDayFitPairs(
            ordered.flatMap(view => (view.singleSourceFitEvidence ? [view.singleSourceFitEvidence] : [])) satisfies SingleSourceFitEvidence[],
        ),
        workouts: ordered.slice(0, MAX_EXPORT_WORKOUTS).map(exportWorkout),
    };
}

export function serializeWorkoutDiagnosticsExport(exported: WorkoutDiagnosticsExport): string {
    return JSON.stringify(exported, null, 2);
}
