# ADR-0053: Firestore Rules Scope

* **Status:** Accepted (2026-10-29)
* **Date:** 2026-10-29
* **Deciders:** Repository owner
* **Related:** ADR-0002, ADR-0010, ADR-0023, ADR-0052; issues #895, #897, #1201; PR #1200

## Context and Problem Statement

On 2026-10-29 the production deploy of `7dc84984` failed at the `cloud.firestore` release
bind: "Total size of compiled executables must be smaller than 256000 bytes (actual:
256881)". Ruleset creation does not enforce this limit; the release bind does.

PR #1200 brought the ruleset to 240,329 compiled bytes by factoring helpers. Compiled size is
roughly 1.95x the minified source, and string literals count about 1:1, so further headroom
cannot come from micro-optimisation.

The underlying problem is scope. The rules had become a second implementation of the domain
model: 158 functions, about 100 cross-document reads, and nested value validation that
duplicates the TypeScript validators. The same duplication consumes the 1000-expression
evaluation budget: the `recommendationAuditBudget` F-maximal S3 headroom sits exactly at its
40-term threshold.

[ADR-0010](./0010-decision-provenance-and-audit-replay.md)'s 2026-10-01 implementation
amendment (Firestore validation budget) already states the principle for recommendations:
`validateRecommendation` owns shape and semantic range, and the rules cover authorization,
bounded storage, write lifecycle and cross-document integrity, so shape checks duplicated by
the validator may be dropped. This ADR generalises that principle to the whole ruleset. It
does not edit ADR-0010.

## Decision Outcome

Firestore rules enforce exactly four things.

* **(A) Access and user scoping** (I1, ADR-0002).
* **(I) Immutability and append-only lifecycle:** immutable identity and `createdAt`, no
  deletes where history must hold, allowed state transitions.
* **(B) Bounds:** key allow-lists (`hasOnly` / `hasAll`) and caps on string, list and map
  sizes.
* **(X) Cross-document integrity**, only where the corruption could not be repaired
  afterwards: revision-chain heads, correction and supersession races, binding to immutable
  referenced documents, concurrency locks.

**(D) Nested domain-value validation** (enums, ranges, regexes, registry membership,
cross-field semantics) belongs in the shared TypeScript validators.

### Precondition for moving a check out of the rules

A TypeScript validator enforcing the same check runs on the client write path before the
write, and a unit test covers it. Without that, the check stays in the rules until a
write-side validator exists. Refinements:

* A check that a kept (X) integrity check depends on stays.
* A check over the merged document stays when the client writes with `merge: true`, because the
  TypeScript validator sees only the payload.
* Binding to an immutable referenced document is (X) even if TypeScript also validates it.

When a check moves, the emulator test that asserted its rejection
is converted to assert acceptance at the rules boundary and names the TypeScript owner.

### Guardrails

* `app/rules/*.rules` is the source. `npm run rules:build` generates `app/firestore.rules` and
  prints a per-module minified-size table, which gives exact attribution.
* The budget constant in `build-firestore-rules.mjs` (`MAX_MINIFIED_RULES_BYTES`) fails
  `rules:check-sync` and `npm run check` early, before a deploy can hit the release-bind limit.
* Helper calls cost evaluation-budget steps, so the `06-recommendations` path stays inline.

### Applied in #1201

* `08-outcomes-trials`: the fixed-load trial method/provenance cluster; protocol value checks
  except `burden`; metric-observation value and registry checks (`outcomeMetricUnits` and
  `comparisonDimensionIds` removed); fixed-load observation method/evidence checks (the binding core is kept; see below); assessment-attempt enums and state/timestamp shape
  (owner `assertValidAssessmentAttempt`, called on the write path in
  `AssessmentAttemptService`); outcome-evaluation date/status/`sourceRef` enums; trial
  validity residue; `createdAt`/`updatedAt` shape on observation heads, observation revisions
  and outcome-evaluation revisions (outcome-evaluation heads keep theirs: no write-side
  validator runs on the head).
* `07-health-anomalies`: the check-in health-context validators, replaced by
  `hasBoundedHealthContext` key allow-lists and caps, including the hunger range, the
  nutrition-adherence enum and the other check-in value checks (the merged hunger/hungerTiming
  pairing and the required illness answer are kept, since a merged write cannot be validated
  from the payload); health-anomaly revision and
  threshold-policy value checks (upper bounds kept), including the top-level `revisionId`
  format, `computedAt`, `mode` and `schemaVersion`; identity-review label pairing.
