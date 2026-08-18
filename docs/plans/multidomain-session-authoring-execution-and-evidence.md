# Multidomain session authoring, execution and evidence

* **Status:** `Draft`
* **Blocked by:** plan approval. M2–M9 additionally require the successor ADR produced by
  M0.1 to be accepted before implementation.
* **Unlocks:** executable manual/external sessions; mixed strength/speed/field/power
  tracking; occurrence-linked response; protocol-aware testing; evidence for later engine
  policy decisions.
* **Source analyses:**
  [`2026-08-18-multidomain-training-system-consolidated-analysis.md`](../analysis/2026-08-18-multidomain-training-system-consolidated-analysis.md),
  [`2026-08-18-strength-session-ui-ux-review.md`](../analysis/2026-08-18-strength-session-ui-ux-review.md),
  [`2026-08-18-authored-composite-session-import-and-execution.md`](../analysis/2026-08-18-authored-composite-session-import-and-execution.md).

> **Capability plan, not a numbered engine phase.** Work items use the `M*` prefix so they
> cannot be mistaken for Phases 0–9. The plan is intentionally broader than the existing
> `S*` Strength logging plan but does not reopen ADR-0021's evidence gate.

---

## Goal

Let an athlete build or import a structured multidomain session, schedule it with explicit
authority, safely execute it on a phone, record native performed doses/measurements, and
link immediate/delayed response to the exact occurrence. Preserve replay, user isolation,
existing engine authority and default-off evidence policy throughout.

The deliverable is incremental. A usable Strength/composite-session flow lands before
testing, vendor integrations or live engine enrichment.

---

## Preconditions and non-negotiable decisions

### Already accepted

| Decision | Consequence here |
|---|---|
| ADR-0010 replay/provenance | Definition revision, source hash and execution snapshot are replay inputs. |
| ADR-0019 D-CANDIDATE | Manual/imported selection never bypasses clinical, feasibility or readiness gates. |
| ADR-0019 D-IMMUT | Authored revisions are immutable; placement is separate. |
| ADR-0019 D-NOPARSE | Model parsing can only create a reviewable draft, never persist directly. |
| ADR-0021 D-GAUGE | Failure proximity and technical/velocity quality remain tagged instruments. |
| ADR-0021 D-SETLOG | Performed entries are raw source data; derivations are recomputable. |
| ADR-0021 D-STRCOST | New performed detail does not activate engine cost/stimulus without real-history evidence. |
| ADR-0003 date semantics | Every scheduled/start date uses Europe/Warsaw helpers, never UTC date slicing. |
| ADR-0002 user isolation | Every new document lives below `users/{uid}/...` and duplicates/checks ownership where required. |

### Decisions M0.1 must settle

The successor ADR must accept or change these proposals before M2 begins:

| ID | Proposed decision |
|---|---|
| **D-MSESSION** | `SessionDefinition` is the source-neutral executable content contract; catalog, external and manual sources adapt to it. |
| **D-MRECORDS** | Definition, occurrence, execution prescription and performed execution are distinct records/lifecycles. |
| **D-MAUTH** | A date-scoped athlete occurrence can explicitly replace/add to a recommendation; save-only and unplanned logs have no selection authority. |
| **D-MENTRY** | New performed rows are individual `session_executions/{id}/entries/{entryId}` documents; v1 Strength arrays remain read-only compatible history. |
| **D-MCOND** | Conditions use canonical/athlete-observed signals and bounded actions only; arbitrary expressions/prose never execute. |
| **D-MOBS** | Metrics retain unit, source, protocol, validity and comparison-series provenance; training and testing are distinct intents. |
| **D-MRESP** | Session responses are occurrence-linked evidence; missing follow-up is `unknown`, never a passed/default response. |
| **D-MPOLICY** | Step-derived profiles, response-based progression and domain exposure remain default-off evidence candidates until separate ship decisions. |

M0.1 must also supersede ADR-0019 D-SHIM narrowly. It must not weaken D-CANDIDATE,
D-IMMUT, D-EXTTIER or replay.

---

## Dependency graph

```text
M0 contract/ADR ───────────────┐
                               ▼
M1 current runner repair    M2 persistence/replay foundation
        │                       │
        └──────────┬────────────┘
                   ▼
             M3 author/import
                   ▼
             M4 general runner
                   ▼
             M5 response loop
                   ▼
        M6 speed/field/power execution
                   ▼
        M7 observations/testing/progress
                   ▼
          M8 engine evidence candidates
                   ▼
        M9 assisted parsing/integration seams
```

M1 can be implemented independently after this plan is approved. M2 and later are blocked
until M0.1 is accepted. M5 can begin after M2/M4 without waiting for testing. No M8 item may
ship merely because its code exists.

---

## Task board

