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

### Not yet applied (follow-up)

* Collections whose writes are not validated in TypeScript today: `session_responses`,
  `performedTrainingOccurrences` / `performedOccurrenceSourceLinks`, session occurrences,
  session-execution diary entries, strength sessions, activity overrides, the Garmin workout
  queue, `competition_outcomes`. Each needs a write-side validator first.
* The `01`-`04` module trims.
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

List readers such as `listTrialsForAttempt`, `getLatestForDate` and `listRevisionsForObservation`
throw on the first invalid document. A tampered document in an append-only collection can make
that date, attempt or observation unreadable, so readers should skip and report, following the
`...WithDiagnostics` pattern. This, the write-side validators for the collections that could
not be trimmed yet, and the 01–04 trims are tracked in #1202.

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