* Kept on purpose because TypeScript does not enforce them on write: the `contentHash` regex,
  familiarization type and upper bound, threshold upper bounds, health-anomaly source date
  validity, and `burden`.
* Kept on purpose for other reasons:
  * the fixed-load binding core in `hasFixedLoadObservationBinding` (`isFixedLoadProtocol`, valid
    trial, value equal to the trial's `mean_concentric_velocity_mps`, `sameFixedLoadContext` with
    the trial and the previous revision): binding to an immutable referenced document;
  * trial-correction `context`/`device` equality with the predecessor: correction integrity;
  * trial `ordinal` positivity: no TypeScript bound at the rules boundary;
  * the outcome-evaluation `sourceRef.kind` enum: load-bearing for the event binding;
  * the attempt `completedAt`/`startedAt` coupling to state: load-bearing for the kept state
    transitions;
  * the check-in hunger/hungerTiming pairing and required illness answer: merge semantics;
  * the identity-review `label` / `occupancyAttestation` enums: load-bearing for the kept
    label pairing;
  * the `expectedRecoveryHours` <= 336 bound: no TS bound;
  * the `persistenceDays` / `episodeDay` <= 365 bounds: no TS bound;
  * the `respirationElevation` size cap: bounded storage, no TS bound.

### Applied in #1202 (`01`-`04` module trims)

* `01-users-core`:
  * decision journal: the verdict enums, the `sawEngineVerdictFirst` type and `schemaVersion`
    (owner `validateDecisionJournalEntry`, called in `DecisionJournalService` `write`; the
    write merges, but its payload is the whole validated entry with absent optional keys
    deleted, so the merged document is the payload);
  * fixed activities: `date`, `durationMin`, the `fixed`/`isCompleted` flags, both environment
    enums, `startTime`, the stimulus/cost axis values and `availabilityOverride` (owner
    `validateFixedActivity`, called in `FixedActivityService` `createActivity` and
    `updateActivity`; every moved check is per field, and nested maps merge key by key). The
    shared `hasValidAxisValue` helper is removed and `hasValidExpectedCost` bounds keys only;
  * training-intent profile: `planningMode`, the `weeklyCommitment` counts and ordering,
    `organizationPreference`, `schemaVersion`, and the capability enum, uniqueness, `enabled`
    type and enabled-needs-a-capability rule (owner `validateTrainingIntentProfile`, called in
    `TrainingIntentProfileService` `upsert`; the validator requires every key of each nested
    map, so a merge replaces each map whole).
* `02-schedule-windows`: the per-window positive duration, environment enum, `revision` and
  timestamps (owner `validateScheduleWindow` through `validateScheduleWindowManifest`, called in
  `ScheduleWindowService` `buildManifest` before every whole-manifest write).
  `hasValidScheduleWindowManifest` and `hasValidSmallScheduleWindowManifest` are merged into
  one validator that takes the three-position or eight-position entry path by list size; the
  merge itself does not change the accepted/rejected sets.
* `03-external-plans`:
  * rest directives: the week range, the weekday enum and the required `week`/`day` (owner
    `validateRestDays`, run by `validateExternalPlanImport` in `ExternalPlanService` `import`);
  * plan blocks: `phase`, the dates and their order, the scales and the `eventId` type (owner
    `validateAuthoredPlanBlock`, called in `PlanBlockService` `create` and `update`; `update`
    merges, but the payload always carries both dates);
  * schedule overlays: `category`, `sport`, the dates and their order, the availability-minutes
    range and whole minutes, the scales, the `expectedCost` axis values and `environment`
    (owners `validateScheduleOverlay` and `assertWholeMinuteAvailability`, both called in
    `ScheduleOverlayService` `create` and `update`, which replace the whole document).
* `04-session-occurrences`: the session-definition revision `schemaVersion`, `intent` enum and
  `blocks` list type (owner `validateSessionDefinition`, called in `SessionDefinitionService`
  `saveDefinitionRevision` before the create-only revision write).