| Item | Title | Status | Blocked by |
|---|---|:---:|---|
| M0.1 | Successor ADR and authority contract | `[ ]` | plan approval |
| M0.2 | Canonical schema examples and fixture corpus | `[ ]` | M0.1 |
| M0.3 | Dependency and compatibility contracts | `[ ]` | M0.1 |
| M1.1 | Persistent exercise navigator and resume | `[ ]` | plan approval |
| M1.2 | Performed-set correction and undo | `[ ]` | plan approval |
| M1.3 | Completion and abandonment sheets | `[ ]` | M1.2 |
| M1.4 | Mobile layout, focus and accessibility | `[ ]` | M1.1 |
| M1.5 | Today start/resume CTA and last-time context | `[ ]` | M1.1 |
| M1.6 | Strength visual, interaction and offline acceptance | `[ ]` | M1.1–M1.5 |
| M2.1 | Session definition and execution types/validators | `[ ]` | M0.2, M0.3 |
| M2.2 | Source adapters, canonical serialization and hashing | `[ ]` | M2.1 |
| M2.3 | Definition and occurrence persistence | `[ ]` | M2.1 |
| M2.4 | Execution header and entry persistence | `[ ]` | M2.1, M2.3 |
| M2.5 | Strength v1 compatibility adapter | `[ ]` | M2.4 |
| M2.6 | Recommendation persistence, immutability and replay | `[ ]` | M2.2–M2.4 |
| M3.1 | Bounded exercise/drill facet vocabulary | `[ ]` | M2.1 |
| M3.2 | Aliases and user-confirmed custom movements | `[ ]` | M3.1, M2.3 |
| M3.3 | Manual block-first session builder | `[ ]` | M2.3, M3.2 |
| M3.4 | External plan/session schema v2 adapter | `[ ]` | M2.2, M3.1 |
| M3.5 | Full semantic import preview and diff | `[ ]` | M3.4 |
| M3.6 | Save/schedule/replace/add/start intent flow | `[ ]` | M2.3, M2.6, M3.3 |
| M3.7 | Catalog-to-definition adapter and execution snapshot | `[ ]` | M2.2, M2.6 |
| M4.1 | General session-runner lifecycle | `[ ]` | M1.6, M2.4–M2.6 |
| M4.2 | Typed repetition/time/distance/check-off inputs | `[ ]` | M4.1 |
| M4.3 | Groups, alternatives and bounded condition actions | `[ ]` | M4.2, M3.5 |
| M4.4 | Companion occurrence and duplicate reconciliation | `[ ]` | M4.1, M3.6 |
| M4.5 | General completion summary and performed comparison | `[ ]` | M4.2–M4.4 |
| M5.1 | Response observation/link schema and persistence | `[ ]` | M2.3, M2.4 |
| M5.2 | Immediate post-session response | `[ ]` | M4.5, M5.1 |
| M5.3 | Later-day and next-morning follow-up | `[ ]` | M5.1, M5.2 |
| M5.4 | Outcome/override evidence views | `[ ]` | M5.3 |
| M6.1 | Representative speed/field/power taxonomy v1 | `[ ]` | M3.1, M4.2 |
| M6.2 | Sprint and field performed-entry cards | `[ ]` | M6.1, M4.2 |
| M6.3 | Jump/throw/contact performed-entry cards | `[ ]` | M6.1, M4.2 |
| M6.4 | Domain exposure read models | `[ ]` | M5.4, M6.2, M6.3 |
| M7.1 | Metric registry, protocols and comparable series | `[ ]` | M2.1, M6.1 |
| M7.2 | Metric observation persistence and adapters | `[ ]` | M7.1, M2.4 |
| M7.3 | Protocol-locked testing mode | `[ ]` | M7.2, M6.2, M6.3 |
| M7.4 | Benchmark derivation and quality-aware progress | `[ ]` | M7.3 |
| M8.1 | Step-derived eligibility/profile candidate | `[ ]` | M3.7, M6.4 |
| M8.2 | Response/exposure comparison harness | `[ ]` | M5.4, M6.4, M7.4 |
| M8.3 | Policy ship/no-ship decision | `[ ]` | M8.1, M8.2, real history |
| M9.1 | Assisted prose-to-draft import | `[ ]` | M3.5, M3.6 |
| M9.2 | Device/integration adapter contracts | `[ ]` | M7.2 |

---

## M0 — contract and decision boundary

### M0.1 `[ ]` Successor ADR and authority contract

**Current.** ADR-0019 intentionally carries external sessions through a synthetic
`SessionTemplate` and parallel display-only `externalPrescription`. The ADR itself says a
union/source boundary becomes correct when another non-catalog consumer appears. Manual
definitions and a general runner are that consumer.

**Change.** Add a new ADR under `docs/adr/` accepting/revising D-MSESSION through
D-MPOLICY. It must define:

* source identity versus occurrence authority;
* exact precedence of a date-scoped `replace_recommendation` occurrence relative to
  `planningMode.ts`;
* how `additional_session` enters same-day feasibility/critique;
* immutable revision and execution-snapshot ownership;
* migration away from the `ext:` shim without rewriting past audits;
* which facts are inputs to live gates and which remain evidence-only;
* correction/terminal immutability semantics for performed entries.

**Files.** New ADR; update `docs/architecture/recommendation-engine.md` only when code lands,
not in this decision task.

**Done when.** The ADR is accepted, every proposal in the table above has a recorded
decision, and no implementer must invent precedence or persistence ownership.

### M0.2 `[ ]` Canonical schema examples and fixture corpus

**Change.** Add reviewed JSON fixtures under `app/src/sessions/fixtures/` for:

1. the supplied full-body maintenance session;
2. the supplied lower/Olympic session with ramp sets, variants and stop rules;
3. upper-body absorption with alternating/superset groups and later recovery ride;
4. the Friday field session with distance, side and controlled intensity;
5. timed tissue/trunk work;
6. a protocol-locked sprint/jump test;
7. malformed/unresolved custom movement cases.

Fixtures must contain no raw athlete health history. Transient HRV/RHR/pain narrative from
source prose is represented as an import warning, not reusable definition content.

**Done when.** The fixture set covers every schema concept accepted by M0.1 and becomes the
shared corpus for validator, import, runner and visual tests.

### M0.3 `[ ]` Dependency and compatibility contracts

**Change.** Add architecture tests that pin dependency direction before new modules spread:

```text
sessions/ and observations/ domain types
    do not import selection/ranking modules
engine adapters
    may import sessions/ types
components/services
    may import domain types, never optimizer policy
```

Define read compatibility for external plan v1, `DailyRecommendation` v1–v3 and
`StrengthSession` v1. Past audits keep their original `ext:` identity.

**Files.** New `app/src/sessions/architecture.test.ts`; extend
`engine/externalArchitecture.test.ts` and `engine/architecture.test.ts`.

