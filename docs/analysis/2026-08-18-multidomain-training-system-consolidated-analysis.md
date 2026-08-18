# Multidomain training system — consolidated product and architecture analysis (2026-08-18)

**Question asked.** Reconcile the attached *Speed, Field, Power & Strength Tracking
Requirements* with the current application, the Strength UI/UX review, and the authored
composite-session import/execution analysis; decide what should actually be built and in
what architectural shape.

**Verdict.** The attached requirements contain the right product north star but a much
larger scope than the immediate session problem. The application should evolve toward an
athlete-first multidomain loop—**prescribe → perform → measure → respond → adapt**—without
becoming a collection of separate strength, sprint and field loggers. The next release
boundary, however, should remain narrower: a source-neutral session definition, an
explicit scheduled occurrence, a durable execution snapshot, typed performed entries,
fast authoring/import, and a safe mobile runner.

Measurement protocols, comparable series, delayed response, tests and domain-specific
exposure are the correct next layers. Automatic progression, substitution, fatigue or
injury-related policy must remain evidence-gated after those layers have collected real
history. A relational rewrite, force-plate/GPS/VBT integrations, coach mode and generalized
AI parsing are not prerequisites for making the supplied sessions work.

This document is the consolidated successor for roadmap decisions. It does not edit or
erase the two earlier dated analyses:

* [`2026-08-18-strength-session-ui-ux-review.md`](./2026-08-18-strength-session-ui-ux-review.md)
  remains the evidence record for the existing runner's interaction defects;
* [`2026-08-18-authored-composite-session-import-and-execution.md`](./2026-08-18-authored-composite-session-import-and-execution.md)
  remains the evidence record for the imported/manual session representation gap.

The repository's analysis convention says dated audits are never edited after publication,
so “merge” here means a new synthesis with explicit precedence, not rewriting the previous
records.

---

## 1. Inputs and review boundary

The synthesis used:

* the attached *Adaptive Training Recommender — Speed, Field, Power & Strength Tracking
  Requirements* document;
* the supplied real workout examples: Olympic derivatives, strength, isometrics, circuits,
  field accelerations/decelerations/COD, optional recovery cycling, conditional variants
  and stop rules;
* the two prior browser- and code-backed analyses named above;
* current `engine/`, `workouts/`, persistence, services, Firestore rules and UI;
* the living recommendation architecture and accepted ADR-0019/ADR-0021 boundaries;
* the current status-tracked Strength logging plan.

The attached file was treated as product/design input, not as repository instructions. Its
research references were not independently reproduced in this review. Any scientific
claim that would set an engine threshold, tissue-demand coefficient, meaningful-change
boundary or automatic progression policy still needs a repository-owned evidence review.

---

## 2. What should be retained from each input

### From the Strength UI/UX review

The current logger must first become trustworthy on a phone:

* an active session and every existing exercise must be visible immediately on resume;
* a wrong performed row must be editable/undoable;
* completion and abandonment need separated confirmation flows;
* the layout, focus loop, labels and touch targets need deliberate mobile behavior;
* the prescription and “last time” context must be present in the runner;
* visual/interaction fixtures must protect the actual lifecycle.

These are not polish. A richer domain model would make the existing defects more costly.

### From the authored composite-session analysis

The deterministic middle is the immediate architectural need:

* catalog, external and manual sources normalize to one session definition;
* definition, occurrence, execution prescription and performed log have separate
  identities/lifecycles;
* blocks, group modes, mixed doses, ranges, laterality, load targets, tempo, cues,
  alternatives and bounded conditions remain structured;
* imported content receives a full semantic preview before persistence;
* an optional later ride is a companion occurrence, not a hidden Strength step;
* external/manual sessions pass existing engine gates and do not bypass them.

### From the attached multidomain requirements

The new document adds four important layers that the earlier analyses deliberately did not
cover:

1. **Domain-specific evidence.** Sprint time, jump attempts, COD side, contact counts and
   bar velocity must not be flattened into kilograms × repetitions or one load scalar.
2. **Measurement provenance and comparability.** A value needs a metric, unit, protocol,
   source/device, validity and comparison-series identity before it becomes a benchmark.
3. **Training versus testing.** A fast training repetition is not automatically a test;
   protocol-locked attempts and benchmark promotion need a separate workflow.
4. **Delayed response.** Immediate, later-day and next-morning tissue/subjective responses
   should link back to the exact occurrence that caused the exposure.

