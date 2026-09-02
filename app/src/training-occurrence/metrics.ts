/**
 * Shadow-mode observability. This repository has no metrics backend at all today (no
 * `metrics.ts`/structured event emitter anywhere else in `app/src` -- verified) -- the
 * closest existing convention is `[functionName]` console tagging (e.g.
 * `engine/fatigue.ts`, `engine/stimulus.ts`). This module follows that, plus an
 * in-memory counter map tests can assert against and a future real metrics backend can
 * replace, so shadow-mode precision (`docs/plans/training-occurrence-pr1-scope.md`
 * "Shadow-mode output") is at least locally inspectable in this PR.
 */

export type ShadowReconciliationEventType =
    | 'training_occurrence.single_source'
    | 'training_occurrence.matched'
    | 'training_occurrence.ambiguous'
    | 'training_occurrence.source_link_conflict'
    | 'training_occurrence.merge_tombstone_created'
    | 'training_occurrence.manual_override_preserved'
    | 'training_occurrence.projection_rebuild'
    | 'training_occurrence.reconciliation_error';

export interface ShadowReconciliationEvent {
    type: ShadowReconciliationEventType;
    userId: string;
    performedOccurrenceId?: string;
    matcherVersion?: string;
    policyVersion?: string;
    confidence?: number;
    competingCandidateCount?: number;
    message?: string;
}

const counters = new Map<ShadowReconciliationEventType, number>();

export function recordShadowReconciliationEvent(event: ShadowReconciliationEvent): void {
    counters.set(event.type, (counters.get(event.type) ?? 0) + 1);
    console.info(`[training_occurrence] ${event.type}`, {
        userId: event.userId,
        performedOccurrenceId: event.performedOccurrenceId,
        matcherVersion: event.matcherVersion,
        policyVersion: event.policyVersion,
        confidence: event.confidence,
        competingCandidateCount: event.competingCandidateCount,
        message: event.message,
    });
}

export function getShadowReconciliationCounters(): Readonly<Record<string, number>> {
    return Object.fromEntries(counters);
}

export function resetShadowReconciliationCounters(): void {
    counters.clear();
}
