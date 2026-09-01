# ADR-0034: Canonical performed training occurrence and multisource reconciliation

* **Status:** Proposed
* **Date:** 2026-09-01
* **Deciders:** Core Engineering Team

---

## Context

The repository currently models several different concepts that can all be informally called an "occurrence":

- `SessionOccurrence` is an authority/scheduling record that says what session was scheduled, replaced, added, or otherwise placed on a day;
- `SessionExecution` is the athlete's execution of a structured session;
- a normalized Garmin activity is a provider record describing a recorded activity;
- `occurrenceReconciliation.ts` can identify some execution/activity pairs that are evidence for the same physical workout.

These concepts have different lifecycles and must remain distinct.

A scheduled `SessionOccurrence` can be missed or abandoned and therefore never become a performed workout. A Garmin-only activity can be a real performed workout without any `SessionOccurrence`. An unplanned structured execution can also be real without an authority-bearing scheduled occurrence.

The product therefore needs a provider-neutral representation of **one physical workout actually performed**, while preserving the existing planning/authority model.

This ADR complements:

- ADR-0002 user-scoped Firestore isolation;
- ADR-0003 timezone semantics;
- ADR-0005 raw archive/rebuild principles;
- ADR-0010 decision provenance/audit replay;
- ADR-0023 multidomain session authoring/execution/evidence;
- ADR-0026 wearable telemetry enrichment boundaries;
- ADR-0031 activity HR measurement fidelity/evidence authority.

The detailed analysis and phased implementation plan live in:

- `docs/analysis/structured-strength-garmin-activity-reconciliation-analysis.md`;
- `docs/plans/training-occurrence-reconciliation-and-strength-session-unification.md`.

## Decision

Introduce a canonical **performed-training occurrence** concept representing one physical workout actually performed by an athlete.

The conceptual name in product documentation may remain `TrainingOccurrence`, but implementation must make its distinction from the existing `SessionOccurrence` unmistakable. A code-level name such as `PerformedTrainingOccurrence` or `CompletedTrainingOccurrence` is preferred unless the team explicitly documents another naming convention.

Do **not** reuse `SessionOccurrence` as this projection. `SessionOccurrence` remains the planning/authority record.

The fundamental invariant is:

```text
one physical workout
    -> one performed-training occurrence
        -> zero or one structured execution source initially
        -> zero or more wearable/provider activity sources
        -> one public completed-workout identity
```

The canonical record is a projection/linkage object. It does not destructively merge or replace raw sources.

## Source roles and authority

A source contributes facts in a role, not blanket authority over the whole occurrence.

### Structured execution

For a matched structured workout, Adaptive owns semantic/mechanical execution facts:

- prescribed workout identity and structure;
- exercise identity/order;
- warm-up/work-set role;
- planned sets/reps/load/rest;
- actual completed sets;
- actual reps/load;
- choice/skip/modification events;
- planned-versus-performed comparison;
- actual rest once explicitly persisted.

### Wearable/provider activity

Garmin owns measured device facts:

- HR samples and derived HR summaries;
- timer/elapsed duration when measured by the device;
- device/sensor provenance;
- provider-native Training Effect/load/EPOC/recovery/calories as supplemental provider metrics.

Garmin exercise recognition, reps, weight, and rest metadata are fallback/diagnostic evidence when a structured execution exists. They may be primary only when no higher-semantic structured execution exists.

### Field-level provenance

Every field copied or derived into a canonical read model must either have obvious deterministic provenance from its source role or carry explicit provenance metadata.

Do not create a flattened record in which a caller cannot distinguish:

- source-measured values;
- athlete-entered values;
- provider-derived values;
- application-derived values.

## Model the source set, not one Garmin slot

The storage model must not permanently assume one Garmin activity is the only wearable source.

Real workouts can have multiple recordings, for example:

- watch + cycling computer;
- watch + duplicated provider import;
- Garmin + another provider in the future;
- a structured execution plus multiple wearable activities.

The v1 UI may expose only one primary Garmin activity, but the canonical domain should support a source collection such as:

```ts
type PerformedOccurrenceSourceRef =
  | {
      kind: 'structured_execution';
      executionId: string;
      sessionOccurrenceId?: string;
      prescriptionHash?: string;
    }
  | {
      kind: 'provider_activity';
      provider: 'garmin' | string;
      activityId: string;
      deviceId?: string;
    };
```

A source must belong to at most one live performed occurrence.

## Identity and merge semantics

### Stable canonical identity

A performed occurrence needs its own stable ID. Do not overload:

- Garmin `activityId`;
- `SessionExecution.executionId`;
- `SessionOccurrence.occurrenceId`.

Those are source/planning identities, not the canonical physical-workout identity.

### Source-link uniqueness

Persist or otherwise enforce a unique mapping from each source identity to one canonical occurrence. An implementation may use transactional source-link documents, deterministic lookup keys, or an equivalent mechanism.

The invariant is:

```text
(source kind, provider?, source id) -> exactly zero or one live canonical occurrence
```

This is required to make repeated sync and concurrent source arrival idempotent.

### Concurrent arrival

Adaptive completion and Garmin sync may race. Reconciliation writes must therefore be transactional or use compare-and-set semantics so two workers cannot create two durable canonical occurrences for the same source pair.

If two canonical records already exist when a later reconciliation discovers they are the same workout:

1. choose one survivor deterministically;
2. move/attach source links atomically where possible;
3. mark the loser as merged/tombstoned with `mergedIntoOccurrenceId` rather than silently deleting it;
4. ensure public queries hide tombstones;
5. retain enough provenance for audit/rebuild.

### Link stability

Routine provider refreshes must not continuously reconsider already-linked pairs merely because duration/title/provider metadata changed slightly.

- manual confirms are sticky;
- manual unlinks are sticky;
- established automatic links remain stable during normal sync;
- rematching an established automatic link requires an explicit matcher-version migration/reconciliation job, with audit output.

## Reconciliation evidence contract

The current repository matcher is conservative plumbing and is not yet a sufficient production identity service by itself. Productionization must separate **candidate generation**, **scoring**, and **link policy**.

Recommended evidence order:

1. explicit correlation identity / exported-workout identity;
2. prescription hash or FIT structured-workout fingerprint where recoverable;
3. exact/strong temporal overlap plus compatible modality;
4. duration similarity;
5. exercise/set structural similarity for strength where available;
6. local-calendar date and title as supporting, not primary, evidence.

A date-only match is never sufficient for automatic merge.

Two plausible competing candidates must reduce confidence materially. A high pairwise score is not enough if the match is not unique.

Persist for every auto-link:

- matcher version;
- candidate feature values used;
- final score/confidence;
- selected policy threshold/version;
- link timestamp.

This is necessary for replay and post-deployment debugging.

## Time semantics

Matching must use absolute timestamps for proximity and overlap. Local date is a secondary grouping/search aid only.

This is required for:

- workouts crossing midnight;
- travel/timezone changes;
- DST boundaries;
- provider timestamps expressed in different zones;
- delayed provider synchronization.

The canonical projection should retain both normalized instants and the display/local-day semantics required elsewhere by the application rather than deriving identity from date strings alone.

## Projection size and telemetry storage

Do not copy the full HR time series into the canonical Firestore occurrence merely to produce a unified Activity Details page.

The canonical document should contain lightweight fields needed for listing, identity, reconciliation, and common summaries. High-volume telemetry should remain in its established source representation or a dedicated telemetry store and be referenced/lazily loaded.

Recommended split:

```text
performed occurrence
  - identity
  - source refs
  - display summary
  - reconciliation provenance
  - lightweight physiological summaries

raw/detailed source telemetry
  - HR samples
  - detailed provider payload/FIT-derived data
  - diagnostic provider-specific fields
```

Benefits:

- avoids duplicated high-volume data;
- reduces projection rebuild cost;
- preserves raw-source provenance;
- avoids Firestore document growth becoming a hidden constraint;
- permits provider telemetry to evolve independently of canonical identity.

## Source mutation, deletion, and disconnect semantics

Source lifecycle must be explicit.

