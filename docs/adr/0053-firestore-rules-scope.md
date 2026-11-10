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

### Applied in #1202 (item 1, PR A: write-side validators)

* Garmin workout queue (`01-users-core`): the `status` enum, the `queuedAt`, `syncedAt` and
  `garminWorkoutId` types and the `payload` map type (owner `validateQueuedWorkoutWrite` in
  `contracts/workoutExportContract.ts`, called in `GarminWorkoutQueueService` `queueWorkout`
  before its whole-document `setDoc`; the Python sync writes back with the Admin SDK, outside
  the rules). The write validator is deliberately narrower than `validateQueuedWorkoutContract`:
  that contract also requires a non-empty title and the full `CanonicalWorkoutExport` payload,
  which would reject payloads the app queues today, such as the fallback export with no blocks.
* `session_responses` (`08-outcomes-trials`): the `sourceSession` kind, id and date values, the
  `window` enum, the response and check-in dates, the window/date ordering, and the
  `sessionRpe`, `completedFraction` and `unexpectedFatigue` values (owners
  `validateSessionResponse` through `assertValidSessionResponse`, called in
  `SessionResponseService` `recordResponse` and `recordOrUpdateResponse` before the create, and
  `validateSessionResponseFacts` through `assertValidSessionResponseFacts`, called before every
  partial fact update in `updateResponseFacts` and `recordOrUpdateResponse`). The fact updates
  are partial, but every moved fact check is per field, and the kept update rule holds
  `sourceSession`, `window` and `date` equal to the create-validated values, so the ordering
  cannot change after create. The range checks now also reject `NaN`, which the TypeScript
  check used to let through and the rule rejected.
* Session occurrences (`04-session-occurrences`): the `date`, the `authority` enum and its
  pairing with exactly one of `definitionRef` / `externalPlanRef`, the `definitionRef` values,
  the `externalPlanRef` revision, the `windowBinding` order, local bounds and instants, the
  windowBinding-needs-externalPlanRef rule and `placementOrder` (owner
  `validateSessionOccurrence` through `assertValidSessionOccurrence`, which gained the
  `placementOrder` check it lacked). Every client writer calls it before a whole-document set,
  never a merge: `SessionOccurrenceService` `saveOccurrence`,
  `getOrCreateExternalPlanOccurrence` (new and superseded), `claimOccurrenceLaunch`,
  `releaseOccurrenceClaim` and `transitionOccurrenceState`; `sealPreparedPrimaryBinding` in
  `intradayBundleMemberAdjudication.ts`; the skip and both create paths in
  `adjudicateIntradayBundleMembers` in `intradayBundleMemberAdjudicationCore.ts` (each create
  path validates before its transaction opens); and `ManualRecommendationReplacementService`
  `replaceRecommendationOccurrence` and `transferAuthorityInTransaction`.
* Fixed in passing: the session-definition revision key allow-list
  (`hasValidSessionDefinitionRevision`) now includes `movementComposition`. It is part of the
  `SessionDefinition` schema and its content hash, and `ManualSessionBuilder` carries it over
  from a catalog base definition, so such a revision used to be denied. `validateSessionDefinition`
  owns its content.
* Kept on purpose:
  * ownership, the path and date-document bindings (queue `date`, `responseId`,
    `occurrenceId`), every key allow-list, and every size cap (queue title, modality and error;
    response notes; plan id, session id and content hash; window and bundle ids);
  * required keys that the removed value checks used to imply, now explicit: the occurrence
    `date` and `authority` and at least one of `definitionRef` / `externalPlanRef`,
    `checkinRef.date`, and every key of `definitionRef`, `externalPlanRef` and `windowBinding`
    (the other top-level occurrence and response keys were already required by kept checks);
  * the response `occurrenceId` existence check: binding to a referenced document;
  * the response `createdAt`/`updatedAt` shape: the intraday launch claim compares `updatedAt`
    to the confirmation revision it pinned; and the occurrence timestamps, as for the other
    top-level documents;
  * the occurrence `state` enum: it is the domain of the kept transition table
    (`isValidOccurrenceStateTransition`), and the strength-session and session-execution rules
    read an occurrence's `state` across documents;
  * the response provenance immutability (`sourceSession`, `occurrenceId`, `window`, `date`,
    `createdAt`), the occurrence `date`/`authority`/`createdAt` immutability and transitions,
    and the `bindsPreparedExternalOccurrence` reservation binding.
