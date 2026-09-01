# PR 1 scope: canonical performed occurrence and shadow reconciliation

Status: scoped implementation slice

This document narrows the first implementation PR so it can be reviewed independently from UI and training-engine behavior.

## Goal

Create the canonical performed-occurrence persistence/reconciliation foundation and run it in shadow mode without changing Activities or completed-training semantics.

## In scope

- code-level performed-occurrence model and schema;
- source-reference model supporting structured execution plus provider activities;
- source-to-occurrence uniqueness mechanism;
- idempotent create/update/attach/detach operations;
- merge survivor/tombstone behavior;
- candidate generation and versioned reconciliation scoring/policy;
- sticky manual decision representation, even if UI for it comes later;
- shadow reconciliation triggered from source ingestion/completion paths;
- audit/provenance fields for automatic matches;
- user-scoped Firestore rules and indexes;
- rebuild/repair API or service primitive;
- unit/integration/emulator tests;
- metrics/logs required to judge shadow precision.

## Explicitly out of scope

- changing the Activities list/detail read path;
- changing coach recommendations;
- changing completed-training load/evidence;
- historical full backfill;
- performed-rest persistence;
- FIT Workout/WorkoutStep decoding;
- athlete-facing manual reconciliation UI.

## Suggested internal components

Names are illustrative and should follow repository conventions.

```text
app/src/training-occurrence/
  models.ts
  repository.ts
  sourceIdentity.ts
  reconciliationCandidates.ts
  reconciliationScore.ts
  reconciliationPolicy.ts
  reconciliationService.ts
  projectionBuilder.ts
  rebuildService.ts
```

The existing `app/src/sessions/occurrenceReconciliation.ts` should either be migrated into this boundary or become a thin compatibility helper. Avoid leaving two independent production matchers.

## Minimum canonical record

The first persisted record only needs fields necessary for identity, provenance, shadow inspection, and later read-model construction.

Illustrative shape:

```ts
interface PerformedTrainingOccurrence {
  schemaVersion: number;
  performedOccurrenceId: string;
  userId: string;

  status: 'active' | 'merged';
  mergedIntoOccurrenceId?: string;

  startedAt?: string;
  endedAt?: string;
  localDate?: string;
  modality?: string;

  sourceRefs: PerformedOccurrenceSourceRef[];

  reconciliation: {
    state: 'single_source' | 'matched' | 'ambiguous';
    matcherVersion?: string;
    policyVersion?: string;
    confidence?: number;
    features?: Record<string, number | string | boolean | null>;
    linkedAt?: string;
    manualDecision?: ManualReconciliationDecision;
  };

  createdAt: string;
  updatedAt: string;
}
```

Do not treat this exact interface as final API. The important constraints are stable canonical identity, source refs, merge lineage, and replayable reconciliation provenance.

## Source identity

Normalize source identities before persistence, for example:

```text
structured_execution:{executionId}
garmin_activity:{activityId}
```

If stored as Firestore document IDs, encode/hash safely and deterministically.

Never include user-controlled strings directly in a path without normalization.

## Write-path expectations

### Structured execution completion

1. source completion remains authoritative in its existing store;
2. shadow occurrence service ensures the structured source has a canonical occurrence;
3. service queries/generates provider candidates;
4. reconciliation may attach a high-confidence provider source;
5. no current Activities/history behavior changes.

### Garmin activity ingestion/update

1. Garmin normalized activity write remains unchanged as source truth;
2. shadow occurrence service ensures provider source has a canonical occurrence;
3. service queries/generates structured candidates;
4. reconciliation may attach a high-confidence structured source;
5. current Activities/history reads remain unchanged.

### Repeated source event

The same event must converge to the same state with no new occurrence or duplicate source link.

## Transaction boundary

At minimum, operations that claim a source identity and attach it to a canonical occurrence must be atomic from the perspective of competing workers.

A valid implementation should be able to demonstrate with tests that:

- two concurrent Garmin callbacks for the same activity do not create two live occurrence links;
- Garmin completion and Adaptive completion racing do not leave the same source linked twice;
- retry after partial failure converges safely.

## Shadow-mode output

Shadow mode should emit enough data to answer:

- how many sources received canonical identities;
- how many structured/Garmin pairs were auto-matched;
- how many candidate sets were ambiguous;
- how many sources had competing candidates;
- how many source-link conflicts occurred;
- which exact features and versions caused a match;
- how many currently visible Garmin rows would collapse into one canonical occurrence;
- how many Adaptive-only completed executions would become newly visible after future Activities cutover.

## Required representative tests

- structured first, Garmin later;
- Garmin first, structured later;
- same pair retried repeatedly;
- concurrent same-source writes;
- same-day two strength sessions;
- duration-similar but non-overlapping sessions;
- crossing-midnight session;
- modality mismatch;
- Garmin empty `exerciseSets`;
- Garmin detail unavailable;
- manual unlink state present during replay;
- merged/tombstoned occurrence hidden from live query;
- cross-user source cannot be linked.

## PR 1 exit criteria

PR 1 is complete when:

- canonical writes are safe and idempotent;
- source uniqueness is enforced;
- high-confidence reconciliation is versioned/auditable;
- ambiguous pairs remain separate;
- rebuild is possible;
- security rules/indexes/tests exist;
- shadow metrics are emitted;
- no user-facing Activities behavior changed;
- no completed-training/coach behavior changed.

Only after this foundation produces trustworthy shadow data should PR 2 switch the Activities read model.