### Provider activity changes

If Garmin later changes title, duration, sets, or physiological summaries, refresh the provider-derived fields/reference without changing Adaptive-authoritative mechanical semantics or silently rematching the occurrence.

### Provider activity deleted/unavailable

Do not delete a matched occurrence merely because its Garmin activity disappears or provider access is revoked.

Instead:

- mark the provider source unavailable/deleted/revoked as appropriate;
- retain the structured execution and completed-workout identity;
- omit unavailable telemetry from the public view;
- retain audit metadata consistent with repository retention/privacy policy.

### Structured execution removed/invalidated

If a structured execution is explicitly deleted, invalidated, or corrected, rebuild canonical structured fields from remaining valid sources. A remaining Garmin activity may keep the physical occurrence alive as Garmin-only evidence.

A source disappearing must not accidentally resurrect a previously rejected source pairing.

## Manual reconciliation UX

Ambiguity needs a user/admin escape hatch even if the first implementation keeps it behind diagnostics.

Required operations:

- link two sources;
- unlink a source from an occurrence;
- keep two same-day workouts separate;
- inspect why the matcher linked or did not link them.

Manual decisions should capture:

- actor;
- timestamp;
- previous state;
- resulting state;
- optional reason;
- matcher version/score visible at the time.

The normal athlete UI should not require routine manual cleanup. Manual operations exist for ambiguity and recovery, not as the primary reconciliation mechanism.

## Read-path migration and rollback

The canonical occurrence must be introduced without a flag-day switch.

Recommended rollout:

### Stage 0 — build-only

- create schema/repository and tests;
- no user-visible reads;
- no coach/history consumption.

### Stage 1 — shadow reconciliation

- build occurrences in parallel with current Garmin/structured paths;
- record what would have matched;
- compare against known/reviewed examples;
- do not change Activities or training evidence.

### Stage 2 — dual-read diagnostics

- construct the new completed-workout DTO in parallel;
- compare row counts, duplicates, source coverage, and field provenance against current Activities;
- keep current UI authoritative.

### Stage 3 — Activities cutover

- switch Activities to canonical occurrences behind a feature flag or reversible configuration;
- retain source-specific read path temporarily for rollback/debugging.

### Stage 4 — history/coach shadow mode

- calculate completed-training history using canonical occurrences in parallel;
- diff dose, evidence tier, load, and recommendation outcomes;
- do not activate recommendation behavior until regression policy passes.

### Stage 5 — engine activation

- make canonical occurrences authoritative for completed-training history only after duplicate-rate and recommendation regressions are acceptable.

Rollback must be possible by disabling the canonical read/engine consumer without deleting canonical data.

## Rollout gates

Before moving from shadow reconciliation to Activities cutover, require at minimum:

- zero known cases where one source is attached to two live canonical occurrences;
- zero known manual-unlink violations;
- repeated Garmin sync creates no additional occurrences;
- representative structured-strength + Garmin workout merges correctly;
- two same-day workouts remain distinct;
- ambiguous matches stay unmerged;
- Adaptive-only workouts appear correctly in the canonical read model;
- Garmin-only workouts preserve current useful details;
- source deletion/revocation does not destroy unrelated valid execution data.

Before engine activation, additionally require:

- one physical workout contributes one exposure;
- no regression from `completedStructuredWorkout` to a weaker Garmin-derived evidence tier for matched structured sessions;
- recommendation/load diffs are reviewed with explicit tolerances;
- historical backfill is idempotent;
- matcher version and evidence are auditable for every automatic historical link.

## Firestore, security, and indexing requirements

Canonical records must follow ADR-0002 and remain under the user hierarchy, for example:

```text
users/{uid}/performedTrainingOccurrences/{performedOccurrenceId}
```

Exact naming may differ, but implementation must include:

- user-scoped security rules;
- emulator/rules tests for cross-user denial;
- indexes required by Activities date/range queries;
- indexes or source-link lookup strategy required by reconciliation;
- no client-trusted `userId` capable of linking another user's source;
- schema-version handling for old/new clients during rollout.