**Done when.** Tests fail on a sessions→optimizer/planner dependency and a compatibility
matrix is recorded in the ADR/plan.

---

## M1 — repair the current Strength workflow

These are tactical changes on the v1 logger but should be componentized for reuse by M4.

### M1.1 `[ ]` Persistent exercise navigator and resume

**Current.** `useStrengthSessionRunner` restores the session but leaves
`activeExerciseIndex` null. `StrengthSessionRunner` only exposes planned exercise buttons,
not a merged list of existing/manual/free-text work.

**Change.** Add a reusable `SessionStepNavigator` that merges persisted exercises with
not-yet-started prescribed exercises, shows required/optional and completed/target state,
and selects last-touched or first-incomplete work on resume. “Open” and “Add” are separate
actions.

**Files.** `hooks/useStrengthSessionRunner.ts`, `components/StrengthSessionRunner.tsx`, new
`components/session/SessionStepNavigator.tsx`, `workouts/strengthSessionEntry.ts`.

**Tests.** Extend `strengthSessionEntry.test.ts`; add visual states in
`visual/fixtures.ts` and `visual/installVisualServices.ts`.

**Done when.** A resumed session with catalog and same-named free-text exercises is fully
understandable and reachable without re-adding anything.

### M1.2 `[ ]` Performed-set correction and undo

**Current.** The v1 hook appends sets only. A valid typo is durable and cannot be fixed.

**Change.** Add pure replace/remove operations keyed by exercise identity + set index +
`completedAt`, service writes that preserve session ownership/state, row-level Edit and an
immediate Undo affordance. Correction is allowed only while the session is in progress;
terminal history remains immutable under current rules.

**Files.** `workouts/strengthSessionEntry.ts`, `hooks/useStrengthSessionRunner.ts`,
`services/strengthSessionService.ts`, `components/StrengthSessionRunner.tsx`.

**Tests.** Pure replace/remove, simultaneous pending writes, correction rejection after
terminal transition, undo after local-cache acceptance.

**Done when.** A `725 kg` typo can be corrected to `72.5 kg` before completion and every
derived view uses the corrected raw log.

### M1.3 `[ ]` Completion and abandonment sheets

**Change.** Replace direct terminal buttons with a completion sheet showing duration,
performed work, incomplete prescribed steps, optional session RPE and notes. Put Abandon
behind a separate danger confirmation that says partial work is retained. Capture the
currently schema-supported session RPE/notes through `finalizeStrengthSession`.

**Files.** New `components/session/SessionCompletionSheet.tsx`; update
`StrengthSessionRunner.tsx`, `useStrengthSessionRunner.ts`,
`strengthSessionCompletion.ts` and tests.

**Done when.** No single tap can terminally close a session; completion persists sRPE/notes;
abandon retains partial sets and is visually separated.

### M1.4 `[ ]` Mobile layout, focus and accessibility

**Change.** Repair `StrengthSessionRunner.css` containment and responsive width; use a
single-column narrow entry flow, ≥44 px primary targets, consistent dark inputs, wrapped
set metadata and responsive history. Implement labels, distinct action names, live regions,
focus styles, Enter submission, and weight focus/select after a successful log.

**Files.** `StrengthSessionRunner.css`, `StrengthSessionRunner.tsx`,
`StrengthOverloadHistory.tsx`/CSS, `App.css` where content width currently shrink-wraps.

**Done when.** The visual test at 390 px has no horizontal overflow; keyboard and screen-
reader names are unambiguous; the repeated entry loop returns to weight.

### M1.5 `[ ]` Today start/resume CTA and last-time context

**Change.** Add **Start / resume and log this session** to the Strength recommendation on
`Home`; add a global in-progress banner; preserve route/resume state on reload. Move the
90-day history table out of the live flow and show a compact last comparable performance
beside the active exercise.

**Files.** `components/Home.tsx`, `App.tsx`, `Header.tsx`, `MobileNav.tsx`,
`StrengthSessionRunner.tsx`, `StrengthOverloadHistory.tsx`, `hooks/useOverloadHistory.ts`.

**Done when.** The athlete reaches/resumes the session from Today in one action and can see
the relevant prior performance without scrolling through the history table.

### M1.6 `[ ]` Strength visual, interaction and offline acceptance

**Change.** Add `strength` to the visual screen/fixture vocabulary and Playwright capture.
Cover no-session, prescribed, resumed, pending/synced, validation error, correction,
completion/abandon and populated history on desktop and 390 px. Add the previously owed
real-browser offline kill/reopen/reconnect scenario.

**Files.** `visual/fixtures.ts`, `visual/VisualReviewApp.tsx`,
`visual/installVisualServices.ts`, `tests/visual/capture.pw.ts`, and a dedicated Playwright
interaction spec if capture tests should remain screenshot-only.

**Done when.** Tests assert no overflow, all persisted exercises reachable, correction
works, terminal confirmation is required, weight refocuses, and offline reload/reconnect
does not duplicate or lose a set.

---

## M2 — source-neutral session and persistence foundation

### M2.1 `[ ]` Session definition and execution types/validators

**Change.** Add framework-free domain types under `app/src/sessions/`:

* `SessionDefinitionV2`, source and session intent;
* blocks, group execution modes and stable step IDs;
* dose/load/effort/quality/rest/tempo/laterality unions;
* alternatives and bounded condition signals/actions;
* occurrence authority/state;
* immutable `ExecutionPrescription`;
* execution header and discriminated performed-entry payloads.

Add strict authoring validators with operational bounds and tolerant persistence parsers
that report `AVAILABLE/MISSING/INVALID/UNAVAILABLE` consistently. No validator may parse a
display string into behavior.

**Files.** New `sessions/models.ts`, `sessions/validation.ts`,
`persistence/parsers/sessionDefinition.ts`, `persistence/parsers/sessionExecution.ts` and
tests. `engine/models.ts` imports only boundary types needed by recommendations.