* As in the 01-04 trims, removing the value checks also removed the implicit type and size
  bound they put on fields such as `status`, `window`, `authority`, `definitionRef.definitionId`
  and the window-binding bounds. Only the owner can write these documents, the key allow-lists
  stay, and the 1 MiB document limit applies.

### Applied in #1202 (item 1, PR B: activity overrides and strength sessions)

* Activity overrides (`01-users-core`): the `date` format, the `overriddenModality` and
  `overriddenIntensity` enums, the `rpe` range and the `stimulusFocus` enum (owner
  `validateActivityOverride` through `assertValidActivityOverride` in
  `ledger/activityOverrideValidation.ts`, called in `ActivityOverrideService` `saveOverride`
  before its whole-document `setDoc`; there is no other writer). The update rule pins `date`
  to the stored value and no other rule reads this document, so the date format only mattered
  at create. The validator did not exist before; it keeps the accepted modality set (no
  `Walking` / `None`, plus `Unknown`).
* Strength sessions (`01-users-core`): the `date` and `sourceRecommendationDate` formats,
  `schemaVersion == 1`, the `completedAt` type and the `sessionRpe` range (owner
  `validateStrengthSession` through `assertValidStrengthSession` in
  `engine/strengthSessionValidation.ts`, called in `StrengthSessionService` `startSession` on
  the new document and in `transitionState` on the whole post-transition document, before the
  merge). The merge writes (`transitionState`, `saveExercises`) only touch `state`,
  `updatedAt`, `completedAt`, `sessionRpe`, `notes` and `exercises`; every other stored value
  is the create-validated one, and the update rule pins `date` and `startedAt`. `saveExercises`
  keeps its own `areValidLoggedExercises` check. The `sessionRpe` check matches the old rule,
  which already rejected `NaN`.
* The merge-write refinement does not apply to `schemaVersion` or `sourceRecommendationDate`,
  because no merge payload carries them: `transitionState` carries `state`, `updatedAt`,
  `completedAt`, `sessionRpe` and `notes` and validates the whole post-transition document, and
  `saveExercises` carries `exercises` and `updatedAt`. Both values are therefore only ever set
  by the create-validated `startSession` write, the same argument as PR A for
  `session_responses`.
* Activity overrides also gain a read-side check: `getOverride`, `getAllOverrides` and
  `getOverridesSinceState` run `validateActivityOverride` on each document and skip an invalid
  one (`getOverride` returns `null`). `getOverridesSinceState` reports each skipped document as a
  `DataIssue` on its `AVAILABLE` result; the other two log a warning, as that service already
  does. The write validator is exactly as strict as the old rule, so every document the old rules
  accepted still reads.
* Kept on purpose: ownership, the activity `activityId` and strength `sessionId` bindings, the
  key allow-lists, the string caps (`originalType`, `originalIntensityTag`, override and
  session `notes`, `sessionId`), the `createdAt`/`updatedAt`/`startedAt` shape, the override
  update immutability, and for strength sessions the `state` enum and the
  `(state == 'completed') == ('completedAt' in data)` coupling, because the update rule's
  `resource.data.state == 'in_progress'` terminal immutability depends on `state`.
* The strength-session create rule's superseded-occurrence guard reads `occurrenceId`, but the
  key allow-list does not include it and no writer sets it, so that branch is dead today. It
  is left as is: removing it is a behaviour change outside this slice.
* The previous strength-session rejection emulator cases wrote `sessionId: 'session-1'` to
  other document ids, so the `sessionId` binding rejected them regardless of the field under
  test. They now write matched documents with an accepted control.

### Not yet applied (follow-up)

* Collections whose writes are not validated in TypeScript today:
  `performedTrainingOccurrences` / `performedOccurrenceSourceLinks`, session-execution diary
  entries, `competition_outcomes`. Each needs a write-side validator first.
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