Do not ship a new user-scoped collection without its rules/index story in the same implementation phase.

## Rebuild and repair

The canonical collection is derived/reconstructable state.

Provide a deterministic rebuild path from valid source records and manual decisions. Rebuild must preserve sticky manual link/unlink directives and should be able to target:

- one occurrence;
- one user/date range;
- a matcher version migration;
- full historical backfill.

A repair job should be safe to retry.

## Observability additions

In addition to the metrics in the implementation plan, record:

```text
training_occurrence.source_link_conflict
training_occurrence.merge_tombstone_created
training_occurrence.projection_rebuild
training_occurrence.provider_source_detached
training_occurrence.manual_override_preserved

reconciliation.candidates_per_source
reconciliation.high_confidence_unlinked
reconciliation.competing_candidates
reconciliation.matcher_version
reconciliation.score_distribution

activity_read.shadow.row_count_delta
activity_read.shadow.duplicate_delta
history_shadow.exposure_count_delta
history_shadow.evidence_tier_delta
```

Dashboards should make it possible to answer:

- Are duplicates decreasing?
- Are false-positive merge signals appearing?
- Which matcher version produced a link?
- Are structured workouts gaining Garmin telemetry without losing Adaptive semantics?
- Does the engine see fewer/more completed exposures after canonicalization?

## Failure-mode matrix

| Failure | Required behavior |
| --- | --- |
| Garmin sync delayed | keep Adaptive-only occurrence; enrich later |
| Adaptive completion delayed | keep provider-only occurrence; reconcile later |
| Garmin detail API fails | retain occurrence and structured execution; telemetry/detail marked unavailable |
| Garmin returns empty strength sets | do not erase Adaptive performed sets |
| Concurrent source arrival | one canonical occurrence after transactional/idempotent reconciliation |
| Two same-day same-modality workouts | require stronger evidence; ambiguous stays separate |
| Provider metadata changes | refresh provider fields; do not routine-rematch stable link |
| Provider activity deleted | detach/mark unavailable; retain remaining occurrence evidence |
| Manual unlink followed by sync | remain unlinked |
| Matcher version changes | no silent mass rematch; explicit migration/replay only |
| Projection corrupt/missing | rebuild from raw sources + manual decisions |
| Canonical UI causes regression | disable cutover flag; source records remain intact |

## Rejected alternatives

### Make Garmin activity the completed-workout object

Rejected because it makes provider identity the domain identity, hides structured execution authority, and does not generalize to multiple providers.

### Copy Adaptive sets into Garmin activity documents

Rejected because it destroys clear provenance and couples source ingestion to product projection semantics.

### Reuse `SessionOccurrence`

Rejected because planning authority and performed physical identity have different lifecycles. Garmin-only/unplanned workouts prove the concepts are not equivalent.

### Match only on date + duration

Rejected as a final production policy because same-day workouts and duration coincidence can create false-positive merges. The current matcher is useful plumbing/candidate logic, not sufficient evidence policy for all cases.

### Recompute reconciliation independently in every consumer

Rejected because Activities, history, and coach logic could disagree about whether two records are one workout.

## Consequences

### Positive

- one stable completed-workout identity across UI and engine;
- no double counting of matched structured + Garmin sessions;
- explicit source authority and provenance;
- support for multiple wearable/provider sources;
- safe asynchronous source arrival;
- reversible rollout;
- auditable matcher decisions;
- provider detail can evolve without changing workout identity;
- architecture generalizes beyond strength.

### Costs

- new derived collection/source-link index and reconciliation lifecycle;
- merge/tombstone/rebuild logic;
- shadow-mode instrumentation before cutover;
- migration and rules/index maintenance;
- explicit manual-reconciliation state;
- higher implementation complexity than a UI-only merge.

The additional complexity is intentional because reconciliation changes identity and completed-training evidence, not merely presentation.

## Implementation requirement

PR 1 from the companion implementation plan must resolve the exact code type/collection naming and source-link uniqueness mechanism before production writes are enabled. It must also include shadow-mode instrumentation and security/index changes. Engine/history behavior remains explicitly out of scope until later rollout gates pass.