**Done when.** Every M0.2 fixture validates or fails with a precise field-path issue, and
round-trip serialization retains sides/ranges/variants/actions exactly.

### M2.2 `[ ]` Source adapters, canonical serialization and hashing

**Change.** Implement deterministic serialization/hash for normalized definitions and
execution prescriptions. Add resolvers for catalog, external v2 and manual sources.
External v1 receives a display-compatible adapter but cannot invent missing conditions,
laterality or exercise IDs.

**Files.** New `sessions/sessionDefinitionHash.ts`,
`sessions/sessionDefinitionResolver.ts`, `sessions/catalogSessionAdapter.ts`,
`sessions/externalSessionAdapter.ts`; reuse/hash-test patterns from
`engine/externalPlanHash.ts`.

**Done when.** Key ordering does not change a hash, any material dose/condition change does,
and identical manual/imported normalized content produces identical semantic output.

### M2.3 `[ ]` Definition and occurrence persistence

**Change.** Add user-scoped services and Firestore rules for:

```text
session_definitions/{definitionId}
session_definitions/{definitionId}/revisions/{revision}
session_occurrences/{occurrenceId}
```

Manual definition revisions are immutable/content-hashed; header ratchets revision.
Occurrence scheduled date uses Warsaw local semantics and carries source, authority,
placement state and created/updated timestamps. Nested definition validation is defensive
on read because rules cannot iterate arbitrary arrays; top-level ownership/shape/bounds and
revision immutability remain rules-enforced.

**Files.** New `services/sessionDefinitionService.ts`,
`services/sessionOccurrenceService.ts`; `firestore.rules` and emulator tests.

**Done when.** Owner CRUD/immutability tests pass, cross-user access fails, revision bytes
cannot be changed, invalid dates/authority/state are denied, and placement changes never
mutate the definition revision.

### M2.4 `[ ]` Execution header and entry persistence

**Change.** Add:

```text
session_executions/{executionId}
session_executions/{executionId}/entries/{entryId}
```

The header carries occurrence/source/hash, Warsaw start date, state, immutable
`ExecutionPrescription` snapshot/hash and summary fields. Entry documents carry stable ID,
planned step, side, alternative, timestamp and exactly one discriminated payload.

Rules validate each entry document by kind; they no longer need to validate a variable
nested set list. Allow correction/delete only while the parent execution is in progress,
preserving identity/createdAt. Terminal executions and their entries are immutable.

**Files.** New `services/sessionExecutionService.ts`; parser/tests from M2.1;
`firestore.rules` and emulator tests.

**Done when.** Repetitions, duration, distance, sprint, COD, jump and check-off entries each
round-trip; cross-user/malformed/kind-mismatched writes fail; an offline entry syncs once;
terminal mutation is denied.

### M2.5 `[ ]` Strength v1 compatibility adapter

**Change.** Add a pure adapter from `StrengthSession` v1 to the version-neutral execution
read model. Preserve original session/exercise/set identity as far as possible, map reps/kg
and gauge exactly, and mark unavailable planned-step/side/source metadata as missing—not
guessed. Do not bulk migrate Firestore.

Update overload history, 1RM derivation, strength exposure and manual-training measurement
to consume the read model or explicit adapters. Keep v1 tests.

**Files.** New `sessions/legacyStrengthAdapter.ts`; update `overloadHistory.ts`,
`oneRepMaxWriteback.ts`, `strengthExposure.ts`, `manualTrainingMeasurement.ts` and tests.

**Done when.** Existing v1 fixtures produce byte-equivalent overload/1RM results and new v2
repetition entries produce the same results through the shared read boundary.

### M2.6 `[ ]` Recommendation persistence, immutability and replay

**Current.** `Recommendation.externalPrescription` is in-memory only;
`DailyRecommendation` persists catalog `prescription` only.

**Change.** Add source/occurrence and exact `ExecutionPrescription` snapshot/hash to
`Recommendation`/`DailyRecommendation`. Include them in `recommendationService`
decision-change equality, archived revision bytes, `validateRecommendation`, Firestore
`decisionFieldsUnchanged`, audit provenance and replay. Historical `ext:` audits keep their
old path and hash verification.

**Files.** `engine/models.ts`, `services/recommendationService.ts`, `engine/validation.ts`,
`engine/provenance.ts`, `engine/replay.ts`, `firestore.rules` and their tests.

**Done when.** An imported/manual recommendation survives reload and seeds execution;
changing one prescribed action creates/archives a decision revision; replay fails on hash
mismatch and passes against exact stored bytes.

---

## M3 — authoring and import

### M3.1 `[ ]` Bounded exercise/drill facet vocabulary

**Change.** Extend `ExerciseDefinition` with a minimal optional metadata layer proven by
M0.2 fixtures:

* family and variant facets;
* allowed dose/load/laterality and default measurement profile;
* reviewed aliases;
* domain-specific facets for acceleration, max velocity, braking, COD and elastic work;
* coarse tissue-demand/safety tags, clearly heuristic.

Do not build every dimension from the attached requirements. Add a catalog validator that
rejects incompatible facet combinations and unknown measurement profiles.

**Files.** `workouts/models.ts`, `workouts/exercises.ts`, `workouts/validation.ts`,
`scripts/validate-workouts.ts`; add representative missing movements from the supplied
sessions.

**Done when.** The fixture movements resolve without free-text where common, catalog
validation catches invalid facets, and old catalog workouts remain valid through optional
defaults.

### M3.2 `[ ]` Aliases and user-confirmed custom movements

**Change.** Add a resolver state: `matched`, `custom_confirmed`, `unresolved`. Persist
user-owned custom definitions with display name, family/domain, dose/load/laterality,
equipment and explicit metadata confidence. Aliases require confirmation before becoming
user-owned mappings.