Together, these inputs describe one coherent product rather than three parallel requests.

---

## 3. Current capability map

| Area | Current state | Consequence |
|---|---|---|
| Recommendation authority | Strong. Clinical, feasibility, readiness, phase and planning authority are explicit. External sessions use adjudication rather than ranking. | Reuse the gates; do not build a second rules engine in the runner/importer. |
| Catalog prescription | Moderate. Blocks, exact time/distance/reps, multiple targets, optional steps and three variants exist. | Useful adapter source, but insufficient as the user-authored durable contract. |
| External plan import | Calendar-oriented v1 JSON with immutable revisions and replay hash. Step detail is display-only and lossy. | Preserve revision/hash mechanics; replace the step vocabulary and preview for v2. |
| Manual workout creation | Starts a Strength log, then adds catalog/free-text exercises. | Records activity but cannot author a future executable session. |
| Strength execution | Durable per-set offline-capable logging, tagged gauges, history and 1RM derivation. | Valuable foundation, but currently reps/kg-only and interaction-incomplete. |
| Field/speed catalog | Several acceleration, max-velocity, braking, COD and ball drills already exist. | Prescription seed exists; performed attempt model and runner do not. |
| Exercise metadata | Flat `ExerciseDefinition` with movement, muscle, equipment, impact/eccentric/coordination and contraindications. | Start from it; add a bounded family/variant/measurement layer rather than replacing it wholesale. |
| Tissue feedback | `DailySubjectiveCheckin.tissueResponses` already distinguishes region and morning/during/after/next-morning states; injury policy may only tighten. | Extend provenance/linkage to occurrences; do not invent a separate symptom authority. |
| Completed exposure | Six-dimensional cost and eight-dimensional stimulus with evidence tiers; manual Strength candidate is default-off. | The repository already rejects one universal load. New domain mappings remain measured candidates. |
| Performance testing | No protocol, attempt validity, comparison series or benchmark workflow. | Add only after the execution/observation foundation. |
| Generic metric provenance | Garmin activity telemetry carries source-specific detail, but no generic protocol-aware observation registry exists. | Introduce a small observation boundary before device integrations. |
| Delayed response linkage | Tissue fields exist on the daily check-in but are not tied to a source occurrence and no later-day prompt record exists. | Add response observations and occurrence links without changing decision coefficients initially. |

The codebase is much closer to the attached vision on engine authority, readiness, local
tissue state and evidence discipline than the requirements document assumes. The largest
gaps are authoring/execution identity, typed performed data, protocol provenance and the
response loop—not a missing optimizer.

---

## 4. Requirements disposition

### Adopt now as architectural invariants

1. Planned and performed work are different records.
2. Catalog, manual and imported content share one normalized execution contract.
3. Domain-specific performed values retain their native units and context.
4. Training, testing, competition, recovery, skill and return-to-sport intent are explicit.
5. Local tissue/safety constraints outrank favorable global readiness.
6. Missing or unresolved data reduces confidence and never becomes a normal value.
7. Every persisted recommendation/execution remains user-scoped and replayable.
8. User override and authored substitution are recorded, not silently erased.
9. No cross-domain universal load/athleticism score is created.
10. No text field is parsed back into executable behavior after confirmation.

### Adopt with repository-specific modification

| Attached proposal | Repository-specific decision |
|---|---|
| Large exercise/drill ontology | Start with a small typed facet layer over `ExerciseDefinition`; prove it on the supplied strength/field set before expanding. |
| Generic `SessionPlan`/`SessionActual` entities | Use `SessionDefinition`, `SessionOccurrence`, immutable `ExecutionPrescription`, and `SessionExecution` so placement and adjudication remain explicit. |
| Relational core | Keep user-scoped Firestore. Model entity boundaries as collections/subcollections; no storage-engine rewrite is justified. |
| Customizable readiness schema | Keep stable canonical questions where baselines depend on wording/scale. Allow optional modules, not arbitrary renaming of decision inputs. |
| Generic measurement profiles | Use a registry-driven input profile for the runner, but persist typed metric observations with units/provenance rather than opaque JSON. |
| Session outcome `passed/caution/failed` | Store immediate/later/next-morning facts first. Derive an evidence-only outcome with policy version and `unknown` when follow-up is missing. |
| Tissue-demand labels | Begin as coarse reviewed metadata for explanation/gating. Do not present them as tissue force or injury probability. |
| Substitution engine | Author/catalog defines alternatives and similarity metadata; the existing safety/feasibility gates prove the selected alternative before display. |
| One-variable-at-a-time progression | Record which dimension changed. Do not automate progression until historical comparisons demonstrate decision quality. |
| AI authoring | Parse only to a deterministic draft, show full interpretation, require athlete confirmation, and replay the normalized bytes rather than the model call. |

