/**
 * PR 1 (ADR-0034 / docs/plans/training-occurrence-pr1-scope.md): canonical
 * performed-training-occurrence domain model.
 *
 * `PerformedTrainingOccurrence` is deliberately NOT `SessionOccurrence`
 * (`sessions/models.ts` -- planning/authority) and NOT `SessionExecution` or a Garmin
 * activity (source records). It is a provider-neutral projection/linkage record for one
 * physical workout actually performed, built from zero-or-one structured execution
 * source plus zero-or-more wearable/provider activity sources.
 *
 * Shadow mode only in PR 1: nothing in app/src/engine or the Activities read path
 * consumes this yet (see docs/plans/training-occurrence-pr1-scope.md "explicitly out of
 * scope"). Raw source records (SessionExecution/SessionEntry, NormalizedGarminActivity)
 * are never destructively merged -- this module only links them.
 */

export const PERFORMED_OCCURRENCE_SCHEMA_VERSION = 1;
export const RECONCILIATION_MATCHER_VERSION = 'matcher-v1';
export const RECONCILIATION_POLICY_VERSION = 'policy-v1';

/**
 * A source belongs to at most one live (`status: 'active'`) canonical occurrence
 * (ADR-0034 "Source-link uniqueness"). `structured_execution` carries the
 * `SessionExecution`/`SessionOccurrence` identity; `provider_activity` generalizes over
 * Garmin (and any future wearable provider) so the storage model never assumes a single
 * Garmin slot.
 */
export type PerformedOccurrenceSourceRef =
    | {
          kind: 'structured_execution';
          executionId: string;
          sessionOccurrenceId?: string;
          prescriptionHash?: string;
      }
    | {
          kind: 'provider_activity';
          provider: string;
          activityId: string;
          deviceId?: string;
      };

export type PerformedOccurrenceSourceKind = PerformedOccurrenceSourceRef['kind'];

export type PerformedOccurrenceStatus = 'active' | 'merged';

/** Mirrors ADR-0034's reconciliation evidence contract: `single_source` (only one kind of
 * source attached yet), `matched` (auto-linked above the auto-link threshold), or
 * `ambiguous` (a competing candidate existed; deliberately left unmerged). */
export type ReconciliationStatus = 'single_source' | 'matched' | 'ambiguous';

/**
 * A manual decision is sticky (ADR-0034 "Link stability"): once recorded, routine
 * reconciliation must never silently reverse it. `excludedSourceKeys` remembers exactly
 * which specific source(s) were explicitly rejected for this occurrence so a future sweep
 * does not re-propose the same pairing -- a manual unlink is about a specific pair, not a
 * blanket "never reconcile this occurrence again".
 */
export interface ManualReconciliationDecision {
    decision: 'link' | 'unlink' | 'keep_separate';
    actor: string;
    decidedAt: string;
    previousState?: string;
    resultingState?: string;
    reason?: string;
    matcherVersionAtDecision?: string;
    scoreAtDecision?: number;
}

export interface ReconciliationProvenance {
    state: ReconciliationStatus;
    matcherVersion?: string;
    policyVersion?: string;
    confidence?: number;
    features?: Record<string, number | string | boolean | null>;
    linkedAt?: string;
    manualDecision?: ManualReconciliationDecision;
    /** Source keys (see `sourceIdentity.ts`) explicitly rejected as a match for this
     * occurrence via a manual unlink/keep-separate decision. */
    excludedSourceKeys?: string[];
}

export interface PerformedTrainingOccurrence {
    schemaVersion: number;
    performedOccurrenceId: string;
    userId: string;

    status: PerformedOccurrenceStatus;
    /** Set only when `status === 'merged'`: the survivor this record's sources/history
     * were moved into. Public queries must exclude merged records; a merge never deletes
     * the loser so audit/rebuild remains possible (ADR-0034 "Identity and merge semantics"). */
    mergedIntoOccurrenceId?: string;

    startedAt?: string;
    endedAt?: string;
    /** Warsaw-local calendar date, a supporting/search field only -- never the basis for
     * match identity (ADR-0034 "Time semantics"). */
    localDate?: string;
    modality?: string;

    sourceRefs: PerformedOccurrenceSourceRef[];

    reconciliation: ReconciliationProvenance;

    createdAt: string;
    updatedAt: string;
}

/** Enforces "(source kind, provider?, source id) -> exactly zero or one live canonical
 * occurrence" (ADR-0034). Doc ID is `encodeSourceKeyForDocId(sourceKey)`
 * (`sourceIdentity.ts`); the link is the transactional claim primitive that makes
 * concurrent source arrival and repeated sync idempotent. */
export interface PerformedOccurrenceSourceLink {
    schemaVersion: number;
    sourceKey: string;
    sourceKind: PerformedOccurrenceSourceKind;
    userId: string;
    performedOccurrenceId: string;
    createdAt: string;
    updatedAt: string;
}

/** Minimal, source-kind-neutral facts needed for candidate generation/scoring. Both a
 * `SessionExecution` and a `NormalizedGarminActivity` get normalized to this shape before
 * reconciliation ever compares them (`reconciliationService.ts`). */
export interface ReconciliationSourceFacts {
    sourceRef: PerformedOccurrenceSourceRef;
    localDate: string;
    /** Absolute ISO instants. Both may be absent (e.g. a Garmin activity ingested before
     * `startedAt`/`endedAt` existed, or missing `startTimeGMT`) -- matching degrades to
     * duration/modality/date evidence only, never claims false timestamp precision. */
    startedAt?: string;
    endedAt?: string;
    durationMin: number | null;
    modality?: string;
    prescriptionHash?: string;
}