Unresolved movement names remain loggable but cannot assert precise safety, cost, stimulus,
muscle split, PR or 1RM semantics.

**Files.** New `sessions/movementResolver.ts`, `services/customMovementService.ts`, parser,
Firestore rules/emulator tests, and exercise picker updates.

**Done when.** “Chest-supported row” can map once and reuse the mapping; an unresolved
“special calf drill” remains executable/loggable with a visible confidence warning and
fails closed for metadata-driven engine claims.

### M3.3 `[ ]` Manual block-first session builder

**Change.** Build a mobile authoring flow for title/intent/duration/global targets, blocks,
group mode, movement search/recent/custom, dose-specific fields, and collapsed advanced
rest/tempo/cue/condition/alternative settings. Support reorder, duplicate and preview.

**Files.** New components under `components/session-builder/`, a pure reducer in
`sessions/sessionDraft.ts`, routing in `App.tsx`/navigation, service from M2.3.

**Tests.** Reducer operations, validation issue focus, reorder ID stability, mobile visual
fixtures, keyboard/accessibility.

**Done when.** The full-body maintenance and lower/Olympic fixtures can be built without
editing JSON and preview identically to their normalized fixtures.

### M3.4 `[ ]` External plan/session schema v2 adapter

**Change.** Publish `external-plan@2` using normalized session definitions while retaining
v1 read/import compatibility. Validation remains strict and path-specific. Importers may
not accept author-supplied calibrated engine cost/stimulus. Stale health/readiness narrative
becomes a warning/narrative classification, never a reusable gate.

**Files.** `engine/models.ts` or new boundary types in `sessions/externalPlanV2.ts`,
`engine/validation.ts`, `docs/external-plan-schema.md`, prompt template in
`ExternalPlanImport.tsx`, hash/diff tests.

**Done when.** M0.2 external fixtures validate; v1 remains importable; ranges, sides,
conditions and companions survive hash/reload; unknown keys fail.

### M3.5 `[ ]` Full semantic import preview and diff

**Change.** Replace the calendar-only preview with expandable session content: blocks,
resolved identities/confidence, dose/load/effort/rest/tempo, side/optional, alternatives,
condition signal/action, companion sessions, narrative-only text and blocking warnings.
Revision diff flags every behavior-changing field.

**Files.** `ExternalPlanImport.tsx`/CSS, `externalPlanDiff.ts`, new reusable
`SessionDefinitionPreview.tsx`, resolver from M3.2.

**Done when.** Import cannot proceed with unresolved blocking semantics; changing per-side
to bilateral, optional to required or end-block to reduce-load is visible before confirm;
the preview shows every supplied workout step rather than one summary line.

### M3.6 `[ ]` Save/schedule/replace/add/start intent flow

**Change.** After authoring/import, show explicit destinations with effects:

* Save only;
* Schedule;
* Replace today's recommendation;
* Add another session today;
* Start unplanned.

Implement occurrence creation and audited date-scoped authority exactly as M0.1 decides.
Additional sessions receive same-day feasibility/stacking critique. Unplanned execution
does not retroactively become a recommendation.

**Files.** New `SessionDestinationSheet.tsx`; `sessionOccurrenceService.ts`,
`planningMode.ts`/composition boundary selected by ADR, `Home.tsx`, audit tests.

**Done when.** Each choice has a distinct persisted result and test; save-only cannot
change selection; replace is replayable; add cannot bypass feasibility; unplanned affects
history only after completion.

### M3.7 `[ ]` Catalog-to-definition adapter and execution snapshot

**Change.** Adapt `WorkoutPrescription.adjustedBlocks` into the same definition/execution
shape used by authored sources. Preserve catalog ID/version, display targets, variants,
technical stop conditions and optionality. Delete runner dependence on
`extractPlannedStrengthExercises` only after parity tests pass.

**Files.** `sessions/catalogSessionAdapter.ts`, `workouts/prescription.ts`,
`strengthSessionEntry.ts`, recommendation composition and tests.

**Done when.** Existing catalog Strength execution shows no regression and the same runner
can start catalog, external and manual fixtures with source identity intact.

---

## M4 — general mixed-dose runner

### M4.1 `[ ]` General session-runner lifecycle

**Change.** Introduce `useSessionRunner` and `SessionRunner` owning header/block/step
navigation, offline sync, elapsed/rest state, source snapshot and terminal flow. Reuse M1
components. Keep the v1 Strength route behind its existing path until parity is proven;
then redirect new sessions to the general runner.

**Files.** New `hooks/useSessionRunner.ts`, `components/session/SessionRunner.tsx`,
`sessions/sessionExecutionReducer.ts`; update `App.tsx`.

**Done when.** Reload selects the last-touched/incomplete step; entry writes are per-entry;
pending/synced status remains honest; no source-specific runner branches own lifecycle.

### M4.2 `[ ]` Typed repetition/time/distance/check-off inputs

**Change.** Add a measurement-profile registry selecting small input cards:

* repetitions + typed load + tagged gauge;
* duration/isometric + side/load/position;
* distance + optional time;
* completion/round check-off.

Common values prefill from prior performed entry and prescription; irrelevant controls are
never rendered.

**Files.** New `sessions/inputProfiles.ts` and components under
`components/session/inputs/`; parser/service tests.

**Done when.** Bench, power clean, soleus iso, Copenhagen plank, dead bug, sled drag,
recovery bike and warm-up circuit fixtures can be completed without fake reps/kg.

### M4.3 `[ ]` Groups, alternatives and bounded condition actions

**Change.** Render sequential/circuit/alternating/superset progress. Implement the bounded
condition evaluator from D-MCOND for canonical inputs and athlete-confirmed observations.
Actions create an execution event/selected-variant record before changing future steps.