* Kept on purpose:
  * ownership, the path and date-document bindings (journal date, manifest date, window
    `userId`/`date`, session-definition `id`/`revision`), every key allow-list, and every size
    cap (notes, titles, labels, equipment lists and items, catalog ids, priorities,
    capabilities, rest-directive ids, the `restDays` and `windows` list bounds);
  * the schedule-window `HH:mm` patterns, distinct ids and overlap check: the overlap check
    compares times as strings, which is time order only for that fixed format. It does not
    need a positive duration per window;
  * `createdAt`/`updatedAt` shape on the top-level documents, beside the `keepsCreatedAt`
    immutability check. For fixed activities it has no TypeScript owner either:
    `validateFixedActivity` passes a stored `createdAt` through without checking its type;
  * the session-definition revision `contentHash` (computed by the service, not validated) and
    the `companionSessions` list type (no TypeScript check);
  * the decision-journal morning-field immutability and every other (I) check.
* Removing the enum and range checks also removed the implicit type and size bound they put on
  scalar fields such as `externalVerdict`, `environment`, `phase`, `intent`, `planningMode`,
  the stimulus/cost axis values, the `capabilities` items and `blocks`. That is accepted: only
  the owner can write their own documents, the key allow-lists are kept, and the 1 MiB
  document limit still applies. This differs from #1201, where `hasBoundedHealthContext`
  added explicit caps in place of the removed value checks.

### Not yet applied (follow-up)

* Collections whose writes are not validated in TypeScript today: `session_responses`,
  `performedTrainingOccurrences` / `performedOccurrenceSourceLinks`, session occurrences,
  session-execution diary entries, strength sessions, activity overrides, the Garmin workout
  queue, `competition_outcomes`. Each needs a write-side validator first.
* `06-recommendations` is read-only at ADR-0052 Phase 3, so it is not trimmed separately.

## Consequences

* Rules no longer reject a well-shaped but semantically wrong value written by a buggy client
  in the affected collections. The TypeScript validator on write and the parser on read are
  the defence.
* Key allow-lists and caps still bound storage.
* Compiled size and evaluation budget are recovered, and the size table makes future growth
  visible per module.
* Compiled headroom after #1201 is measured at around 15% (the exact figure goes in the PR).
  `MAX_MINIFIED_RULES_BYTES` is a guard about 10% below the limit, not the 15% target, so later
  features may consume headroom down to the guard.
* Every future rules change must say which of A/I/B/X it serves; anything else is a validator
  concern.

## Follow-up

The write-side validators for the collections that could not be trimmed yet are tracked in
#1202, which also applied the 01–04 trims.

List readers such as `listTrialsForAttempt`, `getLatestForDate` and `listRevisionsForObservation`
threw on the first invalid document, so a tampered document in an append-only collection made
that date, attempt or observation unreadable. Under #1202 the owner-facing views (the assessment
attempt detail and the health-anomaly shadow panel) use `...WithDiagnostics` readers that skip
and count unreadable records. They never present an older record as current in its place.

The paths that derive evidence or chain state from the full set keep the throwing readers on
purpose, because dropping a record there would silently change the result:
* assessment capture and correction (`assessmentCaptureService`);
* the `TestingWorkflow` trial refresh that feeds a resubmission;
* the versioned assessment diagnostic export (`assessmentExportService`);
* the health-anomaly episode chain (`HealthAnomalyService`) and its follow-up lookup.

A single tampered record therefore still blocks the export and further capture or correction of
that attempt. That is an accepted limit, not an open defect. Lifting it for the export would
need per-attempt diagnostics in a new export schema version.

## Alternatives Considered

**Server-side writes via Functions or the backend.** Rejected: it would break offline capture
(#897, #895).

**A second Firestore database.** Rejected: splitting the data model costs more than it saves.

**Minifier micro-optimisations.** Rejected as the primary lever: they recover about 2 KB.

## References

* [ADR-0010](./0010-decision-provenance-and-audit-replay.md) 2026-10-01 amendment (Firestore
  validation budget).
* [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md) Phase 3.
* [Firestore Security Rules Modularization & Budget Refactoring](../plans/2026-10-08-firestore-rules-modularization-and-budget-refactor.md)
  (the plan that introduced `app/rules/*.rules` and the build tooling this ADR relies on).
* [`docs/ops/firestore-rules-deployment.md`](../ops/firestore-rules-deployment.md) for the
  build, drift check and rollback.
* Source modules `app/rules/*.rules`; generator `app/scripts/build-firestore-rules.mjs`.
* [`docs/architecture/performance-outcome-evidence.md`](../architecture/performance-outcome-evidence.md)
  for the resulting rules/validator split on outcome evidence.
