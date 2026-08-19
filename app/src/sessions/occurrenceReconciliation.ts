/**
 * M4.3: companion occurrence identity and duplicate reconciliation.
 *
 * An embedded segment (another block inside the same `SessionDefinition`, e.g. fixture 01's
 * Olympic power block ahead of its strength pairing) is never a companion -- the model
 * already keeps those apart structurally (`SessionDefinition.blocks` vs.
 * `SessionDefinition.companionSessions`), and the runner/preview already render them
 * separately (M3.7). What this module adds is the piece that was actually missing: a stable
 * identity for a `SessionExecution` occurrence, and a way to recognize when a manually
 * logged execution and a Garmin-synced activity are evidence for the same physical
 * occurrence, so a later companion (e.g. the recovery-bike spin in fixture 03/08) that gets
 * both logged in-app and synced from Garmin is not counted twice.
 *
 * Per D-MPOLICY, "domain exposure" derived from general (non-Strength) session executions
 * remains a default-off evidence candidate until its own ship decision -- exactly the
 * discipline `deriveStrengthExposure`'s legacy `manualTrainingPolicy` gate already applies
 * to `strength_sessions`. This module computes reconciliation and stable keys; it
 * deliberately is not wired into `buildTrainingHistorySnapshot` or any other live engine
 * cost/stimulus path. It is forward-compatible plumbing for when that becomes its own
 * evidenced decision, not a silent activation now.
 */
import type { NormalizedGarminActivity } from '../engine/models';
import type { SessionExecution } from './models';

export interface ExecutionOccurrenceSummary {
    executionId: string;
    occurrenceId?: string;
    /** Warsaw-local calendar date the execution happened on (`SessionExecution.date`). */
    date: string;
    /** The resolved definition's `dominantModality`, in the same lowercase vocabulary
     * `ManualSessionBuilder`/`ExerciseDefinition` use -- absent when the definition could not
     * be resolved, in which case matching is date-only. */
    modality?: string;
    /** Minutes between `startedAt` and `completedAt`; `null` while still in progress or if
     * the execution never recorded a completion. An execution with no comparable duration
     * cannot be matched against a Garmin activity's measured duration. */
    durationMin: number | null;
}

/** A stable identity for one logged occurrence, independent of Garmin reconciliation --
 * scoped to the authority-bearing occurrence when one exists, and to the execution itself
 * otherwise (an `unplanned_log`/companion execution has no `occurrenceId` per D-MAUTH, but
 * still deserves one stable, idempotent key). */
export function sessionExecutionOccurrenceKey(execution: Pick<SessionExecution, 'executionId' | 'occurrenceId'>): string {
    return execution.occurrenceId ? `occurrence:${execution.occurrenceId}` : `execution:${execution.executionId}`;
}

export function summarizeExecutionForReconciliation(
    execution: Pick<SessionExecution, 'executionId' | 'occurrenceId' | 'date' | 'startedAt' | 'completedAt'>,
    dominantModality?: string,
): ExecutionOccurrenceSummary {
    const durationMin = execution.completedAt
        ? Math.max(0, Math.round((Date.parse(execution.completedAt) - Date.parse(execution.startedAt)) / 60000))
        : null;
    return {
        executionId: execution.executionId,
        occurrenceId: execution.occurrenceId,
        date: execution.date,
        ...(dominantModality ? { modality: dominantModality } : {}),
        durationMin,
    };
}

// Mirrors engine/completedTraining.ts's own (private) activity-type classification in
// spirit, not by import: that module's vocabulary is the capitalized SessionTemplate
// modality union, while a resolved SessionDefinition's `dominantModality` uses the
// lowercase catalog/workout vocabulary this module actually receives. Kept deliberately
// small and local rather than exported/shared, since the two vocabularies are genuinely
// different types, not the same list spelled differently.
const GARMIN_ACTIVITY_TYPE_KEYWORDS: Record<string, string[]> = {
    cycling: ['cycl', 'bike'],
    running: ['run'],
    strength: ['strength', 'weight', 'lift'],
    field: ['soccer', 'football', 'field'],
    mobility: ['yoga', 'mobility'],
    cross_training: ['swim', 'row', 'ellipt', 'cardio'],
};

function normalizedGarminModality(activityType: string): string | null {
    const normalized = activityType.toLowerCase();
    for (const [modality, keywords] of Object.entries(GARMIN_ACTIVITY_TYPE_KEYWORDS)) {
        if (keywords.some(keyword => normalized.includes(keyword))) return modality;
    }
    return null;
}

const DEFAULT_DURATION_TOLERANCE_MIN = 20;

export interface ExecutionGarminMatch {
    executionId: string;
    activityId: string;
    executionDurationMin: number;
    activityDurationMin: number;
}

/**
 * Finds the closest same-date, compatible-modality, comparable-duration Garmin activity for
 * each execution -- one activity reconciles to at most one execution, mirroring
 * `completedTraining.ts`'s own adherence-to-Garmin matching tolerance and exclusivity so the
 * two reconciliation paths behave consistently. An execution with no resolved modality still
 * matches on date and duration alone; an execution with no completed duration is never
 * matched (nothing to compare yet, and "counted once" isn't at risk until it's counted at
 * all).
 *
 * Matching is global, not per-execution-in-isolation: every valid (execution, activity) pair
 * within tolerance is a candidate, and candidates are claimed in order of increasing duration
 * difference. That way a Garmin activity contested by two executions goes to whichever one is
 * genuinely the closer duration match, not whichever execution happens to sort first.
 */
export function matchExecutionsToGarminActivities(
    executions: readonly ExecutionOccurrenceSummary[],
    activities: readonly NormalizedGarminActivity[],
    toleranceMinutes: number = DEFAULT_DURATION_TOLERANCE_MIN,
): ExecutionGarminMatch[] {
    interface Candidate {
        execution: ExecutionOccurrenceSummary;
        activity: NormalizedGarminActivity;
        difference: number;
    }

    const candidates: Candidate[] = [];
    for (const execution of executions) {
        if (execution.durationMin === null) continue;
        for (const activity of activities) {
            if (activity.date !== execution.date) continue;
            if (activity.durationMin === null) continue;
            if (execution.modality && normalizedGarminModality(activity.type) !== execution.modality) continue;
            const difference = Math.abs(activity.durationMin - execution.durationMin);
            if (difference > toleranceMinutes) continue;
            candidates.push({ execution, activity, difference });
        }
    }

    // Closest difference first; ties broken deterministically by id rather than input order.
    candidates.sort((left, right) => left.difference - right.difference
        || left.execution.executionId.localeCompare(right.execution.executionId)
        || left.activity.activityId.localeCompare(right.activity.activityId));

    const claimedActivityIds = new Set<string>();
    const claimedExecutionIds = new Set<string>();
    const matches: ExecutionGarminMatch[] = [];
    for (const candidate of candidates) {
        if (claimedActivityIds.has(candidate.activity.activityId)) continue;
        if (claimedExecutionIds.has(candidate.execution.executionId)) continue;
        claimedActivityIds.add(candidate.activity.activityId);
        claimedExecutionIds.add(candidate.execution.executionId);
        matches.push({
            executionId: candidate.execution.executionId,
            activityId: candidate.activity.activityId,
            executionDurationMin: candidate.execution.durationMin!,
            activityDurationMin: candidate.activity.durationMin!,
        });
    }

    return matches;
}