Every offered alternative is resolved and gated; a free-text fallback remains advisory.

**Files.** New `sessions/conditionEvaluator.ts`, `sessions/variantResolver.ts`,
`ConditionActionCard.tsx`; engine eligibility adapter/tests.

**Done when.** Warm-up-heavy squat reduction, clean-catch load reduction, bar-speed
end-block and symptom-based squat choice execute deterministically and remain in history.

### M4.4 `[ ]` Companion occurrence and duplicate reconciliation

**Change.** Distinguish embedded segments from later companion occurrences. Starting a
companion creates its own execution. Extend occurrence keys/reconciliation so a manual
execution and matching Garmin activity merge as evidence for one physical occurrence.

**Files.** `engine/completedTraining.ts`, `engine/trainingHistory.ts`, the completed-session
adapters, new `sessions/occurrenceReconciliation.ts`; UI companion card.

**Done when.** Embedded bike warm-up stays inside Strength; later recovery spin may be
started/skipped independently; a matching Garmin ride is counted exactly once.

### M4.5 `[ ]` General completion summary and performed comparison

**Change.** Generalize M1 completion to planned vs performed blocks/entries,
substitutions/omissions, duration, sRPE, pain/unusual response and notes. Keep session RPE
as raw RPE + duration; any multiplied display value is derived.

**Files.** `SessionCompletionSheet.tsx`, `sessionExecutionService.ts`, new pure
`sessions/performedComparison.ts` and tests.

**Done when.** Completion takes a short path, shows missing required work without treating
optional omissions as failure, and produces a versioned comparison usable by response and
analytics without changing engine policy.

---

## M5 — occurrence-linked response loop

### M5.1 `[ ]` Response observation/link schema and persistence

**Change.** Add `ResponseObservation` with occurrence/execution identity and window
`immediate | later_day | next_morning`. Immediate/later values are canonical response
payloads. Next-morning may reference canonical `DailySubjectiveCheckin` fields rather than
duplicate them; M0.1 must define ownership/edit behavior.

Add user-scoped service/rules/parser and `UNKNOWN` semantics. No response record is
fabricated for a missing prompt.

**Files.** New `responses/models.ts`, `services/responseObservationService.ts`, parser,
rules/emulator tests.

**Done when.** A response cannot reference another user's occurrence, window/date are
valid, edits preserve provenance, and missing follow-up is distinguishable from normal.

### M5.2 `[ ]` Immediate post-session response

**Change.** Integrate a 10–20-second response into completion: session RPE, completed
fraction, pain/technique/unexpected fatigue, relevant regions and short note. Do not require
irrelevant tissue questions.

**Files.** `SessionCompletionSheet.tsx`, response service, `DailyCheckin` shared tissue
controls where appropriate.

**Done when.** Completion creates execution + immediate response transactionally/idempotently
and retry cannot duplicate it.

### M5.3 `[ ]` Later-day and next-morning follow-up

**Change.** Surface due follow-ups on Today/Check-in rather than requiring notifications.
Use occurrence metadata/tissue tags to ask relevant regions. Link next-morning answers to
the existing check-in so injury policy continues to consume the canonical daily model and
may only tighten.

**Files.** `Home.tsx`, `DailyCheckin.tsx`, `checkinService.ts`, new
`responses/followupSchedule.ts`.

**Done when.** A field/novel lower session creates one later-day and one next-morning
prompt; answers link to the correct occurrence; skipped prompts stay unknown; a favorable
global readiness cannot override adverse tissue response.

### M5.4 `[ ]` Outcome/override evidence views

**Change.** Derive `passed | caution | reactive | unknown` as a versioned, evidence-only
summary from raw response windows. Record athlete override reason and planned/performed
delta. Display history without claiming injury prediction or automatically learning a
tolerance threshold.

**Files.** New `responses/outcome.ts`, `components/session/ResponseHistory.tsx`; reuse
`SessionAdjustment.athleteReason` via a source-neutral override record rather than forcing
every change into strength adjustment.

**Done when.** Every outcome links to source facts/policy version; missing later/next data
returns unknown; no selection module imports the outcome function.

---

## M6 — speed, field and power execution

### M6.1 `[ ]` Representative speed/field/power taxonomy v1

**Change.** Add a deliberately small reviewed set:

* 10/20 m acceleration and flying 10 m;
* controlled/max deceleration;
* planned 45°/90° COD with side; reactive agility as a distinct family;
* low/high bilateral and unilateral elastic contacts;
* CMJ, low drop jump and one med-ball throw;
* ball technical and small-sided/chaotic exposure descriptors.

Record start, surface, approach/exit, angle, planned/reactive, side, contact intensity and
measurement-profile facets only where relevant. Avoid a huge flat list.

**Files.** `workouts/exercises.ts`, `workouts/models.ts`, catalog validator and new
`sessions/domainFacets.ts`.

**Done when.** Friday field and one test/training session per domain validate with no
irrelevant required fields and planned COD cannot masquerade as reactive agility.

### M6.2 `[ ]` Sprint and field performed-entry cards

**Change.** Add sprint rep and COD/deceleration cards. Training mode supports completion,
optional time/splits, rest, side, validity/notes and stop criterion. It does not force a
timing device or promote a training rep to benchmark.

**Files.** `components/session/inputs/SprintEntry.tsx`, `CodEntry.tsx`, typed payload
parsers/services and visual tests.

**Done when.** Acceleration, deceleration, lateral/COD and ball-work fixture executes on a
390 px viewport; left/right remain first-class; timing missing is valid training data.

### M6.3 `[ ]` Jump/throw/contact performed-entry cards

**Change.** Add simple contact check/count and attempt-based jump/throw entry with native
metrics when available. Store every attempt/validity; summary is derived. Do not require
force-plate metrics from manual users.

**Files.** New input cards and payload validators; M7 observation seam.

