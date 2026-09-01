# Training occurrence implementation open questions

Status: pre-implementation decisions

These are deliberately narrow questions that should be resolved in PR 1 or explicitly deferred with rationale. They are not blockers to merging the documentation PR, but leaving them implicit in code would create unnecessary migration risk.

## 1. Code-level naming

The repository already has `SessionOccurrence`. Decide whether the performed physical-workout record is named:

- `PerformedTrainingOccurrence` (recommended for clarity),
- `CompletedTrainingOccurrence`, or
- another explicit name.

Avoid a name that causes callers to confuse planning authority with performed identity.

## 2. Canonical ID generation

Choose one stable canonical-ID strategy that does not depend on source arrival order.

Requirements:

- source IDs remain source IDs;
- the canonical ID survives later enrichment;
- if two provisional canonical records must be merged, aliases/tombstones make stale references recoverable;
- rebuild is deterministic enough to preserve externally referenced IDs where required.

## 3. Source-link uniqueness mechanism

Choose how to enforce:

```text
one source -> at most one live canonical occurrence
```

Candidate implementations include:

- transactionally maintained source-link documents keyed by normalized source identity;
- another transactional uniqueness/index mechanism.

A best-effort query-before-write check is not sufficient under concurrent arrival.

## 4. Materialized vs referenced fields

Define which data is copied into the canonical projection.

Recommended materialized fields:

- identity;
- timestamps/date used for listing;
- modality;
- display title;
- source badges/refs;
- reconciliation state;
- lightweight HR/duration/provider summaries needed on common screens.

Recommended referenced/lazy-loaded fields:

- full HR sample series;
- raw FIT/provider payloads;
- large per-provider diagnostic structures.

## 5. Matcher policy representation

Decide whether thresholds live in:

- code constants;
- a versioned policy object;
- configuration.

Whichever is chosen, persisted auto-match provenance must identify the effective version and thresholds/policy.

## 6. Auto-link stability

Confirm whether an automatically linked pair becomes sticky after creation.

Recommended rule:

- normal sync may refresh source data but does not rematch;
- explicit repair/matcher-version migration may reconsider auto-links;
- manual link/unlink always outranks automated rematching.

## 7. Ambiguity representation

Decide whether `ambiguous` is:

- a canonical occurrence state containing candidate refs, or
- reconciliation metadata external to otherwise separate single-source occurrences.

Prefer a design where two genuinely separate source records remain visible and are not prematurely collapsed simply because they share an ambiguity record.

## 8. Multiple provider recordings

Decide how v1 handles:

- watch + Edge recording of the same ride;
- duplicate Garmin activities;
- future second provider.

The v1 UI can select one primary telemetry source, but the domain should not require a destructive migration to add a second source later.

## 9. Primary telemetry selection

If multiple provider activities are attached, define deterministic preference for the telemetry rendered by default.

Possible evidence includes:

- measurement source trust/fidelity;
- richer HR sample coverage;
- external sensor provenance;
- device role;
- completeness.

Do not silently combine incompatible HR streams sample-by-sample without a separate reconciliation policy.

## 10. Deletion semantics

Define the difference between:

- source temporarily unavailable;
- provider access revoked;
- source deleted upstream;
- source explicitly deleted by the athlete;
- source invalidated as bad attribution/data.

These states may have different retention and rebuild consequences.

## 11. Manual-link permissions

Decide which actors may link/unlink:

- athlete client;
- admin/support tooling;
- backend repair job.

All paths must remain user-scoped and auditable.

## 12. Feature flags / rollout configuration

Identify the concrete switches for:

- occurrence writes;
- shadow reconciliation;
- canonical Activities reads;
- canonical history shadow calculation;
- canonical engine activation.

Avoid one global flag that couples UI and engine rollout.

## 13. Historical backfill window

Decide how far back to reconcile initially.

A bounded first window may be safer for validating matcher precision before full-history backfill. Whatever window is selected, the job must be restartable and versioned.

## 14. Rebuild authority

Define exactly which source classes and manual decisions are required to rebuild the canonical projection.

A canonical document should never contain the only copy of a fact required to reconstruct itself, except its own generated identity/merge lineage where unavoidable.

## 15. Engine activation tolerances

Before PR 4 activation, define numeric/explicit acceptable deltas for shadow comparison, at least for:

- completed exposure count;
- evidence-tier changes;
- load/dose changes;
- recommendation changes.

"Looks reasonable" is not a sufficient rollout criterion for a change that can alter future training recommendations.