### Explicitly defer or reject

* ACWR-based injury classification, opaque injury probability and universal readiness/load
  scores are rejected.
* A relational/warehouse migration, bronze/silver/gold redesign and Databricks coupling are
  unrelated to the present client/Firestore boundary and are deferred indefinitely.
* Force-plate, timing-gate, GPS and VBT vendor integrations, automated video timing and
  coach/team mode require separate capability plans after manual entry and protocol
  provenance work.
* Automatic benchmark scheduling, progression, exposure-response learning and
  individualized tissue thresholds are evidence programs, not MVP form fields.
* Broad push-notification automation is deferred; response capture can initially surface
  when the athlete next opens Today/Check-in.
* Official Garmin developer-program integrations are a separate spike. The existing Garmin
  ingestion and workout queue must not be casually replaced or conflated with an approval-
  gated external API program.

---

## 5. Target domain boundary

### 5.1 The seven records

```text
MovementDefinition / DrillDefinition
        what this activity is and which inputs/safety metadata apply

SessionDefinition (immutable revisions)
        what the author intended: blocks, doses, targets, variants, rules

SessionOccurrence
        where/when it is scheduled and what authority placed it

ExecutionPrescription (immutable start snapshot)
        the exact adjudicated variant the athlete saw at start

SessionExecution + ExecutionEntry
        what the athlete actually performed

MetricObservation + MeasurementProtocol
        what was measured and whether it is comparable

ResponseObservation
        immediate/later-day/next-morning reaction linked to the occurrence
```

The `Recommendation` points to the selected occurrence/source and carries the adjudication
audit. It does not own the authored definition, and the performed execution does not mutate
the recommendation.

### 5.2 Source and authority are separate

A session's source answers “where did the content come from?”:

```ts
type SessionDefinitionSource =
  | { kind: 'catalog'; workoutId: string; catalogVersion: string }
  | { kind: 'external_plan'; planId: string; revision: number; sessionId: string; contentHash: string }
  | { kind: 'manual'; definitionId: string; revision: number; contentHash: string };
```

An occurrence's authority answers “what should this do to today's selection?”:

```ts
type OccurrenceAuthority =
  | 'save_only'
  | 'scheduled_candidate'
  | 'replace_recommendation'
  | 'additional_session'
  | 'unplanned_log';
```

`save_only` creates no occurrence in practice and has no engine effect. `unplanned_log`
creates execution/history only. `replace_recommendation` is a date-scoped athlete-owned
selection that must be audited and adjudicated. `additional_session` invokes same-day
stacking/feasibility review; it cannot hide behind adherence.

ADR-0019's accepted D-SHIM explicitly says the synthetic `ext:` compromise should be
revisited when a second non-catalog consumer appears. Manual definitions plus a general
runner are that consumer. A successor ADR should replace the shim with this honest source
boundary while retaining every D-CANDIDATE/D-IMMUT/replay guarantee.

### 5.3 Session definition vocabulary

The composite-session analysis already established the minimum:

* block roles and execution mode (`sequential`, `circuit`, `alternating`, `superset`);
* repetitions, duration, distance and completion doses with exact/range bounds;
* bilateral/per-side/alternating laterality;
* kg, bodyweight, band, descriptive, %1RM, % technical max and relative-step load;
* RPE/RIR plus independent technical/velocity quality targets;
* rest ranges, tempo, cues, optionality and logging mode;
* alternative choice groups and bounded conditional actions;
* embedded segments versus separately scheduled companion sessions.

The attached requirements add:

* session intent (`training`, `testing`, `competition`, `rehab_return`, `recovery`,
  `skill_technical`);
* set/attempt role where relevant (`warmup`, `working`, `top`, `backoff`, `practice`,
  `test_attempt`);
* measurement profile references, not arbitrary per-step form definitions;
* valid/invalid/practice attempt status for testing;
* domain facets for sprint/COD/jump/contact exposure.