**Done when.** Low pogo contact dose, CMJ height-only attempts, drop-jump height/contact
time and med-ball distance can coexist without one generic “power score.”

### M6.4 `[ ]` Domain exposure read models

**Change.** Derive transparent histories—days/reps/metres/contacts since acceleration,
max-velocity, braking/COD, elastic work and hard lower strength. Keep raw units and confidence;
do not fuse them to ACWR or injury probability.

**Files.** New `sessions/exposureHistory.ts`, progress components and tests.

**Done when.** The last 7/14/28-day reports reconcile exactly to execution entries,
unresolved movements are reported separately, and no production engine import exists.

---

## M7 — observation provenance, testing and progress

### M7.1 `[ ]` Metric registry, protocols and comparable series

**Change.** Add a static `MetricDefinition` registry and user-scoped immutable
`MeasurementProtocol` revisions. Define unit, compatible entry kind, required context,
summary methods and deterministic comparable-series key inputs. Device/source changes and
material protocol changes create a new series/version.

Start with sprint time/splits, jump height, contact time, RSI derivation, throw distance
and optional bar velocity. Do not implement the full attached metric catalogue.

**Files.** New `observations/models.ts`, `observations/registry.ts`,
`observations/comparability.ts`, protocol service/rules/parsers.

**Done when.** Same protocol/device/surface yields the same key; material timing/drop-height
change does not; units cannot mismatch registry definitions.

### M7.2 `[ ]` Metric observation persistence and adapters

**Change.** Persist raw observations with session/attempt, metric, value/unit, observedAt,
source/device/protocol/comparison series, quality/validity and raw reference. Derived values
carry algorithm version and source observation IDs; raw values are never overwritten.

Add manual adapter first. Device adapters implement the same boundary later.

**Files.** New `services/metricObservationService.ts`, parser/rules/tests,
`observations/manualAdapter.ts`.

**Done when.** Raw attempts survive recalculation, cross-user/source spoofing fails, and a
derived RSI references height/contact/protocol/algorithm rather than a bare number.

### M7.3 `[ ]` Protocol-locked testing mode

**Change.** Add a distinct Testing route/state with protocol confirmation, warm-up,
practice/valid/invalid attempts and reason, rest and explicit finish. Training execution
cannot promote its own result to a benchmark without a confirmation flow creating a test
attempt under a compatible protocol.

**Files.** New `components/testing/`, route/navigation, session intent handling and tests.

**Done when.** A 20 m sprint/CMJ/505-style fixture records all attempts, sides and validity;
protocol is locked during the test; changing setup requires a new revision/series.

### M7.4 `[ ]` Benchmark derivation and quality-aware progress

**Change.** Derive best/mean/median summaries from valid comparable attempts. Store an
optional rebuildable summary with algorithm version; never overwrite tested values with
estimated ones. Show change only within comparable series and show data-quality/missing-
protocol badges. Meaningful-change claims require separately reviewed error metadata.

**Files.** New `observations/benchmarks.ts`, `components/progress/` domain views and tests.

**Done when.** Invalid/practice attempts never become benchmarks; device/protocol mismatch
prevents default PR comparison; raw attempts remain accessible; no “athleticism score” is
shown.

---

## M8 — engine evidence candidates

### M8.1 `[ ]` Step-derived eligibility/profile candidate

**Change.** Replace coarse external-strength assumptions in a default-off candidate adapter
using resolved required steps, selected alternatives and actual definition duration.
Optional steps cannot block the session. Unknown/custom-unreviewed metadata forces
conservative eligibility and discounted evidence.

Do not activate cost/stimulus. Produce a comparison against current
`externalSessionProfiles.ts` and current gate results.

**Files.** New `engine/authoredSessionProfiles.ts`, comparison tests/report; retain current
production adapter until M8.3.

**Done when.** The upper-only sample no longer claims heavy lower work in candidate output,
the lower/Olympic sample does, every gate discrepancy is reported, and live selections are
unchanged.

### M8.2 `[ ]` Response/exposure comparison harness

**Change.** Add a de-identified real-history report joining authored/planned/performed,
domain exposure, responses and current decisions. Evaluate candidate spacing,
substitution/progression and cost/stimulus mappings without exposing raw notes or health
payloads. Report missing follow-up and provenance coverage.

**Files.** New simulation/report commands under `engine/simulation/` and `scripts/`, with
output under gitignored `artifacts/` and a reviewed analysis snapshot when run.

**Done when.** The report can reproduce its joins, names policy/algorithm versions, and
distinguishes “no reaction” from “no response.” Synthetic scenarios alone do not satisfy
the real-history gate.

### M8.3 `[ ]` Policy ship/no-ship decision

**Change.** Write a dated analysis and ADR amendment/new ADR for each candidate. A ship
requires no hard-gate regressions, reviewed real-history evidence, scenario invariants,
policy-version increment, replay coverage and rollback selector. A negative result
completes the measurement item and leaves production unchanged.

**Done when.** Every candidate has an explicit ship/defer/reject result. “Code exists” is
never treated as authorization.

---

## M9 — assisted authoring and future adapters

### M9.1 `[ ]` Assisted prose-to-draft import

**Change.** Add a server-side structured-output parser only after M3.5. The model writes a
draft, never Firestore. Persist parser/model/schema version and optional source text
separately; validation/resolution/athlete confirmation produce the immutable normalized
artifact. Flag transient HRV/RHR/pain context for removal.

**Done when.** Reopening never re-parses; source-to-interpretation review exposes every
material field; failure falls back to manual/JSON; no client API key exists.

### M9.2 `[ ]` Device/integration adapter contracts

**Change.** Specify adapters for manual, Garmin/FIT, timing gate, VBT, GPS and force plate
against `MetricObservation`. Implement only a bounded spike chosen by actual demand.
Deduplication links sources to one occurrence/execution rather than creating duplicate
completed sessions.

