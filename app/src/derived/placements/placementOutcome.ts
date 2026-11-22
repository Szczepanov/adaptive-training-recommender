/**
 * Derived outcome of a past plan placement: ledger export Phase 3, coaching continuity
 * (`docs/plans/2026-11-14-ledger-export-ai-content.md`, G3).
 *
 * Pure and export-only: nothing is written back, and today or later dates are never
 * classified. Every uncertain case resolves to a weaker state, because a wrong `missed` would
 * be a fabricated fact. The ADR-0052 D-EVAL §2 readout answers a related question with its own
 * vocabulary. It extends these inputs (per-execution completion fraction, executed definition
 * and performed date; link records instead of a boolean) rather than re-derive linkage on its own,
 * so the export and the readout cannot disagree about whether a session was performed.
 */
import { addDaysToLocalDateString, getDayDiff } from '../../utils/localDate.ts';

export const PLACEMENT_OUTCOMES = [
    'performed',
    'unknown',
    'done_unlinked',
    'started_not_completed',
    'dropped',
    'superseded',
    'missed',
] as const;
export type PlacementOutcome = typeof PLACEMENT_OUTCOMES[number];

export type PlacementOutcomeStatus = 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';

/** An execution of exactly this plan session: same plan id, revision, session id, and a content
 * hash that matches the verified stored revision. Title matches never count. */
export interface PlacementExecutionEvidence {
    state: 'in_progress' | 'completed' | 'abandoned';
}

export interface PlacementOutcomeInput {
    /** The placement's assigned date as of the export (a moved session uses its as-of date). */
    assignedDate: string;
    asOfDate: string;
    /** As-of placement status; `null` when the placement was removed from the overlay. */
    status: PlacementOutcomeStatus | null;
    /** Placements, executions and planned-to-performed links were all read completely, and the
     * reads cover this placement (its dates, its revision and the export window). */
    evidenceComplete: boolean;
    /** A valid, hash-verified planned-to-performed link exists for this placement. */
    linked: boolean;
    /** A link or execution for this placement exists but its revision or content hash did not verify. */
    unverifiedEvidence: boolean;
    executions: readonly PlacementExecutionEvidence[];
}

/**
 * The outcome of one placement dated before `asOfDate`, or `null` for today and later. Rules
 * are applied in order and the first match wins:
 * 1. a valid planned-to-performed link → `performed`;
 * 2. incomplete reads, a removed placement or unverifiable link/execution evidence → `unknown`;
 * 3. status `completed`, or a completed execution with no link → `done_unlinked`;
 * 4. a started or abandoned execution of the session → `started_not_completed`;
 * 5. status `dropped` or `superseded` → that status;
 * 6. otherwise → `missed`.
 */
export function classifyPlacementOutcome(input: PlacementOutcomeInput): PlacementOutcome | null {
    if (input.assignedDate >= input.asOfDate) return null;
    if (input.linked) return 'performed';
    if (!input.evidenceComplete || input.status === null || input.unverifiedEvidence) return 'unknown';
    if (input.status === 'completed' || input.executions.some(execution => execution.state === 'completed')) {
        return 'done_unlinked';
    }
    if (input.executions.length > 0) return 'started_not_completed';
    if (input.status === 'dropped' || input.status === 'superseded') return input.status;
    return 'missed';
}

export const DEVAL_SESSION_OUTCOMES = [
    'unknown',
    'reduced',
    'partial',
    'moved',
    'completed',
    'flag_skip',
    'missed',
] as const;
export type DEvalSessionOutcome = typeof DEVAL_SESSION_OUTCOMES[number];

export interface DEvalLinkedExecutionEvidence {
    state: 'in_progress' | 'completed' | 'abandoned';
    executedDefinition?: 'authored' | 'reduced' | null;
    completedFraction?: number | null;
}