Do not add cluster, rest-pause, drop-set, force-plate and every theoretical set type to the
first schema just because the requirements list them. The v2 schema needs an extension
mechanism and versioning, not speculative UI for unused features.

### 5.4 Performed entries are domain-typed

An `ExecutionEntry` should have stable identity, `plannedStepId`, selected alternative,
timestamp, side, status and one typed payload:

```text
strength       reps + load + gauge + optional velocity observation
timed          duration + load/position where relevant
distance       metres + optional time
sprint         distance/splits + start/timing context + validity
cod            side + angle + approach/exit + time/completion + planned/reactive
jump/throw     attempts + native metric observations + validity
checkoff       completion for mobility, warm-up or low-value-to-measure steps
```

The runner uses a `measurementProfile` to choose controls. The stored data stays typed so
analytics and parsers do not depend on a UI component name.

---

## 6. Persistence and replay

The existing `strength_sessions` array shape has an important limitation documented in
`firestore.rules`: Firestore rules cannot validate every element of a variable nested list.
The v2 execution model should improve this rather than cloning the limitation.

Recommended user-scoped paths:

```text
users/{uid}/session_definitions/{definitionId}
users/{uid}/session_definitions/{definitionId}/revisions/{revision}
users/{uid}/session_occurrences/{occurrenceId}
users/{uid}/session_executions/{executionId}
users/{uid}/session_executions/{executionId}/entries/{entryId}
users/{uid}/measurement_protocols/{protocolId}
users/{uid}/metric_observations/{observationId}
users/{uid}/response_observations/{responseId}
```

Definition revisions remain immutable, content-hashed artifacts like external-plan
revisions. Occurrences own the Warsaw-local scheduled date and mutable placement state.
Execution headers own state and the immutable start snapshot. Individual entry documents
allow rules to validate their actual payload instead of trusting a variable nested array.

Existing v1 `strength_sessions` should remain readable through an adapter. Do not bulk
rewrite athlete history. New executions write v2 only after the cutover; overload history,
1RM derivation and manual-training measurement consume a version-neutral read model.

`DailyRecommendation` must persist the session source/occurrence and exact execution
prescription or immutable hash reference. These fields must join decision immutability,
archival revisions, audit creation and replay equality; otherwise the current
`externalPrescription` persistence gap simply reappears under a new name.

---

## 7. UX architecture

### Today

Today answers:

1. what to do;
2. why this session/variant is permitted today;
3. what changed from the authored plan;
4. which local/systemic constraint is limiting it;
5. how to start or resume.

When an execution is in progress, **Resume session** becomes global and dominant. Strength
must not remain hidden in Mobile More.

### Author

**Add workout** branches into Paste text, Build manually and Import structured JSON. These
are front doors to the same draft. Authoring is block-first; exercise fields adapt to dose
type; advanced condition/tempo/measurement fields stay collapsed until requested.

Before saving, the athlete chooses Save only, Schedule, Replace today, Add another session
or Start unplanned. The product explains the engine consequence beside the choice.

### Review import

Preview the executable workout, not only its calendar row. Required review includes
resolved exercise/drill identities, every material dose/side/optional field, variants,
condition signal/actions, narrative-only content, companion sessions and unresolved
items. Import cannot proceed through a blocking unresolved mapping.

### Execute

One general runner owns lifecycle, sync, block navigation, rest and condition actions.
Domain cards supply inputs:

* strength: load/reps/gauge and last comparable set;
* timed/isometric: time, side and load/position;
* sprint: rep, time/splits, rest and validity;
* COD: side/angle/entry structure and completion/time;
* jump/test: attempt, protocol, native observation and validity;
* check-off: one large completion action.

The runner records substitutions/omissions and never makes the athlete reinterpret source
prose during a set.

### Respond

Completion captures session RPE, pain/unusual response, completion and a short note in
roughly 10–20 seconds. Later-day and next-morning prompts are occurrence-linked and request
only relevant tissue regions/dimensions. Missing follow-up remains `unknown` and reduces
confidence; it is not imputed as a passed session.

### Progress/test

Training history and testing are visually separate. Training shows exposure and planned vs
performed trends. Testing locks the protocol, stores every attempt, distinguishes
practice/invalid/valid, and compares only compatible series. A new best outside a
comparable protocol is not a PR.

---

## 8. Engine boundary

The near-term work should improve **what the engine can adjudicate and explain**, not
silently change how it selects.