**Done when.** The adapter conformance suite proves units/protocol/source identity and
deduplication; no vendor-specific type enters session/engine domain logic.

---

## Verification matrix

### Always required for code increments

* `cd app && npm run check`
* `cd app && npm run build`
* `cd app && npm run test:rules` for every persistence/rules change
* `cd app && npm run validate:workouts` for ontology/catalog changes
* desktop and 390 px visual review for every new author/runner/testing state

### Required when recommendation behavior could change

* `cd app && npm run simulate:scenarios`
* `cd app && npm run simulate:diff`
* `cd app && node scripts/check-policy-drift.mjs <base-sha>`
* replay of catalog and external/manual audits against exact stored artifacts
* architecture tests proving evidence-only modules are not imported into selection

### Named end-to-end scenarios

1. manual full-body session: author → schedule → adjudicate → execute → correct → complete;
2. imported lower/Olympic session: semantic review → condition actions → replay;
3. upper-only absorption: required-step gating does not fabricate heavy lower work;
4. timed/per-side tissue block: native entry and correct side history;
5. Friday field: distances, sides, controlled intensity and stop/downgrade;
6. optional later spin: separate occurrence and Garmin deduplication;
7. offline kill/reopen/reconnect with pending entry and no duplicate;
8. sprint/CMJ/COD test: protocol lock, invalid attempt, comparable benchmark;
9. later/next response: occurrence linkage, unknown missing response, tighten-only tissue;
10. legacy Strength: identical history/1RM output through v1 adapter.

---

## Acceptance criteria

### Foundation

* [ ] All M0.1 decisions are accepted and referenced by implementation tasks.
* [ ] Definitions, occurrences, prescriptions and executions have distinct stable IDs.
* [ ] Every new Firestore path is user-scoped and emulator-tested.
* [ ] V1 Strength and external-plan history remains readable without bulk rewrite.
* [ ] Recommendation persistence/replay contains exact executable source content.

### Athlete UX

* [ ] Existing Strength P1/P2 exit criteria are satisfied.
* [ ] Manual/imported/catalog sessions share one runner.
* [ ] Reps, time, distance, side and check-off use appropriate controls.
* [ ] A performed mistake can be corrected before terminal completion.
* [ ] Conditions/alternatives are explicit actions and recorded in history.
* [ ] Import preview exposes every material behavior before confirm.
* [ ] Completion and response paths remain short and accessible on 390 px.

### Evidence integrity

* [ ] Planned and performed data are never the same record.
* [ ] Metric observations include unit/source/protocol/validity/comparison identity.
* [ ] Invalid/practice/non-comparable attempts do not become default benchmarks.
* [ ] Missing delayed response remains unknown.
* [ ] Unknown custom movements are loggable but cannot claim precise engine metadata.
* [ ] No universal readiness/load/athleticism or ACWR injury score is introduced.
* [ ] No M8 candidate changes production without its own explicit ship decision.

---

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Schema scope grows without bound | Fixture-led v2 vocabulary; extension/versioning; defer speculative set/device types | Keep v1 routes/import and reject unsupported v2 fields |
| Firestore nested validation remains weak | Performed entries are individual documents; immutable revision parser validates nested definition bytes | Disable v2 writes; existing v1 data untouched |
| Offline concurrent correction conflicts | Stable entry IDs, parent lifecycle checks, idempotent writes and emulator/browser tests | Keep append-only v1 runner available during cutover |
| Recommendation replay drifts | Persist exact snapshot/hash and include in decision equality/audit | Fall back to catalog/external v1 replay paths; do not rewrite old audits |
| Rich logging becomes slow | Measurement-profile controls, defaults, recent values, check-off modes and progressive disclosure | Hide advanced fields; retain minimum performed payload |
| Custom metadata creates false safety | Confidence state and fail-closed engine adapter | Treat custom/unresolved as generic evidence only |
| Response data is mistaken for diagnosis | Raw language, transparent heuristics, no probability claims | Disable derived outcome view; retain raw responses |
| New detail silently changes selection | Evidence-only import guards and default-off candidates | Remove selector/import; production current path remains |
| Garmin/manual data double-counts | Occurrence keys and explicit source reconciliation | Prefer one source and mark other linked/ignored, never delete raw evidence |

UI cutover must be reversible until M4 parity is demonstrated. Historical documents and
audits are never deleted during rollback.

---

## Out of scope

* ACWR or injury-probability features;
* one universal readiness, load or athleticism score;
* automatic live progression/substitution before M8 evidence;
* coach/team tenancy, permissions or dashboards;
* a relational/warehouse/Databricks migration;
* full force-plate, timing-gate, GPS, VBT or video integrations;
* hundreds of exercises/metrics before the representative taxonomy passes end-to-end;
* push-notification infrastructure;
* changes to Garmin backend date/user-isolation semantics;
* enabling ADR-0021 Strength cost solely because v2 execution data exists.

Each may receive a separate plan after the dependency and evidence it needs exists.

---

## Documentation to update as work lands

* new successor ADR from M0.1 and `docs/README.md` ADR index;
* `docs/architecture/recommendation-engine.md` for source-neutral adjudication/authority;
* `docs/workout-library.md` for definition/catalog adapter and ontology facets;
* `docs/external-plan-schema.md` for v2 and v1 compatibility;
* a new living `docs/architecture/session-execution.md` after M2;
* Firestore collection/schema documentation after M2/M5/M7;
* `docs/ops/` for any parser service or integration credentials/deployment;
* this plan's task board and plan index status after every completed item;
* dated analyses and policy ADRs for M8 measurement outcomes.

When this plan eventually becomes `Implemented`, remove or rewrite the present-tense
problem statements and keep an outcome summary, per `docs/plans/README.md`.
