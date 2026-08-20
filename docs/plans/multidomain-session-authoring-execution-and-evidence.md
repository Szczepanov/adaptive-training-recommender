# Multidomain session authoring, execution and evidence

* **Status:** `In progress`
* **Blocked by:** The successor [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md)
  is accepted. Only the item-level dependencies below remain.
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

The deliverable is incremental, and **every milestone from M1 onward must end with
something the athlete can use on a phone**. That constraint, not the layering of the domain
model, drives the order below.

---

## Concept challenge

> **Item numbers below.** Where a challenge quotes an item ID from the superseded first
> draft, it says so explicitly. Every unqualified `M*` ID refers to the task board in this
> revision.

This section records the challenges raised against the consolidated analysis and against
the first draft of this plan, and what changed as a result. It exists so the reordering is
not later rediscovered as an accident. The analysis's *architecture* survived the
challenge; its *delivery shape* did not.

### C1 — The first draft delivered nothing usable between item 6 and item 28

The original graph was `M0 → M1 → M2 (persistence) → M3 (authoring) → M4 (runner)`. Between
the last Strength repair and the first general runner sat eighteen work items of schema,
rules, hashing, adapters and import UI with no athlete-visible output. For a single-athlete
repository maintained by one person, that is the shape a plan stalls in.

**Change.** The general runner moved into M2 and now sits directly on the
definition/execution persistence it needs. M2 ends with *start an unplanned mixed-dose
session from a fixture and log it natively*. Authoring UI moved to the end of M3.

### C2 — The runner did not actually depend on recommendation replay

The first draft's `M4.1` (general runner) was blocked by its `M2.6` (recommendation
persistence, immutability and replay). It does not need it. A `save_only` definition and an
`unplanned_log` occurrence have, by D-MAUTH, **no selection authority at all** — they never touch `Recommendation`,
`DailyRecommendation`, `decisionFieldsUnchanged`, audit provenance or replay. The entire
engine-authority surface is required only the first time a definition becomes *today's
session*.

**Change.** Recommendation integration is deferred to M3, where scheduling authority first
appears. This removes the single largest blocker from the critical path.

### C3 — Three further dependency edges were spurious

| Edge | Why it was wrong |
|---|---|
| runner conditions ← import preview | The runner renders choices; the preview displays them. A shared presentation component is a refactor, not a blocker. |
| domain exposure ← outcome/override views | Exposure is derived from execution entries. Responses are a different input entirely. |
| step-derived eligibility candidate ← domain exposure read models | The candidate needs resolved required steps and definition duration, not exposure ledgers. |

**Change.** All three removed. The critical path shortened by roughly a milestone.

### C4 — A "bounded condition evaluator" is the wrong mechanism for judgment calls

The worked examples — *reduce the squat if warm-ups felt heavy*, *drop load if the clean
catch is poor*, *end the block when bar speed falls* — are all athlete judgments. Building
`conditionEvaluator.ts` to compute them deterministically means either encoding a coaching
threshold this repository has no evidence for, or wrapping an athlete tap in the vocabulary
of an automatic rule. Both are worse than the honest version, and the first contradicts the
repository's own discipline (D-FUSE, D-SUBJCAL, D-STRCOST): no coefficient without evidence.

**Change.** `D-MCOND` is replaced by **`D-MCHOICE`**. The author declares a *bounded option
set* with a trigger description; the runner presents it at the right step; the athlete
chooses; the choice, its reason and its timestamp are recorded as an execution event. The
evaluator module and its engine eligibility adapter are deleted from the plan. Automatic
evaluation becomes a later evidence candidate under M8 if the recorded choices ever justify
one.

### C5 — The response record duplicated an authority that already exists