export interface DEvalPlannedSessionInput extends PlacementOutcomeInput {
    performedDate?: string | null;
    blockStartDate: string;
    blockEndDate: string;
    linkedExecution?: DEvalLinkedExecutionEvidence | null;
    responseCompletedFraction?: number | null;
    activeFlagOnAssignedDate?: boolean | null;
    redFlagOnAssignedDate?: boolean | null;
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMPLETION_FRACTION_EPSILON = 1e-6;

function isLocalDate(value: unknown): value is string {
    return typeof value === 'string' && LOCAL_DATE_PATTERN.test(value) && addDaysToLocalDateString(value, 0) === value;
}

function isValidCompletedFraction(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Classifies one planned session under ADR-0052 D-EVAL §2 rules in strict table order
 * (first match wins): `unknown` -> `reduced` -> `partial` -> `moved` -> `completed` ->
 * `flag_skip` -> `missed`. Never infers full completion from linkage alone.
 */
export function classifyDEvalSessionOutcome(input: DEvalPlannedSessionInput): DEvalSessionOutcome {
    if (!input.evidenceComplete || input.status === null || input.unverifiedEvidence) {
        return 'unknown';
    }
    if (!isLocalDate(input.assignedDate) || !isLocalDate(input.blockStartDate) || !isLocalDate(input.blockEndDate)) {
        return 'unknown';
    }
    if (input.blockStartDate > input.blockEndDate) {
        return 'unknown';
    }

    if (!input.linked) {
        const hasAmbiguousCompletion = input.status === 'completed'
            || input.executions.some(execution => execution.state === 'completed')
            || (input.linkedExecution !== null && input.linkedExecution !== undefined)
            || (input.responseCompletedFraction !== null && input.responseCompletedFraction !== undefined);
        if (hasAmbiguousCompletion) {
            return 'unknown';
        }
        if (
            input.activeFlagOnAssignedDate === null
            || input.activeFlagOnAssignedDate === undefined
            || input.redFlagOnAssignedDate === null
            || input.redFlagOnAssignedDate === undefined
        ) {
            return 'unknown';
        }
        if (input.activeFlagOnAssignedDate === true || input.redFlagOnAssignedDate === true) {
            return 'flag_skip';
        }
        return 'missed';
    }

    if (input.performedDate !== null && input.performedDate !== undefined && !isLocalDate(input.performedDate)) {
        return 'unknown';
    }

    const execFrac = input.linkedExecution?.completedFraction;
    const respFrac = input.responseCompletedFraction;
    const hasExecFrac = execFrac !== null && execFrac !== undefined;
    const hasRespFrac = respFrac !== null && respFrac !== undefined;

    if (hasExecFrac && !isValidCompletedFraction(execFrac)) {
        return 'unknown';
    }
    if (hasRespFrac && !isValidCompletedFraction(respFrac)) {
        return 'unknown';
    }
    if (hasExecFrac && hasRespFrac) {
        if ((execFrac === 1) !== (respFrac === 1) || Math.abs(execFrac - respFrac) > COMPLETION_FRACTION_EPSILON) {
            return 'unknown';
        }
    }

    const resolvedFraction = hasExecFrac ? execFrac : hasRespFrac ? respFrac : null;
    const execState = input.linkedExecution?.state;

    if (resolvedFraction === 1 && (execState === 'abandoned' || execState === 'in_progress')) {
        return 'unknown';
    }
    if (
        execState === undefined
        && resolvedFraction === 1
        && input.executions.some(execution => execution.state === 'abandoned' || execution.state === 'in_progress')
        && !input.executions.some(execution => execution.state === 'completed')
    ) {
        return 'unknown';
    }

    if (input.linkedExecution?.executedDefinition === 'reduced') {
        return 'reduced';
    }

    if (resolvedFraction === null) {
        if (execState === 'abandoned') {
            return 'partial';
        }
        return 'unknown';
    }

    if (resolvedFraction < 1 || execState === 'abandoned') {
        return 'partial';
    }

    if (!isLocalDate(input.performedDate)) {
        return 'unknown';
    }

    if (input.status === 'moved') {
        return input.performedDate >= input.blockStartDate && input.performedDate <= input.blockEndDate
            ? 'moved'
            : 'missed';
    }

    if (Math.abs(getDayDiff(input.performedDate, input.assignedDate)) <= 1) {
        return 'completed';
    }

    return 'missed';
}