### Safe immediate consumers

* derive equipment and safety tags from resolved required steps;
* ensure optional steps do not block a whole session;
* prove every displayed alternative against eligibility before selection;
* apply existing readiness/clinical ceilings to structured variants;
* persist exact source, selected variant and athlete override reason;
* surface missing provenance/follow-up as lower confidence.

### Evidence-only additions

* domain exposure ledgers: acceleration reps, max-velocity distance, COD/deceleration
  contacts, elastic contacts, hard lower strength;
* protocol-aware performance trends;
* planned-versus-performed difference;
* immediate/later/next-morning response linkage;
* coarse tissue-demand metadata.

Initially these belong in audit/analytics/shadow reports. They must not change live
recommendations merely because a type and chart exist.

### Policy changes requiring a later decision

* step-derived cost/stimulus replacing current external modality × intensity × duration;
* strength execution activating `manualTraining` in the live engine;
* response-conditioned progression or substitution;
* domain-specific spacing/frequency thresholds;
* performance-test freshness changing session selection;
* inferred exposure-response tolerance.

Each needs real-history comparison, explicit coefficients/uncertainty, scenario evidence,
`POLICY_VERSION`, replay and a ship/no-ship decision. This preserves ADR-0014 D-FUSE,
ADR-0020 D-SUBJCAL and ADR-0021 D-STRCOST.

---

## 9. Delivery shape

This should be an incremental capability plan, not a big-bang “training operating system”
rewrite.

### Increment A — make the existing runner safe

Close the prior P1/P2 interaction findings and add visual/real offline coverage. This work
does not require the new domain schema and reduces risk for every later runner feature.

### Increment B — deterministic session foundation

Accept a successor ADR; implement definition/occurrence/execution/entry contracts,
Firestore rules/services, v1 read compatibility, source-neutral recommendation persistence
and replay.

### Increment C — manual authoring and external v2

Build the manual session builder, bounded exercise/variant/custom metadata, structured JSON
v2 adapter, full semantic preview, deliberate scheduling intent and catalog adapter.

### Increment D — mixed-dose execution and response

Generalize the runner to repetitions/time/distance/check-off, conditions, alternatives,
companion sessions, completion reflection and occurrence-linked delayed response.

### Increment E — speed/field/power and testing

Prove the model on a deliberately small representative taxonomy. Add sprint/COD/jump
performed inputs, then metric/protocol/comparison-series and test-attempt/benchmark flows.

### Increment F — measurement and policy candidates

Generate read-only exposure/quality-response reports. Compare candidate cost, stimulus,
progression and substitution rules against historical decisions. Only separately approved
candidates enter production.

Assisted prose import can follow Increment C because only then does it have a safe draft
boundary. Vendor integrations and coach mode should become separate plans after Increment
E demonstrates demand.

---

## 10. Cross-cutting acceptance outcomes

The consolidated design is successful when:

* the supplied full-body and lower/Olympic sessions can be represented without behavioral
  parsing from strings;
* the Friday field session records distance, side and completion without fake strength
  sets;
* imported and manually built versions reopen as the same execution prescription;
* an athlete can resolve a symptom/technical alternative without bypassing safety;
* an optional later recovery spin is independently started/skipped and reconciled once;
* a killed/reloaded offline session restores definition, selected variant, performed rows
  and pending/synced state;
* a sprint/jump/COD value cannot become a benchmark without protocol/source/validity;
* later-day and next-morning response link to the correct occurrence and missing response
  remains unknown;
* unknown custom movements are loggable but cannot claim precise safety/cost/stimulus;
* no new evidence dimension affects live selection until an explicit measured policy
  decision enables it.

The executable work is specified in
[`../plans/multidomain-session-authoring-execution-and-evidence.md`](../plans/multidomain-session-authoring-execution-and-evidence.md).

---

## 11. Final recommendation

Adopt the attached document as a product direction, not as one MVP checklist. The repo
already has a sophisticated adaptive authority layer and an evidence discipline worth
protecting. The most valuable next move is to make authored sessions durable and executable
across strength, time, distance and field attempts, then link performed work to protocol-
aware observations and delayed response.

The resulting foundation supports the long-term multidomain vision while remaining honest
about what the app knows today. It also prevents the two most expensive failure modes:
building rich dashboards on lossy logs, and activating plausible-looking coaching rules
before the system has evidence that they improve decisions.