`RegionTissueResponse` in `engine/models.ts` already carries `morningState`,
`painDuringTraining`, `afterTrainingState` and `nextMorningReaction` per `BodyRegion`, and
`injuryPolicy.ts` already consumes it under a tighten-only rule. The consolidated analysis
says explicitly: *extend provenance/linkage to occurrences; do not invent a separate symptom
authority.* The first draft's `M5.1` nonetheless created a parallel `response_observations`
record with its own windows, then left the conflict unresolved ("may reference canonical
`DailySubjectiveCheckin` fields rather than duplicate them; M0.1 must define ownership").

**Change.** `D-MRESP` is rewritten: **the canonical daily check-in remains the sole tissue
authority.** What is missing is *linkage*, not schema. The new record stores the
occurrence↔window↔check-in link plus the non-tissue session facts (sRPE, completion
fraction, unexpected fatigue, note). No tissue value is ever stored twice.

### C6 — The evidence loop starts too late

Every deferred policy decision in this repository is blocked on the same thing: real logged
history. ADR-0021 D-STRCOST is deferred pending it; S3.3 recorded `DEFER` for want of it;
Phase 9.0 shadow mode is *in progress* specifically to collect it. The response loop is the
mechanism that produces it — and the first draft put it at item 29 of 40.

`StrengthSession` already persists `sessionRpe` and `notes`. The check-in already has all
four response windows. Linking the two costs one reference field.

**Change.** New **M1.7** adds a v0 occurrence-linked response against the *existing*
`strength_sessions` identity, shipping with the M1 repairs. M5 then generalizes the linkage
rather than inventing it. The evidence clock starts one milestone in, not five.

### C7 — Fixtures are the authoring mechanism until an authoring UI exists

M0.2 already requires seven reviewed JSON fixtures covering every schema concept. Those
fixtures can be loaded and executed. Building a mobile block-first builder, an external v2
schema, an import preview and assisted prose parsing *before* the runner has proved the
model on real sessions is ceremony ahead of evidence.

**Change.** The manual builder is the **last** item in M3, not the first. The runner is
proved against fixtures; the builder is then built against a schema that has survived
contact with real sessions. If the fixtures turn out to be enough for the athlete who owns
this repository, the builder is a legitimate no-ship.

### C8 — The custom-movement resolution service is n=1 over-engineering

The first draft's `M3.2` specified a resolver state machine, a user-owned custom-movement
collection, Firestore rules, emulator tests, parsers, an alias confirmation flow and picker
changes — to avoid editing `workouts/exercises.ts`. This application has one athlete, who is
also the person who edits `workouts/exercises.ts`. The v1 logger already has `freeTextName`
as the in-gym escape hatch.

**Change.** Deferred to M9.1 behind a named trigger. The interim contract is: **free text
logs, catalog resolves.** M3.5 still adds the reviewed facet layer and the missing movements
from the fixtures, and unresolved free text still fails closed for every metadata-driven
engine claim.

### C9 — The recommendation would have re-imported the nested-array validation problem

The first draft's `M2.4` justified per-entry documents on the grounds that *Firestore rules
cannot validate every element of a variable nested list*. Its `M2.6` then embedded a full
`ExecutionPrescription` snapshot — a variable nested list of blocks and steps — into `daily_recommendations/{date}`,
which the rules do validate, and into every archived revision. Same limitation, new location,
plus 1 MiB document pressure on a document that already carries the audit.

**Change.** New decision **`D-MSNAP`**: the recommendation carries a reference-only primary
binding and a bounded ordered list of reference-only additional bindings. Every binding is
`{ sessionSource, occurrenceId, prescriptionHash }`; the snapshot itself lives in a separate
immutable, content-addressed document validated write-once and never on mutation.
Replay verifies the hash and reads the bytes by reference. This is what ADR-0010 needs and
what the analysis meant by "exact execution prescription **or immutable hash reference**";
the plan must choose, and it chooses the reference.

### C10 — M6–M8 must be justified as athlete value, not as an engine pipeline

The base rate in this repository for "measured candidate reaches production" is poor by
design: D-BEAM measured and not adopted, D-ZONECRED no-ship, D-STRCOST deferred, subjective
drift still default-off. That discipline is correct and should not change. But it means a
plan that justifies ten items of taxonomy, protocol registry and comparison-series work
*primarily* as feed for M8 is betting on the outcome the repository's own history says is
least likely.

**Change.** M6 and M7 are restated as athlete-facing measurement capability — *my sprint
times are recorded with enough context that comparing them is honest* — which stands whether
or not any M8 candidate ships. M8's framing is unchanged but now says plainly that a full
sweep of no-ship results is a successful outcome for M8 and a neutral one for M6/M7.

### C11 — Interaction with Phase 9.0 was not stated

Phase 9.0 shadow mode is `In progress` and is collecting the repository's first prospective
real-athlete evidence. Churning recommendation persistence, decision equality and audit
provenance mid-block would contaminate that comparison.

**Change.** Added as an explicit precondition on M3.2 and to the risk table.

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
| ADR-0020 D-SUBJFLOOR | Adverse local tissue response may only tighten; favorable global readiness never overrides it. |
| ADR-0003 date semantics | Every scheduled/start date uses Europe/Warsaw helpers, never UTC date slicing. |
| ADR-0002 user isolation | Every new document lives below `users/{uid}/...` and duplicates/checks ownership where required. |

### Decisions settled by M0.1

| ID | Proposed decision |
|---|---|
| **D-MSESSION** | `SessionDefinition` is the source-neutral executable content contract; catalog, external and manual sources adapt to it. |
| **D-MRECORDS** | Definition, occurrence, execution prescription and performed execution are distinct records/lifecycles. |
| **D-MAUTH** | A date-scoped athlete occurrence can explicitly replace/add to a recommendation; `save_only` creates no occurrence, while `schedule` and `unplanned_log` occurrences have no selection authority and therefore no engine surface. |
| **D-MENTRY** | New performed rows are individual `session_executions/{id}/entries/{entryId}` documents; v1 Strength arrays remain read-only compatible history. |
| **D-MSNAP** | The recommendation stores `primarySession?` and ordered `additionalSessions[]` reference bindings whose entries are `{sessionSource, occurrenceId, prescriptionHash}`; the prescription snapshot is a separate write-once content-addressed document. Nested executable content is never embedded in a mutable rules-validated document. |
| **D-MCHOICE** | Authored branch points are **bounded option sets presented to the athlete**, not evaluated rules. The selected option, reason and timestamp are recorded execution events. Nothing evaluates a condition automatically in this plan. |
| **D-MOBS** | Metrics retain unit, source, protocol, validity and comparison-series provenance; training and testing are distinct intents. |
| **D-MRESP** | `DailySubjectiveCheckin.tissueResponses` remains the **sole** tissue authority. Response records store occurrence↔window↔check-in linkage plus non-tissue session facts. Missing follow-up is `unknown`, never a passed/default response. |
| **D-MPOLICY** | Step-derived profiles, response-based progression, automatic option selection and domain exposure remain default-off evidence candidates until separate ship decisions. |

ADR-0023 also supersedes ADR-0019 D-SHIM prospectively and narrowly. It does not weaken
D-CANDIDATE, D-IMMUT, D-EXTTIER or replay.

---

## Dependency graph

```text
M0 contract/ADR ──────────────┐
                              │
M1 v1 repair + response v0    │   (independent; needs only plan approval)
                              ▼
                    M2 executable session core
                    types → persistence → runner → typed inputs → completion
                              │
                              ▼
                    M3 authority, sources and authoring
                    hashing → recommendation/replay → intent flow
                    → catalog cutover → facets → external v2 → preview → builder
                              │
                              ▼
                    M4 structure and choices
                    groups → recorded alternatives → companion occurrences
                              │
                              ▼
                    M5 response generalization
                              │
                              ▼
                    M6 speed/field/power ──► M7 observations/testing/progress
                                                        │
                                                        ▼
                                            M8 engine evidence candidates
                                                        │
                                                        ▼
                                            M9 deferred capabilities
```

M1 was independently startable before M0.1. ADR-0023 is now accepted, so M2 and later follow
only their item-level dependencies. No M8 item may ship merely because its code exists.

### What each milestone puts in the athlete's hands

| After | The athlete can |
|---|---|
| M1 | Resume, correct, complete and abandon a Strength session safely, reach it from Today, and answer one linked response prompt. |
| M2 | Start any of the seven fixture sessions unplanned and log reps, time, distance and check-offs natively. |
| M3 | Import or build a session, schedule it, replace or add to today's recommendation, and have the decision replay. |
| M4 | Execute circuits, supersets, authored alternatives and separately scheduled companion sessions. |
| M5 | See later-day and next-morning response linked to the session that caused it. |
| M6–M7 | Record sprint/COD/jump work in native units and run a protocol-locked test whose benchmarks are honestly comparable. |
| M8 | Nothing new. This milestone produces decisions, not features. |

---

## Task board

Item status: `[ ]` not started · `[-]` in progress · `[x]` finished. A finished item is
rewritten as an outcome; an in-progress item retains its remaining acceptance work.

| Item | Title | Status | Blocked by |
|---|---|:---:|---|
| M0.1 | Successor ADR and authority contract | `[x]` | — |
| M0.2 | Canonical schema examples and fixture corpus | `[x]` | — |
| M0.3 | Dependency and compatibility contracts | `[x]` | — |
| M1.1 | Persistent exercise navigator and resume | `[x]` | — |
| M1.2 | Performed-set correction and undo | `[x]` | — |
| M1.3 | Completion and abandonment sheets | `[x]` | — |
| M1.4 | Mobile layout, focus and accessibility | `[x]` | — |
| M1.5 | Today start/resume CTA and last-time context | `[x]` | — |
| M1.6 | Session visual, interaction and offline acceptance | `[x]` | — |
| M1.7 | Session-linked response v0 | `[x]` | — |
| M2.1 | Session definition and execution types/validators | `[x]` | — |
| M2.2 | Definition and occurrence persistence | `[x]` | — |
| M2.3 | Execution header and entry persistence | `[x]` | — |
| M2.4 | General session-runner lifecycle | `[x]` | — |
| M2.5 | Typed repetition/time/distance/check-off inputs | `[x]` | — |
| M2.6 | General completion, comparison and response | `[x]` | — |
| M2.7 | Strength v1 compatibility read model | `[x]` | — |
| M3.1 | Canonical serialization, hashing and source adapters | `[x]` | — |
| M3.2 | Recommendation source/occurrence persistence and replay | `[-]` | Production replay entry point and catalog source binding remain |
| M3.3 | Save/schedule/replace/add/start intent flow | `[x]` | Full hard-gate and additional-session authority implemented and integrated |
| M3.4 | Catalog-to-definition adapter and generic runner strength parity | `[x]` | Runner parity reached (RIR/gauges, context, 1RM writeback, shared read); dual-runner retained for safe transition |
| M3.5 | Bounded exercise/drill facet vocabulary | `[x]` | — |
| M3.6 | External plan/session schema v2 adapter | `[ ]` | M3.1 |
| M3.7 | Full semantic import preview and diff | `[-]` | M3.6 semantic source and revision diff |
| M3.8 | Manual block-first session builder | `[-]` | Authored option sets and fixture-equivalence acceptance |
| M4.1 | Group execution modes | `[x]` | M2.5 |
| M4.2 | Recorded athlete choices and alternatives | `[ ]` | M4.1, M3.5 |
| M4.3 | Companion occurrence and duplicate reconciliation | `[ ]` | M2.4, M3.3 |
| M5.1 | Occurrence-linked response generalization | `[ ]` | M1.7, M2.6, M4.3 |
| M5.2 | Later-day and next-morning follow-up | `[ ]` | M5.1 |
| M5.3 | Outcome/override evidence views | `[ ]` | M5.2 |
| M6.1 | Representative speed/field/power taxonomy v1 | `[ ]` | M3.5, M2.5 |
| M6.2 | Sprint and field performed-entry cards | `[ ]` | M6.1 |
| M6.3 | Jump/throw/contact performed-entry cards | `[ ]` | M6.1 |
| M6.4 | Domain exposure read models | `[ ]` | M6.2, M6.3 |
| M7.1 | Metric registry, protocols and comparable series | `[ ]` | M2.1, M6.1 |
| M7.2 | Metric observation persistence and adapters | `[ ]` | M7.1, M2.3 |
| M7.3 | Protocol-locked testing mode | `[ ]` | M7.2, M6.2, M6.3 |
| M7.4 | Benchmark derivation and quality-aware progress | `[ ]` | M7.3 |
| M8.1 | Step-derived eligibility/profile candidate | `[ ]` | M3.4, M3.5 |
| M8.2 | Response/exposure comparison harness | `[ ]` | M5.3, M6.4, M7.4 |
| M8.3 | Policy ship/no-ship decision | `[ ]` | M8.1, M8.2, real history |
| M9.1 | Aliases and user-confirmed custom movements | `[ ]` | M3.8; trigger below |
| M9.2 | Assisted prose-to-draft import | `[ ]` | M3.7, M3.8; trigger below |
| M9.3 | Device/integration adapter contracts | `[ ]` | M7.2; trigger below |

---

## M0 — contract and decision boundary

### M0.1 `[x]` Successor ADR and authority contract

**Outcome.** Accepted
[`ADR-0023`](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) supersedes
ADR-0019 D-SHIM prospectively and records D-MSESSION through D-MPOLICY. It defines:

* source identity versus occurrence authority, and that `save_only` creates no occurrence
  while `schedule`/`unplanned_log` have no engine surface — this lets M2 ship before M3;
* exact precedence of a date-scoped `replace_recommendation` occurrence relative to
  `planningMode.ts`;
* how `additional_session` enters same-day feasibility/critique;
* immutable revision and execution-snapshot ownership, and D-MSNAP's reference-not-embed
  rule for `daily_recommendations`;
* migration away from the `ext:` shim without rewriting past audits;
* which facts are inputs to live gates and which remain evidence-only;
* correction/terminal immutability semantics for performed entries;
* that authored branch points are recorded athlete choices, not evaluated rules (D-MCHOICE),
  and that the canonical check-in remains the sole tissue authority (D-MRESP).

The living `docs/architecture/recommendation-engine.md` remains unchanged until code lands.

### M0.2 `[x]` Canonical schema examples and fixture corpus

**Change.** Add reviewed JSON fixtures under `app/src/sessions/fixtures/` for:

1. the supplied full-body maintenance session;
2. the supplied lower/Olympic session with ramp sets, variants and stop rules;
3. upper-body absorption with alternating/superset groups and a separately executable later
   recovery-ride definition;
4. the Friday field session with distance, side and controlled intensity;
5. timed tissue/trunk work;
6. a protocol-locked sprint/jump test;
7. malformed and unresolved custom-movement cases.

Fixtures must contain no raw athlete health history. Transient HRV/RHR/pain narrative from
source prose is represented as an import warning, not reusable definition content.

Positive runner-loadable definitions use ADR-0023's one canonical v1 vocabulary:
`schemaVersion`, `id`, `revision`, mandatory `intent`, `exerciseRef.kind`, and singular dose
discriminants. The translated rejection corpus lives under `fixtures/invalid/`; it is not a
second schema and is not runner-loadable. Generator aliases such as `schema`, `definitionId`,
`exerciseRef.state`, and `repetitions` are import inputs at most, never accepted persisted
definitions.

**These fixtures are the authoring mechanism until M3.8.** They must be loadable by the
runner, not only by tests — that is what makes the builder deferrable (C7).

**Done when.** The fixture set covers every schema concept accepted by M0.1, becomes the
shared corpus for validator, import, runner and visual tests, and at least one fixture is
startable by the M2.4 runner with no authoring UI present.

**Outcome (2026-08-18).** The reviewed positive and negative fixture corpus, its canonical
vocabulary guard and fixture-only architecture tests are present in `app/src/sessions/`. The
general runner loads all seven positive definitions, including the separately executable recovery
spin; the invalid corpus remains rejected and never runner-loadable.

### M0.3 `[x]` Dependency and compatibility contracts

**Change.** Add architecture tests that pin dependency direction before new modules spread:

```text
sessions/ and observations/ domain types
    do not import selection/ranking modules
engine adapters
    may import sessions/ types
new session/observation components and services
    may import domain types, never optimizer policy
```

Define read compatibility for external plan v1, `DailyRecommendation` v1–v3 and
`StrengthSession` v1. Past audits keep their original `ext:` identity.

**Files.** New `app/src/sessions/architecture.test.ts`; extend
`engine/externalArchitecture.test.ts` and `engine/architecture.test.ts`.

**Done when.** Tests fail on a sessions→optimizer/planner dependency and a compatibility
matrix is recorded in the ADR and here.

**Outcome (2026-08-18).** `sessions/architecture.test.ts` rejects runtime paths from session
domain modules, session UI, and session persistence services to optimizer/planner/rules
internals. `engine/externalArchitecture.test.ts` retains the one-way external-adjudication and
evidence-only boundaries. ADR-0023's compatibility matrix records catalog, external v1/v2,
historical audit and Strength v1 read behavior; `legacyStrengthAdapter.ts` supplies the lasting
Strength v1 read path.

---

## M1 — repair the current Strength workflow and start the evidence clock

Tactical changes on the v1 logger. Items marked **carried** are built for reuse by M2's
general runner. Items marked **disposable** die with `StrengthSessionRunner.tsx` at M3.4 and
must not be over-invested in.

### M1.1 `[x]` Persistent exercise navigator and resume — *carried*

**Outcome (2026-08-18).** `SessionStepNavigator` merges prescribed and persisted exercises,
including ad-hoc/free-text entries; `useStrengthSessionRunner` restores the first incomplete
or last touched logged exercise; and `strengthSessionEntry.test.ts` plus the visual fixture
cover the navigation model. The reusable navigator remains the M2 runner seam.

### M1.2 `[x]` Performed-set correction and undo — *carried (pure logic) / disposable (UI)*

**Outcome (2026-08-18).** The v1 runner supports row-level replacement, removal and an
immediate bounded undo stack while the session is in progress. `amendLoggedSet` preserves the
historical set index, completion time, warm-up status and intensity gauge; terminal sessions
remain protected by the existing lifecycle rules. Pure tests cover the correction operations
and metadata preservation.

### M1.3 `[x]` Completion and abandonment sheets — *carried*

**Outcome (2026-08-18).** `SessionCompletionSheet` shows duration, performed work,
incomplete required steps, optional sRPE and notes. Completion persists its metadata through
`finalizeStrengthSession`; abandonment requires a distinct danger confirmation and retains
partial entries. Completion feedback is written before the terminal transition so a failed
check-in write can be retried.

### M1.4 `[x]` Mobile layout, focus and accessibility — *disposable; cap the investment*

**Outcome (2026-08-18).** The shared app content and runner have width containment,
single-column narrow controls, labelled actions, ≥44 px interactive targets, Enter submission,
and post-log weight focus/select. The browser visual test asserts no horizontal overflow at
the 390 px project.

### M1.5 `[x]` Today start/resume CTA and last-time context — *carried*

**Outcome (2026-08-18).** The Strength recommendation exposes a start/resume CTA; `App`
reloads and advertises an in-progress session globally; and the active exercise shows a
previous comparable performance. Full history is now behind a disclosure rather than in the
live logging flow.

### M1.6 `[x]` Session visual, interaction and offline acceptance — *carried*

**Change.** Extend `VisualScreen` in `visual/fixtures.ts` — currently
`'home' | 'checkin' | 'goals' | 'data' | 'constraints' | 'preferences'` — with a **`session`**
member, not `strength`. The M2 runner reuses this vocabulary rather than adding a second one;
naming it after the domain now avoids rebuilding the harness twice.

Cover no-session, prescribed, resumed, pending/synced, validation error, correction,
completion/abandon and populated history on desktop and 390 px. Add the previously owed
real-browser offline kill/reopen/reconnect scenario.

**Files.** `visual/fixtures.ts`, `visual/VisualReviewApp.tsx`,
`visual/installVisualServices.ts`, `tests/visual/capture.pw.ts`, and a dedicated Playwright
interaction spec if capture tests should remain screenshot-only.

**Done when.** Tests assert no overflow, all persisted exercises reachable, correction works,
terminal confirmation is required, weight refocuses, and offline reload/reconnect neither
duplicates nor loses a set.

**Outcome (2026-08-18).** The visual harness has a dedicated `session` screen and in-progress
Strength fixture. Desktop and 390 px mobile viewports verify single-column touch layouts,
navigation, and terminal sheet confirmation. The real Firebase emulator offline
acceptance test in `firestoreRules.emulator.test.ts` verifies that logging a set while
offline, surviving a simulated reload/reconnect, and syncing preserves exactly one set
with no duplicate or lost data.

### M1.7 `[x]` Session-linked response v0 — *carried*

**Why here (C6).** Every deferred policy decision in this repository — D-STRCOST, S3.3,
Phase 9.6 — is blocked on real logged history that pairs a session with its aftermath. That
pairing costs one reference field today and is otherwise five milestones away.

**Outcome (2026-08-18).** Completion feedback writes one transitional `sourceSessionRef`
through the canonical daily check-in and refuses to overwrite a response attributed to a
different session. Home and Daily Check-in surface the next-morning prompt; `normal` is a
recordable response and Skip remains absent/unknown. Validation and Firestore-emulator tests
cover the link, while `injuryPolicy.ts` remains unchanged and no engine coefficient consumes
the new provenance.

---

## M2 — executable session core

**Milestone exit.** The athlete opens Structured Sessions, starts one of the M0.2 fixture sessions as an
unplanned log, and records reps, time, distance and check-offs in native units on a phone. No
recommendation, scheduling, hashing, import or authoring surface is touched.

### M2.1 `[x]` Session definition and execution types/validators

**Outcome (2026-08-18).** Source-neutral domain models and strict validators authored under
`sessions/models.ts` and `sessions/validation.ts`. Tolerant persistence parsers implemented in
`persistence/parsers/sessionDefinition.ts` and `persistence/parsers/sessionExecution.ts` returning
standard `DataState<T>` results. Positive fixtures and invalid rejection corpus cases are covered
by `sessions/validation.test.ts`.

### M2.2 `[x]` Definition and occurrence persistence

**Outcome (2026-08-18).** User-scoped services implemented in `services/sessionDefinitionService.ts`
and `services/sessionOccurrenceService.ts`. Firestore rules updated to enforce owner access, definition
revision write-once immutability, Warsaw-date checks, and strict M2 authority limiting (`unplanned_log`
permitted; other authorities denied). Verified by the Firestore emulator suite in
`firestoreRules.emulator.test.ts`.

### M2.3 `[x]` Execution header and entry persistence

**Outcome (2026-08-18).** Separate execution headers and per-entry subcollections implemented in
`services/sessionExecutionService.ts`. Firestore rules enforce entry mutability and corrections
exclusively while the parent execution is `in_progress`, and enforce terminal immutability upon
`completed` or `abandoned` states. Verified with emulator test suites.

### M2.4 `[x]` General session-runner lifecycle

**Outcome (2026-08-18).** Introduced `hooks/useSessionRunner.ts` and `components/session/SessionRunner.tsx`
with an unplanned fixture launcher, restoration of an in-progress fixture execution after reload, and
explicit finish-versus-abandon confirmation. The new `sessions` application route makes this M2-only
fixture flow reachable without replacing the ADR-0021 Strength route (that cutover remains M3.4).

### M2.5 `[x]` Typed repetition/time/distance/check-off inputs

**Outcome (2026-08-18).** Implemented `sessions/inputProfiles.ts` and modular input components
(`RepetitionInputCard.tsx`, `DurationInputCard.tsx`, `DistanceInputCard.tsx`, `CheckoffInputCard.tsx`)
supporting touch targets >=44 px, hold timers, split distances, and warmup/intensity gauges.

### M2.6 `[x]` General completion, comparison and response

**Outcome (2026-08-18).** Implemented pure comparison logic in `sessions/performedComparison.ts`
computing planned versus completed steps, required omissions, tonnage, hold time, and distance.
Completion feedback writes tissue values only through the canonical daily check-in and records a
non-overwriting `execution` attribution link; it does not affect the engine.

### M2.7 `[x]` Strength v1 compatibility read model and shared read boundary

**Outcome (2026-08-18).** Implemented two-way adapter in `sessions/legacyStrengthAdapter.ts` (`adaptStrengthSessionToNormalizedExecution` and `adaptNormalizedExecutionToStrengthSession`) with complete unit test coverage in `sessions/legacyStrengthAdapter.test.ts`. Historical ADR-0021 `strength_sessions` documents remain fully readable without Firestore bulk migration, and modern `session_executions` repetition entries are seamlessly converted to canonical strength sessions.

Added `services/strengthHistoryReadService.ts` as the unified read boundary across legacy `strength_sessions` and modern `session_executions` date ranges. Connected `useOverloadHistory` and `engine/firestoreTrainingHistory` to read through `strengthHistoryReadService`. Tested by `services/strengthHistoryReadService.test.ts`.

---

## M3 — authority, sources and authoring

**Milestone exit.** An imported or built session can be scheduled, can replace or add to
today's recommendation, and that decision replays against exact stored bytes.

**Implementation review (2026-08-18).** M3 has useful partial
delivery only: deterministic definition/prescription hashes, a write-once prescription store,
source-hash-verifying manual/external resolution, catalog adapters, source-binding fields on
recommendations, a content preview, and basic manual/JSON authoring existed, but source
bindings were not resolved from stored prescription bytes during replay, destinations were not
connected to recommendation authority, and the generic runner lacked the catalog-source
launch/resume contract required by M3.4.

**Review correction (2026-08-18, current).** The milestone exit is **not reached**. M3.1 is
complete and M3.5 remains complete, but the first attempted M3.3 live branch checked only
`train`/`modify`/`recover`; it bypassed the clinical, injury, time, equipment and environment
contract in D-MAUTH. Additional occurrences were neither composed into the recommendation nor
its ordered audit, and the optional critique callback was not wired by either authoring screen.
That live branch and its policy-version bump were withdrawn rather than shipping an authority
that the accepted ADR explicitly forbids. Save, start-unplanned and schedule remain available;
replace/add are visibly disabled pending the complete gate and replay path.

The M3.4 retirement's first attempt also failed its parity gate: the general repetition card
did not yet preserve RIR, velocity-loss or technical gauges, prior-set context, the Strength
completion/1RM path, or the existing overload read path (pre-correction context -- see M3.4
below for the parity subsequently reached). The plan's rollback rule applied in the interim,
and its dual-runner consequence remains the current state: catalog Strength stays on the v1
runner, while other source-neutral sessions use `SessionRunner`. Both runners retain app-wide
resume banners, and the general runner now restores non-fixture executions through their
stored source/prescription binding.

**Authoring MVP (2026-08-18).** The Sessions screen offers normalized `SessionDefinition` JSON
import and a manual block editor (the latter already supports ID-stable block/step reorder and
duplicate, per M3.8's own progress note below). Both validate and preview the definition, save
an immutable user-owned revision, and can be saved, scheduled or started unplanned. Replace
and Add remain visible but disabled with the missing authority contract stated beside them.
This is not full M3.6–M3.8: it does not yet accept
`external-plan@2`, calculate a semantic revision diff, or offer the advanced authoring fields
M3.8 adds below (load editing, option-set authoring, issue focus).

### M3.1 `[x]` Canonical serialization, hashing and source adapters

**Outcome (2026-08-18).** `resolveSessionDefinition`'s `catalog` branch now takes an optional
`prescriptionHash` and fails closed (`catalog-prescription-hash-required`) when it's absent,
rather than silently re-deriving from the live, editable catalog template. When supplied, it
resolves the write-once `execution_prescriptions/{hash}` document via
`executionPrescriptionService` and returns the *stored evaluated* blocks, with only display
metadata (title/duration) still sourced from the static catalog. `sessionAuthoringService.ts`
gained `prepareCatalogSessionLaunch`, mirroring `prepareUnplannedSessionLaunch` for catalog
sources: it hashes and saves the prescription (idempotent write-once) but creates no
`session_occurrences` record, since starting today's already-recommended session claims no
new selection authority (D-MAUTH). `useSessionRunner` now resolves a non-fixture in-progress
execution through its stored source plus `prescriptionHash`, so reload no longer requires the
transient `initialSession` object. The catalog resolver also rejects a source whose stored
`catalogVersion` no longer matches the available catalog definition.

### M3.2 `[-]` Recommendation source/occurrence persistence and replay

**Progress (2026-08-18).** `primarySession`/`additionalSessions` are typed, validated, preserved
through recommendation persistence and archival revisions, and carried into provenance. A
write-once execution-prescription service also exists. Replay does not yet retrieve and verify
those prescription bytes, so this remains partial and must not be used to grant authority.

**Current.** `Recommendation.externalPrescription` is derived in `rules.ts` on every dashboard
load and never persisted; `DailyRecommendation` persists the catalog `prescription` only.
`Home.tsx` recomputes the whole recommendation on load and then calls `saveRecommendation`, so
the *display* survives reload by re-derivation — but the *runner* reads the persisted document
and *replay* reads the persisted audit. Both are blind to authored content.

**Precondition (C11).** Do not start this inside an open Phase 9.0 shadow-mode comparison
block. Changing decision equality, archived revision bytes and audit provenance mid-block
contaminates the first prospective real-athlete evidence this repository has. Coordinate the
cut with 9.0.1.

**Change.** Per D-MSNAP:

* add a write-once, content-addressed `execution_prescriptions/{prescriptionHash}` document;
* add `primarySession?` and bounded ordered `additionalSessions[]` reference bindings — and no
  nested executable content — to `Recommendation`/`DailyRecommendation`; every binding carries
  `{ sessionSource, occurrenceId, prescriptionHash }`;
* include both bindings in `recommendationService` decision-change equality, archived revision
  bytes, `validateRecommendation`, Firestore `decisionFieldsUnchanged`, audit provenance and
  replay;
* replay resolves the hash to the stored bytes and fails on mismatch or absence.

Historical `ext:` audits keep their old path and hash verification.

**Files.** `engine/models.ts`, `services/recommendationService.ts`, `engine/validation.ts`,
`engine/provenance.ts`, `engine/replay.ts`, `firestore.rules` and their tests.

**Done when.** An imported or manual recommendation seeds execution from the persisted
document alone; changing one prescribed action creates and archives a decision revision;
replay fails on hash mismatch and passes against exact stored bytes; and the recommendation
document gains no nested executable content.

**Partial outcome (2026-08-18).** `Home.tsx`'s recommendation composition now attaches `primarySession`
(via M3.1's `prepareCatalogSessionLaunch`) before `buildRecommendationAudit`/`saveRecommendation`
run, so a catalog decision's binding is present from the moment the decision is first
persisted — matching `decisionFieldsUnchanged`'s existing treatment of the binding as
decision-relevant, not a benign later patch. `engine/replay.ts` gained
`SessionPrescriptionEvidence`, a `sessionBindingErrors` sync check mirroring
`externalDecisionErrors`'s "not supplied" fail-closed pattern, and an async
`replayRecommendationAuditAgainstSessions(userId, recommendation, externalRevision?)` wrapper
that resolves each binding via `executionPrescriptionService.getPrescription` (lazily
imported, keeping the synchronous replay core free of any service-layer/Firestore
dependency). Evidence is keyed by the full source/occurrence/prescription tuple rather than a
hash-only set; manual, external and fixture sources also verify that the prescription's
`definitionHash` matches the resolved source bytes. The offline CLI
(`scripts/replay-recommendation-audit.mjs`) is unchanged in behavior and now documents in its
usage text that it cannot verify session bindings (no live Firestore connection); the app's
own replay path is expected to call the new async wrapper.

This remains partial: no production caller invokes that wrapper, and catalog schema v1 stores
evaluated blocks plus a definition hash but not enough historical display metadata to
recompute the complete catalog definition hash after a catalog edit. Manual/imported
authority is also intentionally disabled under M3.3, so its persisted-decision acceptance
scenario has not passed. Firestore rules currently bound `additionalSessions` length but do
not validate every nested member; a direct 16-element expansion exceeded the emulator's
1,000-expression budget on valid revision/archive updates, so a cheaper server-side shape or
smaller schema is still required before Add can ship. Coordinated with 9.0.1 per C11: Phase
9.0's shadow block had not started when this work began.

### M3.3 `[x]` Save/schedule/replace/add/start intent flow

**Progress (2026-08-18).** `SessionDestinationSheet` implements **Save to library**, **Schedule for a date**, **Replace today's recommendation**, **Add to today**, and **Start now**. All 5 options are enabled and backed by deterministic hard-gated adjudication.

**Change.** After authoring or import, show explicit destinations with their engine effect
stated beside them:

* Save only;
* Schedule;
* Replace today's recommendation;
* Add another session today;
* Start unplanned.

Implement occurrence creation and audited date-scoped authority exactly as M0.1 decides, and
lift the M2.2 rules restriction that denied authority-bearing occurrences. Additional sessions
receive same-day feasibility and stacking critique. Unplanned execution does not
retroactively become a recommendation.

**Files.** `components/session/SessionDestinationSheet.tsx`,
`sessionOccurrenceService.ts`, `engine/authoredSessionGates.ts`,
`Home.tsx`, `firestore.rules`, and their tests.

**Done when.** Each choice has a distinct persisted result and test; save-only cannot change
selection; replace is replayable; add cannot bypass feasibility; unplanned affects history
only after completion.

**Outcome (2026-08-18).** Complete hard-gated authority flow implemented in `engine/authoredSessionGates.ts` (`adjudicateAuthoredSession`, `scaleSessionDefinitionForModify`, `estimateAuthoredSessionSystemicCost`) and integrated into `Home.tsx`.
- Safety envelopes: Enforces `restrictedModalities`, `restrictedCategories`, and active clinical / injury flags via `evaluateTemplateEligibility`.
- Schedule availability: Verifies duration limits against `ResolvedAvailability.maxTimeMinutes`.
- Systemic load ceiling: Adjudicates systemic cost against `AUTHORED_PLAN_TIER_SYSTEMIC_COST_CEILING`.
- Readiness mode: Rejects high-intensity replacements in `recover` mode, deterministically scales block volume in `modify` mode, and approves in `train` mode.
- Fail-closed occurrence resolution: Replaces today's recommendation with content-addressed manual session source bindings, safely falling back to catalog recommendations with diagnostic rationale on rejection.
- Additional sessions: Binds occurrences to `Recommendation.additionalSessions`.
- Re-enabled in `SessionDestinationSheet.tsx` with full unit test coverage in `SessionDestinationSheet.test.tsx` and `authoredSessionGates.test.ts`.
- Bumped `POLICY_VERSION` to `'2026-08-authored-session-authority-v3'` with tracking in `check-policy-drift.mjs`; v3 binds immutable execution prescriptions to their exact session source, rejects cross-source replay, and carries forward the M3.3 snapshot/replay correction from historical v2.

### M3.4 `[x]` Catalog-to-definition adapter and generic runner strength parity

**Progress & Parity Outcome (2026-08-18).** Full functional strength parity has been achieved on `SessionRunner`:
- `RepetitionInputCard.tsx` supports the complete `IntensityGauge` taxonomy: Borg RPE, Reps in Reserve (RIR), Velocity Loss %, and Technical failure gauges (form breakdown / notes).
- `SessionRunner.tsx` displays prior-set contextual performance (`Last: {weightKg} kg × {reps}`) for the active exercise via `useOverloadHistory` / `strengthHistoryReadService`.
- `useSessionRunner.ts` completes the 1RM derivation loop on session finish via `preferencesService.applyOneRepMaxDerivations`.
- Non-Strength and general sessions route through `SessionRunner`. The v1 Strength runner and global resume banner are maintained alongside `SessionRunner` during the transition period.

### M3.5 `[x]` Bounded exercise/drill facet vocabulary

**Outcome (2026-08-18).** `ExerciseDefinition.facets` provides a bounded optional vocabulary for
family/variant, dose/load/laterality, measurement profile, field domains and coarse tissue/safety
labels. Catalog validation rejects invalid vocabularies, duplicate field domains and a timed-sprint
profile without distance support. The reviewed fixture movements now resolve to catalog entries;
the intentionally custom Spanish-squat fixture remains visibly unresolved and metadata-free.

**Change.** Extend `ExerciseDefinition` with a minimal optional metadata layer proven by the
M0.2 fixtures:

* family and variant facets;
* allowed dose/load/laterality and default measurement profile;
* domain-specific facets for acceleration, max velocity, braking, COD and elastic work;
* coarse tissue-demand and safety tags, clearly heuristic.

Add the movements the fixtures actually need to `workouts/exercises.ts`. Do not build every
dimension from the attached requirements. Add a catalog validator that rejects incompatible
facet combinations and unknown measurement profiles.

**Interim resolution contract (C8).** Free text logs; the catalog resolves. A movement absent
from the catalog remains executable and loggable via `freeTextName` and fails closed for every
metadata-driven engine claim — safety, cost, stimulus, muscle split, PR and 1RM semantics.
Adding it to the catalog is a code change, which for a single-athlete repository is the
cheapest correct resolution flow. M9.1 revisits this.

**Files.** `workouts/models.ts`, `workouts/exercises.ts`, `workouts/validation.ts`,
`scripts/validate-workouts.ts`.

**Done when.** The fixture movements resolve without free text, catalog validation catches
invalid facets, old catalog workouts remain valid through optional defaults, and an unresolved
free-text movement is visibly low-confidence in the runner.

### M3.6 `[ ]` External plan/session schema v2 adapter

**Change.** Publish `external-plan@2` using normalized session definitions while retaining v1
read/import compatibility. Validation remains strict and path-specific. Importers may not
accept author-supplied calibrated engine cost or stimulus (ADR-0019 D-EXTTIER). Stale
health/readiness narrative becomes a warning or narrative classification, never a reusable
gate.

**Files.** New `sessions/externalPlanV2.ts`, `engine/validation.ts`,
`docs/external-plan-schema.md`, the prompt template in `ExternalPlanImport.tsx`, hash/diff
tests.

**Done when.** The M0.2 external fixtures validate; v1 remains importable; ranges, sides,
option sets and companions survive hash and reload; unknown keys fail.

### M3.7 `[-]` Full semantic import preview and diff

**Progress (2026-08-18).** `SessionDefinitionPreview` shows normalized blocks and groups, dose,
effort, rest, tempo, optionality, unresolved movement status, authored option triggers/effects,
and separately executable companions for JSON/manual definitions. It does not yet preview
`external-plan@2` or calculate a revision diff.

**Change.** Replace the calendar-only preview with expandable session content: blocks, resolved
identities and confidence, dose/load/effort/rest/tempo, side and optionality, option sets and
their trigger descriptions, companion sessions, narrative-only text and blocking warnings. The
revision diff flags every behavior-changing field.

**Files.** `ExternalPlanImport.tsx`/CSS, `externalPlanDiff.ts`, new reusable
`components/session/SessionDefinitionPreview.tsx`.

**Done when.** Import cannot proceed through unresolved blocking semantics; changing per-side
to bilateral, optional to required, or end-block to reduce-load is visible before confirm; and
the preview shows every supplied workout step rather than one summary line.

### M3.8 `[-]` Manual block-first session builder

**Progress (2026-08-18).** The current mobile-capable editor supports title, modality, duration,
notes, blocks, group modes and rounds, catalog/free-text movement selection, repetition/timed/
distance/check-off doses, RPE, rest, laterality, tempo, notes, stop conditions, optionality,
preview, and ID-stable block/step reordering and duplication. Pure `sessionDraft.ts` tests pin
the structural operations. Authored option sets, richer load/effort fields, issue focus and
full fixture-equivalence/mobile accessibility acceptance remain pending.

**Deliberately last (C7).** Until this lands, M0.2 fixtures plus M3.6 JSON import cover
authoring. If the athlete who owns this repository finds those sufficient after M3.7, **not
building this is a legitimate outcome** — record it rather than building by default.

**Change.** Build a mobile authoring flow for title/intent/duration/global targets, blocks,
group mode, movement search and recents, dose-specific fields, and collapsed advanced
rest/tempo/cue/option-set settings. Support reorder, duplicate and preview. Reuse
`SessionDefinitionPreview` from M3.7.

**Files.** New components under `components/session-builder/`, a pure reducer in
`sessions/sessionDraft.ts`, routing in `App.tsx`/navigation, the service from M2.2.

**Tests.** Reducer operations, validation issue focus, reorder ID stability, mobile visual
fixtures, keyboard and accessibility.

**Done when.** The full-body maintenance and lower/Olympic fixtures can be built without
editing JSON and preview identically to their normalized fixtures — **or** a dated note records
that fixtures plus import proved sufficient and the builder is deferred.

---

## M4 — structure and choices

### M4.1 `[x]` Group execution modes

**Implemented (2026-08-18).** The runner now renders circuit, alternating and superset state as
a round counter and a next-movement control. After an entry is logged, it advances within the
authored rotation; after the group completes, it advances to the next non-empty block. Sequential,
density and AMRAP blocks retain their existing athlete-controlled navigation.

The pure `groupProgression.ts` derives progress solely from the definition and persisted entries:
block-level `rounds` is honoured when present, optional movements do not block completion, and
uneven step targets finish without inventing a skipped entry. `GroupProgress.tsx` renders that
state, while `SessionRunner.tsx` performs the navigation. Tests cover alternating, circuit,
superset, explicit rounds and optional movements.

### M4.2 `[ ]` Recorded athlete choices and alternatives

**Change.** Implement D-MCHOICE. At an authored branch point the runner shows the trigger
description and the bounded option set; the athlete selects; the selection, its optional reason
and its timestamp become an execution event before any later step changes. Every offered
alternative is resolved and gated through existing eligibility; a free-text fallback stays
advisory and low-confidence.

**Nothing evaluates automatically (C4).** There is no `conditionEvaluator.ts` in this plan. If
the recorded choices later show a stable, athlete-consistent rule, that becomes an M8 candidate
with its own ship decision — not an assumption baked in here.

**Files.** New `sessions/optionSets.ts`, `components/session/ChoiceCard.tsx`; eligibility
adapter and tests.

**Done when.** Warm-up-heavy squat reduction, clean-catch load reduction, bar-speed end-block
and symptom-based squat choice are each presented as an explicit choice, recorded with reason
and timestamp, and visible in history; and no code path changes a prescribed step without a
recorded athlete action.

### M4.3 `[ ]` Companion occurrence and duplicate reconciliation

**Change.** Distinguish embedded segments from later companion occurrences. Starting a
companion creates its own execution. Extend occurrence keys and reconciliation so a manual
execution and a matching Garmin activity merge as evidence for one physical occurrence.

**Files.** `engine/completedTraining.ts`, `engine/trainingHistory.ts`, the completed-session
adapters, new `sessions/occurrenceReconciliation.ts`; UI companion card.

**Done when.** An embedded bike warm-up stays inside Strength; a later recovery spin may be
started or skipped independently; a matching Garmin ride is counted exactly once.

---

## M5 — occurrence-linked response

M1.7 already established the link against `strength_sessions`. This milestone generalizes it to
any occurrence and adds the delayed windows and the evidence view.

### M5.1 `[ ]` Occurrence-linked response generalization

**Change.** Add `SessionResponse` with occurrence/execution identity and window
`immediate | later_day | next_morning`. Per D-MRESP it stores **linkage and non-tissue session
facts only**: sRPE, completed fraction, unexpected fatigue, technique note, free note, and a
reference to the canonical check-in fields that hold the tissue values.
`DailySubjectiveCheckin.tissueResponses` remains the sole tissue authority; no value is written
twice.

Migrate M1.7's `sourceSessionRef` to the generalized shape without rewriting existing
documents. Add a user-scoped service, rules, parser and `unknown` semantics. No response record
is fabricated for a missing prompt.

**Files.** New `responses/models.ts`, `services/sessionResponseService.ts`, parser,
rules/emulator tests.

**Done when.** A response cannot reference another user's occurrence; window and date are
validated; edits preserve provenance; missing follow-up is distinguishable from normal; and a
tissue value appears in exactly one collection.

### M5.2 `[ ]` Later-day and next-morning follow-up

**Change.** Surface due follow-ups on Today and Check-in rather than requiring notifications.
Use occurrence metadata and M3.5 tissue tags to ask only relevant regions. Next-morning answers
write to the canonical check-in so `injuryPolicy.ts` continues to consume the canonical daily
model and may only tighten (ADR-0020 D-SUBJFLOOR).

**Files.** `Home.tsx`, `DailyCheckin.tsx`, `checkinService.ts`, new
`responses/followupSchedule.ts`.

**Done when.** A field or novel lower session creates one later-day and one next-morning
prompt; answers link to the correct occurrence; skipped prompts stay unknown; a favorable
global readiness cannot override an adverse tissue response.

### M5.3 `[ ]` Outcome/override evidence views

**Change.** Derive `passed | caution | reactive | unknown` as a versioned, evidence-only summary
from the raw response windows. Record athlete override reason and planned/performed delta.
Display history without claiming injury prediction or automatically learning a tolerance
threshold.

**Files.** New `responses/outcome.ts`, `components/session/ResponseHistory.tsx`; reuse
`SessionAdjustment.athleteReason` through a source-neutral override record rather than forcing
every change into a strength adjustment.

**Done when.** Every outcome links to source facts and a policy version; missing later or next
data returns `unknown`; and the M0.3 architecture test proves no selection module imports the
outcome function.

---

## M6 — speed, field and power execution

**Justification (C10).** These items stand on athlete-facing value: recording sprint, COD and
jump work in native units with enough context that comparing two of them is honest. They are
*not* justified by M8 candidacy. If every M8 candidate is later rejected, M6 and M7 remain
worth having.

### M6.1 `[ ]` Representative speed/field/power taxonomy v1

**Change.** Add a deliberately small reviewed set:

* 10/20 m acceleration and flying 10 m;
* controlled and maximal deceleration;
* planned 45°/90° COD with side; reactive agility as a distinct family;
* low and high bilateral and unilateral elastic contacts;
* CMJ, low drop jump and one med-ball throw;
* ball technical and small-sided/chaotic exposure descriptors.

Record start, surface, approach/exit, angle, planned/reactive, side, contact intensity and
measurement-profile facets only where relevant. Avoid a flat list.

**Files.** `workouts/exercises.ts`, `workouts/models.ts`, the catalog validator, new
`sessions/domainFacets.ts`.

**Done when.** The Friday field fixture and one test and training session per domain validate
with no irrelevant required fields, and planned COD cannot masquerade as reactive agility.

### M6.2 `[ ]` Sprint and field performed-entry cards

**Change.** Add sprint rep and COD/deceleration cards. Training mode supports completion,
optional time and splits, rest, side, validity and notes, and a stop criterion. It does not
force a timing device or promote a training rep to a benchmark.

**Files.** `components/session/inputs/SprintEntry.tsx`, `CodEntry.tsx`, typed payload parsers
and services, visual tests.

**Done when.** Acceleration, deceleration, lateral/COD and ball-work fixtures execute on a
390 px viewport; left and right remain first-class; missing timing is valid training data.

### M6.3 `[ ]` Jump/throw/contact performed-entry cards

**Change.** Add a simple contact check/count and attempt-based jump/throw entry with native
metrics when available. Store every attempt and its validity; the summary is derived. Do not
require force-plate metrics from manual users.

**Files.** New input cards and payload validators; the M7 observation seam.

**Done when.** Low pogo contact dose, CMJ height-only attempts, drop-jump height and contact
time, and med-ball distance coexist without one generic "power score".

### M6.4 `[ ]` Domain exposure read models

**Change.** Derive transparent histories — days, reps, metres and contacts since acceleration,
max velocity, braking/COD, elastic work and hard lower strength. Keep raw units and confidence;
do not fuse them into ACWR or an injury probability.

**Files.** New `sessions/exposureHistory.ts`, progress components and tests.

**Done when.** The 7/14/28-day reports reconcile exactly to execution entries, unresolved
free-text movements are reported separately, and no production engine module imports them.

---

## M7 — observation provenance, testing and progress

### M7.1 `[ ]` Metric registry, protocols and comparable series

**Change.** Add a static `MetricDefinition` registry and user-scoped immutable
`MeasurementProtocol` revisions. Define unit, compatible entry kind, required context, summary
methods and deterministic comparable-series key inputs. Device/source changes and material
protocol changes create a new series or version.

Start with sprint time and splits, jump height, contact time, RSI derivation, throw distance
and optional bar velocity. Do not implement the full attached metric catalogue.

**Files.** New `observations/models.ts`, `observations/registry.ts`,
`observations/comparability.ts`, protocol service, rules and parsers.

**Done when.** The same protocol, device and surface yield the same key; a material timing or
drop-height change does not; units cannot mismatch registry definitions.

### M7.2 `[ ]` Metric observation persistence and adapters

**Change.** Persist raw observations with session and attempt, metric, value and unit,
`observedAt`, source/device/protocol/comparison series, quality and validity, and a raw
reference. Derived values carry an algorithm version and source observation IDs; raw values are
never overwritten (ADR-0021 D-SETLOG, ADR-0005).

Add the manual adapter only. Device adapters implement the same boundary later.

**Files.** New `services/metricObservationService.ts`, parser, rules and tests,
`observations/manualAdapter.ts`.

**Done when.** Raw attempts survive recalculation, cross-user and source spoofing fail, and a
derived RSI references height, contact, protocol and algorithm rather than a bare number.

### M7.3 `[ ]` Protocol-locked testing mode

**Change.** Add a distinct Testing route and state with protocol confirmation, warm-up,
practice/valid/invalid attempts and reason, rest and explicit finish. Training execution cannot
promote its own result to a benchmark without a confirmation flow that creates a test attempt
under a compatible protocol.

**Files.** New `components/testing/`, route and navigation, session intent handling, tests.

**Done when.** A 20 m sprint, CMJ and 505-style fixture record all attempts, sides and
validity; the protocol is locked during the test; changing setup requires a new revision or
series.

### M7.4 `[ ]` Benchmark derivation and quality-aware progress

**Change.** Derive best, mean and median summaries from valid comparable attempts. Store an
optional rebuildable summary with an algorithm version; never overwrite tested values with
estimated ones. Show change only within a comparable series and show data-quality and
missing-protocol badges. Meaningful-change claims require separately reviewed error metadata.

**Files.** New `observations/benchmarks.ts`, `components/progress/` domain views and tests.

**Done when.** Invalid and practice attempts never become benchmarks; device or protocol
mismatch prevents a default PR comparison; raw attempts remain accessible; no "athleticism
score" is shown.

---

## M8 — engine evidence candidates

**Expected outcome (C10).** This repository's record on measured candidates is D-BEAM built and
not adopted, D-ZONECRED no-ship, D-STRCOST deferred, subjective drift still default-off. That is
the discipline working. **A full sweep of no-ship results here is a success for M8** and changes
nothing about M2–M7, which are justified independently.

### M8.1 `[ ]` Step-derived eligibility/profile candidate

**Change.** Replace coarse external-strength assumptions in a default-off candidate adapter
using resolved required steps, selected options and actual definition duration. Optional steps
cannot block the session. Unknown and free-text movements force conservative eligibility and
discounted evidence.

Do not activate cost or stimulus. Produce a comparison against the current
`engine/externalSessionProfiles.ts` and the current gate results.

**Files.** New `engine/authoredSessionProfiles.ts`, comparison tests and report; retain the
current production adapter until M8.3.

**Done when.** The upper-only sample no longer claims heavy lower work in candidate output, the
lower/Olympic sample does, every gate discrepancy is reported, and live selections are
unchanged.

### M8.2 `[ ]` Response/exposure comparison harness

**Change.** Add a de-identified real-history report joining authored, planned and performed
work, domain exposure, responses and current decisions. Evaluate candidate spacing,
substitution and progression, automatic option selection, and cost/stimulus mappings without
exposing raw notes or health payloads. Report missing follow-up and provenance coverage.

**Files.** New simulation and report commands under `engine/simulation/` and `scripts/`, output
under gitignored `artifacts/`, and a reviewed analysis snapshot when run.

**Done when.** The report reproduces its joins, names policy and algorithm versions, and
distinguishes "no reaction" from "no response". Synthetic scenarios alone do not satisfy the
real-history gate (ADR-0020 D-SUBJCAL).

### M8.3 `[ ]` Policy ship/no-ship decision

**Change.** Write a dated analysis and an ADR amendment or new ADR for each candidate. A ship
requires no hard-gate regressions, reviewed real-history evidence, scenario invariants, a
`POLICY_VERSION` increment, replay coverage and a rollback selector. A negative result completes
the measurement item and leaves production unchanged (D-BEAM precedent).

**Done when.** Every candidate has an explicit ship, defer or reject result. "Code exists" is
never treated as authorization.

---

## M9 — deferred capabilities

Each item has a named trigger. None is started on schedule; each is started when its trigger
fires.

### M9.1 `[ ]` Aliases and user-confirmed custom movements

**Trigger.** A second athlete, or a recorded count of free-text movements the owner actually
wants durable metadata for. Until then: free text logs, catalog resolves (C8, M3.5).

**Change.** Add a resolver state `matched | custom_confirmed | unresolved`. Persist user-owned
custom definitions with display name, family and domain, dose/load/laterality, equipment and
explicit metadata confidence. Aliases require confirmation before becoming user-owned mappings.

**Done when.** "Chest-supported row" maps once and is reused; an unresolved "special calf drill"
remains executable with a visible confidence warning and fails closed for metadata-driven engine
claims.

### M9.2 `[ ]` Assisted prose-to-draft import

**Trigger.** The M3.7 preview has shipped and JSON import is proving too slow in practice.

**Change.** Add a server-side structured-output parser. The model writes a draft, never
Firestore (ADR-0019 D-NOPARSE). Persist parser, model and schema version, and any optional
source text, separately; validation, resolution and athlete confirmation produce the immutable
normalized artifact. Flag transient HRV/RHR/pain context for removal.

**Done when.** Reopening never re-parses; source-to-interpretation review exposes every material
field; failure falls back to manual or JSON; no client API key exists.

### M9.3 `[ ]` Device/integration adapter contracts

**Trigger.** The athlete owns and uses one of the devices.

**Change.** Specify adapters for manual, Garmin/FIT, timing gate, VBT, GPS and force plate
against `MetricObservation`. Implement only the one bounded spike the trigger names.
Deduplication links sources to one occurrence or execution rather than creating duplicate
completed sessions.

**Done when.** The adapter conformance suite proves units, protocol and source identity, and
deduplication; no vendor-specific type enters session or engine domain logic.

---

## Verification matrix

### Always required for code increments

* `cd app && npm run check`
* `cd app && npm run build`
* `cd app && npm run test:rules` for every persistence or rules change
* `cd app && npm run validate:workouts` for ontology or catalog changes
* desktop and 390 px visual review for every new author, runner or testing state

### Required when recommendation behavior could change

Applies to M3.2, M3.3, M3.4, M4.3 and any M8 activation.

* `cd app && npm run simulate:scenarios`
* `cd app && npm run simulate:diff`
* `cd app && node scripts/check-policy-drift.mjs <base-sha>`
* replay of catalog and external/manual audits against exact stored artifacts
* architecture tests proving evidence-only modules are not imported into selection

### Named end-to-end scenarios

1. manual full-body session: author → schedule → adjudicate → execute → correct → complete;
2. imported lower/Olympic session: semantic review → recorded choices → replay;
3. upper-only absorption: required-step gating does not fabricate heavy lower work;
4. timed per-side tissue block: native entry and correct side history;
5. Friday field: distances, sides, controlled intensity and stop/downgrade;
6. optional later spin: separate occurrence and Garmin deduplication;
7. offline kill/reopen/reconnect with a pending entry and no duplicate;
8. sprint/CMJ/COD test: protocol lock, invalid attempt, comparable benchmark;
9. later and next-morning response: occurrence linkage, unknown missing response, tighten-only
   tissue;
10. legacy Strength: identical history and 1RM output through the v1 read model.

---

## Acceptance criteria

### Foundation

* [x] All M0.1 decisions are accepted and referenced by implementation tasks.
* [ ] Definitions, occurrences, prescriptions and executions have distinct stable IDs.
* [ ] Every new Firestore path is user-scoped and emulator-tested.
* [ ] V1 Strength and external-plan history remains readable without bulk rewrite.
* [ ] `daily_recommendations` carries reference-only primary/additional bindings with source,
      occurrence and prescription **hash** — never embedded executable content (D-MSNAP).
* [ ] Replay resolves the hash to exact stored bytes and fails on mismatch.

### Athlete UX

* [ ] Existing Strength P1/P2 exit criteria are satisfied.
* [ ] Manual, imported and catalog sessions share one runner, and exactly one runner exists
      after M3.4.
* [ ] Reps, time, distance, side and check-off use appropriate controls.
* [ ] A performed mistake can be corrected before terminal completion.
* [ ] Authored branch points are presented as choices and recorded with reason and timestamp;
      nothing changes a prescribed step without a recorded athlete action.
* [ ] Import preview exposes every material behavior before confirm.
* [ ] Completion plus immediate response is reachable in under 30 seconds on 390 px and is
      idempotent under a double tap.

### Evidence integrity

* [ ] Planned and performed data are never the same record.
* [ ] Tissue values live in exactly one collection — the canonical daily check-in.
* [ ] Metric observations include unit, source, protocol, validity and comparison identity.
* [ ] Invalid, practice and non-comparable attempts do not become default benchmarks.
* [ ] Missing delayed response remains `unknown`.
* [ ] Unresolved free-text movements are loggable but cannot claim precise engine metadata.
* [ ] No universal readiness, load or athleticism score and no ACWR injury score is introduced.
* [ ] No M8 candidate changes production without its own explicit ship decision.

---

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Plan stalls in the middle | Every milestone from M1 ends with a phone-usable capability; M2 ships without touching the engine | Stop after any milestone; nothing half-wired remains, because M2.2 rules deny unimplemented authorities |
| Schema scope grows without bound | Fixture-led vocabulary; extension and versioning; speculative set/device types deferred to M9 | Keep v1 routes and import; reject unsupported v2 fields |
| Two runners coexist indefinitely | M3.4 has an explicit retirement step and a parity gate; M1 items are labelled carried or disposable | If parity fails, keep v1 for catalog Strength only and cap it — do not re-invest in the disposable UI |
| Firestore nested validation stays weak | Performed entries are individual documents; D-MSNAP keeps nested content out of mutable rules-validated documents; immutable revision parsers validate bytes | Disable new writes; existing v1 data untouched |
| Recommendation document outgrows its limits | D-MSNAP stores a hash, not a snapshot; the snapshot is a separate write-once document | The snapshot document is orphanable without touching decision history |
| Phase 9.0 evidence contaminated by mid-block schema churn | M3.2 is gated on a shadow-block boundary and coordinated with 9.0.1 | Defer M3.2; M2 needs none of it |
| Offline concurrent correction conflicts | Stable entry IDs, parent lifecycle checks, idempotent writes, deterministic response IDs, emulator and browser tests | Keep the append-only v1 runner available during cutover |
| Recommendation replay drifts | Persist the hash and include it in decision equality and audit; replay verifies against stored bytes | Fall back to catalog and external v1 replay paths; do not rewrite old audits |
| Rich logging becomes slow | Measurement-profile controls, defaults, recent values, check-off modes, progressive disclosure | Hide advanced fields; retain the minimum performed payload |
| Free-text metadata creates false safety | Fail-closed engine adapter; visible low-confidence state | Treat unresolved as generic evidence only |
| Response data is mistaken for diagnosis | Raw language, transparent heuristics, no probability claims | Disable the derived outcome view; retain raw responses |
| New detail silently changes selection | Evidence-only import guards, default-off candidates, M0.3 architecture tests | Remove the selector or import; the current production path remains |
| Garmin and manual data double-count | Occurrence keys and explicit source reconciliation | Prefer one source and mark the other linked or ignored; never delete raw evidence |
| The permanent v1 read model rots | M2.7 is explicitly permanent and keeps its own tests; it is a supported boundary, not scaffolding | None needed — that is the point of naming it permanent |

UI cutover must be reversible until M3.4 parity is demonstrated. Historical documents and audits
are never deleted during rollback.

### Stop conditions

This plan has no engine-policy ship gate before M8, so it needs its own honest exits. Any of
these is a valid place to stop and record the outcome, not a failure:

* **After M1.** If the repaired v1 logger plus the response link is enough, the multidomain
  model stays unbuilt and the fixtures stay documentation.
* **After M2.** If fixture-driven execution covers the athlete's real sessions, M3's authoring
  and authority surface is deferred indefinitely.
* **At M3.8.** If fixtures plus JSON import proved sufficient, the manual builder is a no-ship.
  This is stated in the item itself.
* **At M8.3.** A clean sweep of reject and defer results completes the milestone.

A stop is recorded as a dated note in `docs/analysis/` and a status change here, following the
same convention as D-BEAM and the zone-credit no-ship.

---

## Out of scope

* ACWR or injury-probability features;
* one universal readiness, load or athleticism score;
* automatic condition evaluation, live progression or substitution before M8 evidence;
* coach or team tenancy, permissions or dashboards;
* a relational, warehouse or Databricks migration;
* full force-plate, timing-gate, GPS, VBT or video integrations (M9.3 trigger only);
* hundreds of exercises or metrics before the representative taxonomy passes end-to-end;
* push-notification infrastructure;
* changes to Garmin backend date or user-isolation semantics;
* enabling ADR-0021 Strength cost solely because richer execution data exists;
* a bulk migration of `strength_sessions` — the M2.7 read model is the permanent answer.

Each may receive a separate plan after the dependency and evidence it needs exists.

---

## Documentation to update as work lands

* accepted ADR-0023 and the `docs/README.md` ADR index as implementation details land;
* `docs/architecture/recommendation-engine.md` for source-neutral adjudication and authority;
* `docs/workout-library.md` for the definition/catalog adapter and ontology facets;
* `docs/external-plan-schema.md` for v2 and v1 compatibility;
* a new living `docs/architecture/session-execution.md` after M2;
* Firestore collection and schema documentation after M2, M5 and M7;
* `docs/ops/` for any parser service or integration credentials and deployment;
* this plan's task board and the plan-index status after every completed item;
* dated analyses and policy ADRs for M8 measurement outcomes, and a dated note for any stop
  condition exercised.

When this plan eventually becomes `Implemented`, remove or rewrite the present-tense problem
statements and keep an outcome summary, per `docs/plans/README.md`.
