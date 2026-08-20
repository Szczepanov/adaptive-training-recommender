# Multidomain session authoring, execution and evidence

* **Status:** `In progress`
* **Blocked by:** The successor [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md)
  is accepted. Only the item-level dependencies and explicit usage triggers below remain.
* **Unlocks:** executable manual/external sessions; mixed strength/speed/field/power
  tracking; occurrence-linked response; protocol-aware testing when actually needed; evidence
  for later engine policy decisions.
* **Source analyses:**
  [`2026-08-18-multidomain-training-system-consolidated-analysis.md`](../analysis/2026-08-18-multidomain-training-system-consolidated-analysis.md),
  [`2026-08-18-strength-session-ui-ux-review.md`](../analysis/2026-08-18-strength-session-ui-ux-review.md),
  [`2026-08-18-authored-composite-session-import-and-execution.md`](../analysis/2026-08-18-authored-composite-session-import-and-execution.md),
  [`2026-08-19-product-scope-cutline-review.md`](../analysis/2026-08-19-product-scope-cutline-review.md).

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

**Current delivery cutline (2026-08-19, extended 2026-08-20).** The active product chain,
`M3.7 → bounded M3.8 hardening → M4.3 → M5.1 → M5.2 → M5.3`, is now complete end to end. M6
and M7 are not a sequential continuation of that chain. They are usage-triggered capability
groups: work starts only when real training or repeated testing exposes a concrete
limitation in the generic runner/evidence model. M8 may consume those capabilities if they
exist, but it must never be the reason to build them. Nothing on the evidence-producing
chain remains open; every further `M*` item now waits on its own named usage trigger.

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

### C12 — Capability numbering is not a delivery queue

The 2026-08-19 product-scope review challenged the remaining implicit assumption that, once
M5 lands, M6 and then M7 should follow simply because the IDs are sequential. M2 already
executes repetition, duration, distance and check-off doses. Building dedicated sprint/COD,
jump/throw/contact, metric-protocol and benchmark subsystems before real use proves those
controls inadequate would optimize for architectural completeness rather than athlete value.

**Change.** M6 and M7 gain explicit usage triggers and leave the near-term critical path.
M4.3 → M5.1 → M5.2 is the evidence-producing structural chain. M5.3 starts as a report/export
surface and only grows a dedicated history UI if the athlete actually uses it. M8 consumes
whatever real evidence capabilities have been justified independently; **M8 is not allowed to
pull M6/M7 forward just to make its own comparison harness richer**.

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

## Delivery graph and current cutline

```text
COMPLETED FOUNDATION
M0 contract/ADR
      ↓
M1 Strength repair + response v0
      ↓
M2 executable session core
      ↓
M3 authority / source normalization / authoring
      ↓
M4.1–M4.2 groups + recorded choices

ACTIVE PRODUCT CHAIN -- complete (2026-08-20)
M3.7 semantic preview ─┐
M3.8 bounded hardening ├──► M4.3 companion/dedup ─► M5.1 response model ─► M5.2 follow-up ─► M5.3 outcome report
                       │
                       └── M3.8 stopped bounded per its own cutline (load/effort/choices
                           shipped; rest ranges, quality fields, sessionTargets/
                           prohibitedAdditions editing deferred, JSON import covers them)

USAGE-TRIGGERED CAPABILITIES — NOT THE NEXT PHASE
real training gap ─► M6 speed/field/power specialization
repeated standardized testing need ─► M7 observations/testing/progress

EVIDENCE DECISIONS
M8 candidates may consume M5 and any independently-triggered M6/M7 evidence that exists.
M8 must not create the business/product justification for M6 or M7.

DEFERRED
M9 items start only when their own named trigger fires.
```

M1 was independently startable before M0.1. ADR-0023 is now accepted, so remaining work
follows item-level dependencies **plus the usage triggers stated below**. A satisfied code
dependency is not sufficient to start M6 or M7. No M8 item may ship merely because its code
exists, and no M8 item may force an otherwise-untriggered M6/M7 capability into scope.

### What each remaining milestone puts in the athlete's hands

| After | The athlete can |
|---|---|
| M3.7 | Review every behavior-changing imported-session field before confirmation. |
| bounded M3.8 | Build common real sessions without JSON; hardening stops when that workflow is sufficient. |
| M4.3 | Start companion sessions independently without double-counting the same physical work from Garmin/manual evidence. |
| M5.1–M5.2 | Record and revisit immediate/later-day/next-morning response linked to the exact session occurrence. |
| M5.3 | Export/inspect a versioned passed/caution/reactive/unknown summary plus the planned-vs-performed delta for any completed session; a richer history UI remains optional and usage-triggered. |
| M6, **if triggered** | Capture field/speed/power details the generic runner demonstrably cannot represent. |
| M7, **if triggered** | Run repeated protocol-locked tests whose benchmark comparisons are honest. |
| M8 | Nothing new. This milestone produces evidence-backed ship/defer/reject decisions, not features. |

---

## Task board

Item status: `[ ]` not started · `[-]` in progress · `[x]` finished. A finished item is
rewritten as an outcome; an in-progress item retains its remaining acceptance work.

| Item | Title | Status | Blocked by / trigger |
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
| M3.2 | Recommendation source/occurrence persistence and replay | `[x]` | Production replay wiring and catalog display-metadata fidelity closed |
| M3.3 | Save/schedule/replace/add/start intent flow | `[x]` | Full hard-gate and additional-session authority implemented and integrated |
| M3.4 | Catalog-to-definition adapter and generic runner strength parity | `[x]` | Runner parity reached (RIR/gauges, context, 1RM writeback, shared read); dual-runner retained for safe transition |
| M3.5 | Bounded exercise/drill facet vocabulary | `[x]` | — |
| M3.6 | External plan/session schema v2 adapter | `[x]` | Schema, validation, resolver/display wiring, export support shipped; M3.7's fine-grained diff remains |
| M3.7 | Full semantic import preview and diff | `[x]` | — |
| M3.8 | Manual block-first session builder | `[x]` | — |
| M4.1 | Group execution modes | `[x]` | M2.5 |
| M4.2 | Recorded athlete choices and alternatives | `[x]` | M4.1, M3.5 |
| M4.3 | Companion occurrence and duplicate reconciliation | `[x]` | — |
| M5.1 | Occurrence-linked response generalization | `[x]` | — |
| M5.2 | Later-day and next-morning follow-up | `[x]` | — |
| M5.3 | Outcome/override evidence report | `[x]` | — |
| M6.1 | Representative speed/field/power taxonomy v1 | `[ ]` | **Usage trigger:** recurring real session needs domain detail the generic runner cannot represent; then M3.5, M2.5 |
| M6.2 | Sprint and field performed-entry cards | `[ ]` | M6.1 + a logged sprint/COD workflow proving generic distance/time inputs inadequate |
| M6.3 | Jump/throw/contact performed-entry cards | `[ ]` | M6.1 + recurring measured jump/throw/contact use |
| M6.4 | Domain exposure read models | `[ ]` | M6.2/M6.3 as applicable + enough history that an exposure view answers a real question |
| M7.1 | Metric registry, protocols and comparable series | `[ ]` | **Usage trigger:** repeated standardized testing/benchmarking begins; M6.1 only if that test needs its taxonomy |
| M7.2 | Metric observation persistence and adapters | `[ ]` | M7.1, M2.3 |
| M7.3 | Protocol-locked testing mode | `[ ]` | M7.2 + only the domain input cards required by the tests actually being run |
| M7.4 | Benchmark derivation and quality-aware progress | `[ ]` | M7.3 + enough repeated comparable attempts to make progress display useful |
| M8.1 | Step-derived eligibility/profile candidate | `[ ]` | M3.4, M3.5; evidence candidate only |
| M8.2 | Response/exposure comparison harness | `[ ]` | Real history + M5 evidence; consume M6/M7 only if those capabilities were independently triggered and the named candidate needs them |
| M8.3 | Policy ship/no-ship decision | `[ ]` | The evidence required by the specific candidate; do not build unused M6/M7 solely to satisfy this row |
| M9.1 | Aliases and user-confirmed custom movements | `[ ]` | M3.8; trigger below |
| M9.2 | Assisted prose-to-draft import | `[ ]` | M3.7, M3.8; trigger below |
| M9.3 | Device/integration adapter contracts | `[ ]` | device trigger below; activate the minimum M7 observation boundary only if required |

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

### M3.2 `[x]` Recommendation source/occurrence persistence and replay

**Progress as of 2026-08-18 (superseded by the 2026-08-19 outcome below).**
`primarySession`/`additionalSessions` were typed, validated, preserved through recommendation
persistence and archival revisions, and carried into provenance. A write-once
execution-prescription service also existed. Replay did not yet retrieve and verify those
prescription bytes at this point, so the milestone remained partial and was not used to grant
authority.

**Gap as of 2026-08-18 (closed below).** `Recommendation.externalPrescription` was derived in
`rules.ts` on every dashboard load and never persisted; `DailyRecommendation` persisted the
catalog `prescription` only. `Home.tsx` recomputed the whole recommendation on load and then
called `saveRecommendation`, so the *display* survived reload by re-derivation — but the
*runner* read the persisted document and *replay* read the persisted audit. Both were blind to
authored content.

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

This remained partial through 2026-08-18: no production caller invoked that wrapper, and
catalog schema v1 stored evaluated blocks plus a definition hash but not enough historical
display metadata to recompute the complete catalog definition hash after a catalog edit.
Manual/imported authority is also intentionally disabled under M3.3, so its
persisted-decision acceptance scenario had not passed. Firestore rules bound
`additionalSessions` length but did not validate every nested member; a direct 16-element
expansion exceeded the emulator's 1,000-expression budget on valid revision/archive updates,
so a cheaper server-side shape or smaller schema was required before Add could ship.
Coordinated with 9.0.1 per C11: Phase 9.0's shadow block had not started when this work
began (still true at the outcome below, so this stayed clear of C11 throughout).

**Outcome (2026-08-19).** All three remaining gaps closed, now that the completed M3.3
authority flow shipped the gate this was blocked on. In order:

* **Firestore rules.** `additionalSessions` now gets real per-element shape validation
  (source kind, non-empty `prescriptionHash`) rather than length-only, at both the
  top-level field (previously *unvalidated entirely* -- only `keys().hasOnly()` gated its
  presence) and the audit's copy. Fitting this in the expression budget needed two things:
  `decisionFieldsUnchanged()` was being evaluated three times over in the update rule
  purely because the rules language doesn't memoize function calls (now computed once via
  a `let` binding and threaded through, `canUpdateRecommendation()`); and additional
  session elements get a lighter structural check than `primarySession`'s full per-kind
  field rigor (still real validation -- shape, recognized source kind, non-empty hash --
  just cheap enough to unroll across elements; the client already applies the full
  per-kind check before any write reaches here). Bound dropped from 16 to 4 -- an isolated
  number with no other dependents, comfortably above what `adjudicateAuthoredSession`'s
  systemic-cost ceiling ever actually admits in one day.
* **Catalog display fidelity.** `ExecutionPrescription` gained an optional
  `displayMetadata` snapshot (title/summary/intent/dominantModality/duration) at
  catalog-launch time, included in `prescriptionHash`'s own covered content
  (backward-compatible: absent on older prescriptions, so their hash is unaffected).
  `resolveSessionDefinition`'s `catalog` branch now reconstructs the historical
  `SessionDefinition` entirely from the stored prescription and self-verifies by
  recomputing the hash the same way it was computed at write time, instead of always
  merging in live catalog metadata with `expectedDefinitionHash: null`. Falls back to the
  old live-catalog-merge behavior only for prescriptions written before this existed.
* **Production replay entry point.** `Home.tsx`'s two `saveRecommendation` call sites now
  fire an unawaited `replayRecommendationAuditAgainstSessions` self-check whenever the
  saved decision carries a session binding, following the exact non-fatal
  `.catch(console.warn)` idiom already used at both sites and the quiet-report shape
  `shadowLogService` already establishes elsewhere -- console-level only, no new UI
  surface, no persisted verification state.

Manual/imported authority is no longer disabled (the completed M3.3 authority flow shipped
the complete gate), so the milestone's `Done when` criteria are met.

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

### M3.6 `[x]` External plan/session schema v2 adapter

**Outcome (2026-08-19).** Shipped as designed, plus JSON/Zwift export support (not in the
original file list, added on request). `ExternalPlanSession`/`ExternalTrainingPlan`/
`EXTERNAL_PLAN_SCHEMA` in `engine/models.ts` are untouched and keep meaning v1 exactly as
before — the envelope fields (`gating`/`placement`/`priority`/`objectives`/`scaling`/
`isEvent`) are shared unchanged between schemas via extracted, reused validators
(`validateExternalSessionEnvelope`/`validateExternalPlanEnvelope`); only `prescription` is
replaced by an embedded `SessionDefinition` (`definition`). The session resolver, template
synthesis, gating/adjudication, scheduling/placement, plan diffing, and the import UI's
validate-before-save step are all schema-version-aware; every M0.2 fixture validates as a
v2 session's `definition` unmodified. Firestore rules needed a real fix, not a no-op:
`hasValidExternalPlanRevision()` hard-coded the v1 schema literal and would have silently
rejected every v2 write at the database layer — caught by re-running the emulator suite
rather than trusting the original "no rules change needed" assumption in this plan. Exporter-importer compliance was closed via `canonicalWorkoutAdapter.ts`, allowing workout
export JSON (`canonical_workout_v1`) to be directly pasted and converted into normalized
`SessionDefinition` instances within `SessionJsonImport.tsx`. Deferred to M3.7 as originally
scoped: fine-grained per-field content diffing for a v2 session (`externalPlanDiff.ts`
reports a coarse "the session content changed" for either schema).

### M3.7 `[x]` Full semantic import preview and diff

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

**Outcome (2026-08-19).** The two remaining gaps from the 2026-08-18 progress note are closed.

* **`external-plan@2` full-content preview.** `PlanPreview`'s per-session summary row now
  renders an expandable "Full session content" `<details>` (closed by default so the scannable
  list stays intact) that mounts the existing `SessionDefinitionPreview` against
  `session.definition` for every v2 session — the same block/step/dose/effort/option-set
  rendering JSON/manual authoring already had. v1 sessions are unaffected: `prescription` isn't
  a `SessionDefinition`, so the summary line remains their only preview, matching what the
  schema can express.
* **Fine-grained revision diff.** New pure `sessions/sessionDefinitionDiff.ts`
  (`diffSessionDefinitions`) replaces the coarse "the session content changed" line with
  block/step/choice-level rows, each tagged `behaviorChanging`. Per-side to bilateral,
  optional to required, dose/load/effort/quality/rest/tempo changes, an authored choice's
  actions changing (including the named end-block-to-reduce-load example), and added/removed
  blocks/steps/choices/options are all `behaviorChanging: true`; title/notes/summary/trigger
  wording are `false`. `externalPlanDiff.ts` calls it only when both the stored and pasted
  session are v2 (`isV2Session` on both sides) — v1's flat `ExternalPrescription` has no
  comparable block/step structure and keeps the coarse check, so the existing v1 diff test's
  literal "the session content changed" expectation still holds unmodified.
* **Blocking on unreviewed behavior changes.** Referential-integrity blocking (an option
  action's `targetStepId`/`targetBlockId` not resolving) was already enforced pre-preview by
  `validateSessionDefinition`, itself already called on every v2 session's `definition` inside
  `validateExternalTrainingPlanV2` — that half of the "Done when" line was already true going
  in. What was missing was making a *behavior-changing* diff impossible to scroll past: the
  preview now lists every fine-grained row inline under its session (⚠-prefixed and
  red-highlighted when `behaviorChanging`), and renders a checkbox — "I reviewed the N behavior
  changes marked ⚠ above" — that must be checked before **Import this plan** enables, whenever
  `behaviorChangeCount > 0`. A diff containing only cosmetic wording changes never shows the
  checkbox and never blocks.

**Review correction (2026-08-19).** A repo-owner review of `sessionDefinitionDiff.ts` found
four correctness issues, all fixed in a follow-up commit on this branch: `formatAction()`
rendered no `targetStepId`/`targetBlockId`, so a choice option re-targeted to a different
step/block printed identical before/after text; `sameJson()` used raw `JSON.stringify`,
so two semantically identical objects with differently-ordered keys (a real risk given the
import flow regenerates full plan JSON from an LLM on each revision) were reported as
changed; `formatDose('distance')` fabricated "0 m" for an unset distance; and the rest-change
message misattached its ` s` unit suffix to the literal `'none'`. A second review pass found
two further gaps, also fixed: `formatDose('distance')` omitted `sets`, so a sets-only change
on a distance dose produced identical text; and block/step comparison was purely by-id
(`byId()`-keyed maps), so swapping two existing blocks or steps — a real execution-order
change — produced no diff row at all and could bypass import acknowledgement. Both are now
detected via a same-membership, different-position check (`orderChanged`) layered on top of
the existing add/remove detection.

Verified by `sessions/sessionDefinitionDiff.test.ts` (identical-definition no-op, laterality
change in **both** directions, optional↔required, the end-block/reduce-load choice-action
swap, dose/load before/after formatting, **both** an added step + removed block and a removed
step + added block, distance-dose set-count changes, a same-membership block/step reorder
distinct from add/remove, no false-positive reorder when order is unchanged, structurally
identical objects with reordered keys producing no row, cosmetic-only wording producing zero
behavior rows) and `externalPlanDiff.ts`/`PlanPreview` cases in `ExternalPlanImport.test.tsx`
(a v2/v2 pair surfaces `contentChanges` and the "(see below)" summary suffix; a title-only v2
change stays cosmetic; an unchanged v2 definition produces no diff row; `PlanPreview`'s Import
button renders disabled with the acknowledgement checkbox shown for a behavior-changing diff,
and enabled with no checkbox for a cosmetic-only one) — the pre-existing v1 diff tests pass
unmodified. `sessions/architecture.test.ts` and `engine/externalArchitecture.test.ts` pass
unchanged (the new diff module only imports `sessions/models.ts`). Full `npm run check`
(typecheck, lint, unit tests, catalog validation) passes.

### M3.8 `[x]` Manual block-first session builder

**Progress (2026-08-18).** The current mobile-capable editor supports title, modality, duration,
notes, blocks, group modes and rounds, catalog/free-text movement selection, repetition/timed/
distance/check-off doses, RPE, rest, laterality, tempo, notes, stop conditions, optionality,
preview, and ID-stable block/step reordering and duplication. Pure `sessionDraft.ts` tests pin
the structural operations. Authored option sets, richer load/effort fields, issue focus and
full fixture-equivalence/mobile accessibility acceptance remain pending.

**2026-08-19 scope cutline.** This is now a **bounded hardening task**, not a mandate to expose
all `SessionDefinition` fields in UI. Finish only gaps required by the two representative real
fixtures and by safe mobile use. If JSON import plus the current builder covers normal authoring,
record the residual advanced fields as deferred rather than expanding the form for completeness.

**Deliberately last (C7).** Until this lands, M0.2 fixtures plus M3.6 JSON import cover
authoring. If the athlete who owns this repository finds those sufficient after M3.7, **not
building more is a legitimate outcome** — record it rather than building by default.

**Change.** Harden the existing mobile authoring flow for the missing representative-fixture
semantics: authored option sets where actually used, richer load/effort fields needed by the
fixtures, validation issue focus, and mobile accessibility. Preserve reorder, duplicate and
preview. Reuse `SessionDefinitionPreview` from M3.7. Do not add speculative editor controls.

**Files.** Existing components under `components/session/` / `components/session-builder/`,
`sessions/sessionDraft.ts`, routing in `App.tsx`/navigation, the service from M2.2.

**Tests.** Reducer operations, validation issue focus, reorder ID stability, representative
fixture equivalence, mobile visual fixtures, keyboard and accessibility.

**Done when.** The full-body maintenance and lower/Olympic fixtures can be built without
editing JSON and preview identically to their normalized fixtures — **or** a dated note records
that the current builder plus import proved sufficient and the remaining advanced controls are
deferred.

**Outcome (2026-08-19).** Built the two gaps the Change section actually named — "authored
option sets where actually used" and "richer load/effort fields needed by the fixtures" — then
stopped there per the cutline's own instruction not to expand the form for completeness.

* **Load editor.** Every well-defined `SessionLoad` kind the fixtures use is now editable:
  bodyweight, mass (kg), % of max, % of 1RM, resistance band, descriptive (free-text "last
  reviewed load"), and unloaded. `relative_step` is exposed as a labelled option but not yet
  field-editable (no fixture uses it and it needs a same-block step picker; deferred, not
  silently dropped).
* **Effort.** The RPE-only field became an effort-kind selector (none/RPE/RIR) with a target
  input — fixture 01's back squat and bench press steps both prescribe RIR, which the builder
  could not previously express at all.
* **Authored choices (D-MCHOICE).** A block-scoped "Authored choices" editor: add/remove a
  choice, edit its trigger description and which step it applies at, add/remove options per
  choice, edit an option's label, and add/remove/edit that option's actions (all seven
  `SessionChoiceAction` kinds, via `sessionDraft.ts`'s new `createDraftAction` factory scoped to
  the authoring step/block so a freshly added `end_block`/`select_alternative` action is
  structurally valid the instant it's added, not just once every field is filled in).
* **Step alternatives.** A per-step alternatives editor (catalog-or-free-text movement, title)
  so `select_alternative` actions have somewhere real to point — fixture 01's
  warm-up-heavy-squat/symptom choices both depend on this.

New pure factories in `sessions/sessionDraft.ts` (`createDraftChoice`, `createDraftOption`,
`createDraftAlternative`, `createDraftAction`) carry the default-value logic and are unit
tested directly (`sessionDraft.test.ts`); `ManualSessionBuilder.tsx` wires them through the
same immutable block-array update pattern the existing step/block editors already use, keyed by
choice/option id rather than index since an option's action list changes length independently
of its siblings. `ManualSessionBuilder.test.tsx` (new; this repo has no interactive
component-test harness, so it's a markup-level smoke test matching the existing convention for
sibling session components) confirms the new controls render.

**Deferred, not built (recorded rather than silently dropped, per the cutline's own escape
hatch).** Full fixture-equivalence with fixtures 01/02 needs more than this: `rest` stays a
single number in the builder (fixtures use `{min, max}` ranges), `quality`/technical stop-rule
fields have no editor (and are already unvalidated/loosely typed even in the canonical fixture
JSON — a pre-existing model/fixture mismatch outside this item's scope, flagged separately
rather than fixed here), and session-level `sessionTargets`/`prohibitedAdditions` have no UI.
None of these block authoring a real session — every fixture remains buildable via JSON import
(M3.6), and a built session that skips these fields is still a valid, executable
`SessionDefinition`; they are narrower prescription-fidelity gaps, not missing capability. Given
the athlete who owns this repository already has working JSON import, expanding the form to
close every one of these before real use demonstrates a need would be exactly the "building by
default" the cutline warns against (C7).

Verified by `sessionDraft.test.ts` (8 new cases covering every factory), the new
`ManualSessionBuilder.test.tsx`, and a full `npm run check`-equivalent pass (typecheck, lint,
1654 unit tests, catalog validation) with no regressions.

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

### M4.2 `[x]` Recorded athlete choices and alternatives

**Change.** Implement D-MCHOICE. At an authored branch point the runner shows the trigger
description and the bounded option set; the athlete selects; the selection, its optional reason
and its timestamp become an execution event before any later step changes. Every offered
alternative is resolved and gated through existing eligibility; a free-text fallback stays
advisory and low-confidence.

**Nothing evaluates automatically (C4).** There is no `conditionEvaluator.ts` in this plan. If
the recorded choices later show a stable, athlete-consistent rule, that becomes an M8 candidate
with its own ship decision — not an assumption baked in here.

**What already exists (2026-08-19 audit).** The schema and rules groundwork for this milestone
was already laid, ahead of the runner: `sessions/models.ts` already defines
`SessionChoiceAction`, `SessionOption`, `SessionChoice` and `SessionBlock.optionSets`;
`sessions/validation.ts` already validates `optionSets` structure and action-kind vocabulary;
`SessionEntry.selectedOptionId` and `firestore.rules`' entry-payload validator already accept it;
and fixtures 01/02 already carry one `optionSets` choice each (clean/floor-speed quality). What
is entirely missing is the *runtime*: nothing renders a `SessionChoice`, nothing applies a
`SessionChoiceAction`, and no `SessionEntry` payload shape exists to record one being answered.
This item is that runtime.

**Design.**

1. **A new entry payload records the event, reusing the existing entries subcollection.**
   `SessionEntry` already carries `stepId`/`selectedOptionId`/terminal-immutability semantics
   (M2.3/M2.5) — a choice is another kind of thing that happened during execution, not a new
   record lifecycle (D-MRECORDS is about distinct *lifecycles*, and this one is identical to an
   entry's). Add to `sessions/models.ts`:
   ```ts
   export type ChoiceEntryPayload = {
       kind: 'choice';
       choiceId: string;   // SessionChoice.id
       optionId: string;   // SessionOption.id selected
       reason?: string;
   };
   ```
   and include it in `SessionEntryPayload`. `payload.optionId` is authoritative;
   `SessionEntry.selectedOptionId` continues to mirror it so the field already validated by
   `firestore.rules` and consumed by any future query stays meaningful. `sessions/validation.ts`
   gets a matching branch: `choiceId`/`optionId` must resolve to a real `SessionChoice`/
   `SessionOption` reachable from the entry's block, `reason` if present is a string.
   `app/firestore.rules`' entry-payload validator (`users/{userId}/session_executions/{id}/entries/{entryId}`)
   gets one more `payload.kind` branch — `keys().hasOnly(['kind', 'choiceId', 'optionId', 'reason'])`
   — no new collection, no change to the existing in-progress-only mutability rule.

2. **Actions are derived, never applied to stored bytes.** ADR-0010 replay requires the
   persisted `SessionDefinition`/`ExecutionPrescription` to stay exact; a choice must not mutate
   it. Add pure `sessions/choiceResolution.ts`:
   ```ts
   export interface EffectiveSessionView {
       definition: SessionDefinition;      // same block/step array shape and order; fields overridden in place
       endedBlockIds: ReadonlySet<string>;  // navigation shortcut only
       sessionEnded: boolean;               // navigation shortcut only
   }
   export function resolveEffectiveSession(
       definition: SessionDefinition,
       entries: readonly SessionEntry[],
   ): EffectiveSessionView
   ```
   It folds every `choice`-kind entry's resolved `SessionChoiceAction[]` (looked up from the
   original, immutable `definition` — never from a prior derived state) into an accumulator, in
   entry order, later choices winning on a shared target field:
   * `select_alternative` — overwrite the target step's `exerciseRef`/`dose`/`load` from the
     matching `StepAlternative`, and set `step.resolutionNote` (the field already exists, used
     today for unresolved free text) to name the substitution for display.
   * `reduce_load_percent` — scale whichever numeric load field the step's `SessionLoad` carries
     (`mass.kg`, `percent_max`/`percent_one_rm.percent`, both range-aware); a no-op, not a
     failure, on `bodyweight`/`band`/`descriptive`/`unloaded` loads.
   * `reduce_sets` / `reduce_reps` — override the target `RepetitionDose`'s `sets`/`reps`; a
     no-op on any other dose kind.
   * `omit_step` — set the target step's `optional = true`. This is the whole mechanism: it
     makes the step invisible to `groupProgression.ts`'s `requiredSteps()` and to
     `performedComparison.ts`'s required-omission accounting for free, with no signature change
     to either — both already treat `optional` steps as not blocking completion.
   * `end_block` — mark every not-yet-logged step in the target block `optional = true` (same
     free ride through the two modules above) and add the block to `endedBlockIds`, which
     `useSessionRunner`'s `nextStep()` uses only as a UX shortcut to jump straight to the next
     block instead of stepping through now-optional steps one at a time.
   * `end_session` — mark every not-yet-logged step across all remaining blocks `optional = true`
     and set `sessionEnded = true`, which the runner uses to route straight to
     `SessionCompletionSheet`.

   The effective `definition`'s `blocks[].steps[]` array must keep the exact shape and order of
   the original — only fields are overwritten in place — because `activeBlockIndex`/
   `activeStepIndex` in `useSessionRunner` are raw array indices; inserting or removing an
   element would desync navigation state after a reload.

   `useSessionRunner` computes `effectiveView = useMemo(() => resolveEffectiveSession(definition, entries), [definition, entries])` once and threads `effectiveView.definition` everywhere `comparePlannedVsPerformed`/`getGroupProgress`/step rendering currently receive the raw `definition` — both of those pure functions already take a `definition` parameter, so this is a call-site change, not a signature change.

   **Scoping decision.** A choice fires once per `choiceId` per execution — the runner treats a
   choice as due only while no `choice`-kind entry with that `choiceId` exists yet. Nothing in
   the current fixtures repeats a choice across rotation rounds, and re-prompting on every round
   of a `circuit`/`alternating`/`superset` block is a different, unrequested feature; if an
   authored session later needs a per-round choice, that is a follow-on to this item, not an
   assumption built into it now.

3. **Alternatives are gated through the existing per-exercise safety facets, not a new
   judgment.** `components/session/*` and `hooks/*` may import any `engine/*` module that is not
   `optimizer`/`planner`/`rules`/`weeklyAllocation`/`evergreenPlanning`/`sequenceSearch` — the
   exact boundary `sessions/architecture.test.ts` already checks (see Tests below for the one
   gap in that check).

   **Correction found during implementation.** The original text here proposed matching the M3.5
   `ExerciseDefinition.facets.safetyTags` heuristic labels against `TrainingSettings.guardrails`
   (`Record<GuardrailKey, boolean>`), the same way `evaluateTemplateEligibility` gates a
   `SessionTemplate`. That doesn't hold up: `facets.safetyTags` is a free-text, tissue-style
   vocabulary (`'knee_swelling'`, `'painful_deep_knee_flexion'`) — the same values as
   `ExerciseDefinition.contraindicationTags` — not `GuardrailKey`'s `'avoid_*'` vocabulary, so
   the intersection would type-check only via an unsound cast and would silently match nothing at
   runtime. Worse, neither `facets.safetyTags` nor `contraindicationTags` has any other live
   consumer in the engine today — `engine/planningCandidate.ts` only surfaces
   `contraindicationTags` as descriptive text for an external plan's candidate description.
   Building a gate on either would look like a safety check without being one.

   Add `engine/sessionChoiceEligibility.ts` gating on the one signal that is both real (already
   resolved from active `InjuryConstraint[]`) and expressible on a bare alternative — its
   resolved catalog exercise's `modality`:
   ```ts
   export function ineligibleAlternativeOptionIds(
       definition: SessionDefinition,
       restrictedModalities: readonly SessionTemplate['modality'][],
   ): Set<string> // SessionOption.id values that must not be offered as selectable
   ```
   `resolveInjuryRestrictions` (`engine/injuryPolicy.ts`) already resolves `restrictedModalities`
   in the capitalized `SessionTemplate['modality']` vocabulary; `ExerciseDefinition.modality`
   (`workouts/models.ts`) uses the separate lowercase `WorkoutModality` vocabulary. The two name
   the same real modalities, so the function carries a small `WORKOUT_TO_TEMPLATE_MODALITY`
   lookup table to bridge them — a vocabulary bridge, not a second judgment.
   Category-level (`restrictedCategories`) gating is intentionally **not** checked here: a single
   exercise carries no `SessionTemplate` category, and the whole session already passed that gate
   once at M3.3's `adjudicateAuthoredSession`. An alternative whose `exerciseRef.kind ===
   'unresolved_free_text'`, or whose catalog id doesn't resolve, is never flagged ineligible
   (unresolved free text is a legitimate C8 escape hatch); it renders as an ordinary option.

   Threading: `App.tsx` does not build a `UserContext` at the scope `SessionRunner` mounts in,
   and pulling the full engine context pipeline into a UI runner is heavier than this needs.
   `useSessionRunner` instead reads `trainingSettingsService`'s persisted settings plus today's
   `checkinService.getCheckin` (already imported here for the M1.7 response link) and calls the
   already-existing `resolveEffectiveInjuryConstraints`/`resolveInjuryRestrictions` from
   `engine/injuryPolicy.ts` — the exact same resolution `mapContextFromGoalsAndTrainingSettings`
   performs for the day's recommendation — to get `restrictedModalities`, then calls
   `ineligibleAlternativeOptionIds`. Recomputed once per session start/restore (it only depends
   on the day's resolved constraints and the definition's authored alternatives), not on every
   logged entry.

4. **UI.** New `components/session/ChoiceCard.tsx`: renders when the active step has an
   unanswered due choice (per the scoping decision above) on the current `SessionBlock.optionSets`.
   Shows `choice.trigger.description`, then each `option.label` as a button — an option whose
   only action is `select_alternative` into an ineligible alternative is shown disabled with the
   restriction named, never silently offered as equal to an eligible one. Selecting an option
   opens an optional one-line reason field (mobile-first, per M1.4/M1.6: one tap answers it,
   the reason is not required to proceed) and calls a new `logChoice(choiceId, optionId, reason?)`
   on `useSessionRunner`, mirroring `logEntry`'s write path through
   `sessionExecutionService.logEntry` with a `choice`-kind payload. `SessionRunner.tsx` blocks
   the step's other input controls until a due choice is answered — "no code path changes a
   prescribed step without a recorded athlete action" means the runner cannot let the athlete
   log a set past an unanswered branch point. The step's own entry list (already rendered per
   step) shows an answered choice as a distinct row: the chosen option's label, reason if given,
   and timestamp — satisfying "visible in history" without a new cross-session history screen
   (that is M5.3's territory, not this item's).

**Fixture gap.** The Done-when below names four worked examples from concept challenge C4, but
today's fixtures only cover two (both clean/floor-speed quality, in fixtures 01 and 02). Neither
"warm-up-heavy squat reduction" nor "symptom-based squat choice" exists yet: `back_squat` in
fixture 01's `block-strength` (an `alternating` block — deliberately chosen to also exercise the
once-per-execution scoping decision against a rotating block) has no `optionSets` and no
`alternatives` today. This item must add, to that step:
* `choice-squat-warmup` (`reduce_load_percent` and/or `reduce_reps` actions) for "how did the
  warm-up sets feel";
* `choice-squat-symptom`, offering `select_alternative` to `goblet_squat` (already catalog-defined,
  low-impact, low-coordination-demand — a legitimate lower-symptom substitute) and `end_block` for
  "sharp discomfort", plus a `StepAlternative` entry on `step-str-1` pointing at it.

**Files.** `sessions/models.ts` (`ChoiceEntryPayload`), `sessions/validation.ts`, new
`sessions/choiceResolution.ts` + `.test.ts`, `app/firestore.rules`, new
`engine/sessionChoiceEligibility.ts` + `.test.ts`, `hooks/useSessionRunner.ts`
(`logChoice`, `effectiveView`, constraint read, `nextStep` block-end/session-end shortcut), new
`components/session/ChoiceCard.tsx` + `.css` + `.test.tsx`, `components/session/SessionRunner.tsx`,
`sessions/fixtures/01-full-body-maintenance.json`.

**Tests.** `choiceResolution.test.ts` covering each action kind, last-choice-wins on a shared
target field, and array-shape stability; `sessionChoiceEligibility.test.ts` covering an
ineligible alternative under an active guardrail/restricted category and an unresolved-free-text
alternative rendered low-confidence rather than flagged; extend `sessions/validation.test.ts` and
the Firestore emulator entries suite for the `choice` payload kind, including a cross-user and a
completed-execution (terminal-immutability) rejection; extend `sessions/fixtures.test.ts` so the
runner-loadability guarantee also covers the new squat `optionSets`; add
`groupProgression.test.ts`/`performedComparison.test.ts` cases feeding an `omit_step`/`end_block`
-derived effective definition through unchanged, to pin that the free ride via `optional` really
holds. Extend `sessions/architecture.test.ts`'s UI-modules dependency check to also scan
`hooks/useSessionRunner.ts` (currently only `components/session/*` and `services/session*` are
scanned; the new `engine/injuryPolicy.ts`/`engine/sessionChoiceEligibility.ts` imports land in the
hook, so the boundary should be checked where the import actually is, not only adjacent to it).

**Done when.** Warm-up-heavy squat reduction, clean-catch load reduction, bar-speed end-block
and symptom-based squat choice are each presented as an explicit choice, recorded with reason
and timestamp, and visible in history; an alternative gated by an active restriction is visibly
disabled rather than offered; and no code path changes a prescribed step without a recorded
athlete action.

**Outcome (2026-08-19).** Built as designed above, with one correction found during
implementation: the eligibility gate originally proposed (M3.5 `facets.safetyTags` matched
against `TrainingSettings.guardrails`) doesn't type-check honestly -- `facets.safetyTags` is a
free-text tissue vocabulary, not `GuardrailKey`'s `'avoid_*'` vocabulary, and neither it nor
`contraindicationTags` has any other live engine consumer. `engine/sessionChoiceEligibility.ts`
instead gates on `restrictedModalities` (already resolved by `resolveInjuryRestrictions`) via a
small vocabulary bridge to the catalog's separate `WorkoutModality` enum -- real, live, and
honestly scoped rather than a gate that looks real but never fires. A second gap found only by
running the code: `groupProgression.ts`'s `entryCount` and `performedComparison.ts`'s
`entriesByStepId` both counted *any* entry sharing a step's id, so an answered choice would have
been double-counted as a logged set; both now exclude `payload.kind === 'choice'`.

Delivered: `ChoiceEntryPayload` on `SessionEntry` (`sessions/models.ts`), structural validation
(`sessions/validation.ts`) and Firestore rules support; pure `sessions/choiceResolution.ts`
folding recorded choices into an effective, index-stable view (`useSessionRunner`'s public
`definition` is now this effective view, so `comparePlannedVsPerformed`/`getGroupProgress`/
rendering needed no signature changes); `engine/sessionChoiceEligibility.ts`; `logChoice` and a
choice-driven `nextStep`/`sessionEnded` shortcut on `useSessionRunner`; `ChoiceCard.tsx` wired
into `SessionRunner.tsx`, blocking other step controls until a due choice is answered and
showing answered choices in the step's own entry list. Fixture 01's `block-strength` (an
`alternating` block, exercising the once-per-execution scoping decision against a rotating
block) gained `choice-squat-warmup` and `choice-squat-symptom` (the latter's `select_alternative`
resolving to `goblet_squat`), closing the gap between this item's Done-when and the fixture
corpus. Verified by `sessions/choiceResolution.test.ts`, `engine/sessionChoiceEligibility.test.ts`,
extended `validation.test.ts`/`groupProgression.test.ts`/`performedComparison.test.ts`, an
extended Firestore-emulator scenario (in-progress recording, cross-user rejection, terminal
immutability, malformed-payload rejection -- 77/77 emulator tests pass), and a full `npm run
check` (typecheck, lint, 1585 unit tests, catalog validation) pass. A live-browser run through
the actual runner was not possible in this environment (no real Firebase credentials); the
architecture test extension to `hooks/useSessionRunner.ts` mechanically enforces the same
optimizer/planner import boundary that a manual check would otherwise stand in for.

### M4.3 `[x]` Companion occurrence and duplicate reconciliation

**Change.** Distinguish embedded segments from later companion occurrences. Starting a
companion creates its own execution. Extend occurrence keys and reconciliation so a manual
execution and a matching Garmin activity merge as evidence for one physical occurrence.

**Files.** `engine/completedTraining.ts`, `engine/trainingHistory.ts`, the completed-session
adapters, new `sessions/occurrenceReconciliation.ts`; UI companion card.

**Done when.** An embedded bike warm-up stays inside Strength; a later recovery spin may be
started or skipped independently; a matching Garmin ride is counted exactly once.

**Outcome (2026-08-19).** The embedded-vs-companion distinction needed no new code: the model
already keeps them apart structurally (`SessionDefinition.blocks` vs. `companionSessions[]`,
rendered separately since M3.7), so fixture 01's embedded Olympic power block already stays
inside its own execution with no change here.

* **Starting a companion creates its own execution.** `SessionRunner.tsx` captures the
  finishing session's `title`/`companionSessions` before `completeSession`/`abandonSession`
  runs, since neither clears `runner.definition` itself (it stays the just-finished session's
  definition until the next `startSession` call overwrites it) — the capture is what the
  companion prompt actually relies on. Then — only once the primary session is no longer
  active, never concurrently with it, since the runner architecture holds exactly one active
  execution at a time — it offers a "Companion session available" prompt. **Start** resolves the
  companion's `definitionRef` the same two ways the existing fixture/saved-session pickers
  already do (a reviewed fixture, e.g. `08-recovery-spin-companion`, or one of the athlete's own
  saved manual definitions) and calls `runner.startFixtureSession`/`startSession` — the ordinary
  unplanned-log path (D-MAUTH: no selection authority, no occurrence). The now-active companion
  execution is then rendered by the runner's normal in-progress view; no separate companion-mode
  UI was needed. **Skip** just dismisses the prompt and records nothing. The prompt also appears
  after an *abandoned* primary session, not only a completed one — the companion's own value
  (e.g. "looser legs") doesn't depend on the primary having finished.
* **Occurrence keys and Garmin reconciliation.** New `sessions/occurrenceReconciliation.ts`:
  `sessionExecutionOccurrenceKey` gives every execution a stable identity (`occurrence:{id}`
  when it carries selection authority, `execution:{id}` otherwise — a companion execution has
  no `occurrenceId` per D-MAUTH but still needs one idempotent key). `matchExecutionsToGarminActivities`
  reconciles a set of executions against Garmin activities by same date, compatible resolved
  modality, and comparable duration (20-minute tolerance, mirroring
  `completedTraining.ts`'s own adherence-matching tolerance), claiming each Garmin activity for
  at most one execution so a manually logged companion and its Garmin sync are recognized as
  one physical occurrence rather than two.
* **Deliberately not wired into the live engine pipeline.** Per D-MPOLICY, "domain exposure"
  derived from general (non-Strength) session executions remains a default-off evidence
  candidate until its own ship decision — the same discipline `deriveStrengthExposure`'s legacy
  `manualTrainingPolicy` gate already applies to `strength_sessions`. Wiring
  `occurrenceReconciliation.ts` into `buildTrainingHistorySnapshot`'s live cost/stimulus path
  would grant a new engine-consumed evidence source without that decision. This module is
  therefore forward-compatible plumbing — correct, tested, and ready for M6.4/M8 to consume if
  and when general session-execution exposure is separately evidenced — not a silent
  activation now. `engine/completedTraining.ts`/`trainingHistory.ts` are unchanged.

Verified by `sessions/occurrenceReconciliation.test.ts` (12 cases: key derivation for both
authority states, duration computation including the in-progress/no-completion case, date/
modality/tolerance matching, and the one-activity-claims-at-most-one-execution exclusivity
property) and a full unit/typecheck/lint/catalog-validation pass with no regressions.

---

## M5 — occurrence-linked response

M1.7 already established the link against `strength_sessions`. This milestone generalizes it to
any occurrence and adds the delayed windows. M5.1 and M5.2 are the near-term evidence-producing
chain after M4.3; M5.3 is deliberately narrower than the original UI-heavy proposal.

### M5.1 `[x]` Occurrence-linked response generalization

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

**Outcome (2026-08-19).** New `responses/` domain (own distinct lifecycle, per D-MRECORDS,
alongside `sessions/`): `responses/models.ts` (`SessionResponse`, `ResponseWindow`,
`SessionResponseSourceRef`), `responses/validation.ts` (`validateSessionResponse`, a
self-contained strict validator mirroring `sessions/validation.ts`'s own conventions),
`persistence/parsers/sessionResponse.ts`, and `services/sessionResponseService.ts`
(`recordResponse`, `updateResponseFacts`, `getResponsesForSource`, `getResponseForWindow`).

* **Reuses, not migrates, M1.7/M2.6's linkage shape.** `SessionResponseSourceRef` is exactly
  the `{kind: 'strength'|'execution', id, date}` shape `RegionTissueResponse.sourceSessionRef`
  already writes (M2.6 had already generalized `kind` beyond strength-only, ahead of this
  item) -- reused rather than reinvented so a `SessionResponse` and the check-in's own
  tissue-side linkage join on identical fields for the same session. No existing check-in
  document needed rewriting; `sourceSessionRef` itself is untouched.
* **Linkage and non-tissue facts only (D-MRESP).** `SessionResponse` stores `window`
  (`immediate | later_day | next_morning`), `sessionRpe`, `completedFraction`,
  `unexpectedFatigue`, `techniqueNote`, `note`, and a `checkinRef: { date }` pointing at the
  canonical check-in that holds this window's tissue values -- never a tissue value itself.
  `DailySubjectiveCheckin.tissueResponses` remains the sole tissue authority; nothing here
  duplicates it.
* **Missing follow-up is distinguishable from normal.** No `SessionResponse` document is ever
  created except in direct answer to an athlete action (`recordResponse` is the only write
  path that creates one); `getResponseForWindow` returns `null` -- never a fabricated
  default -- when a window was never answered, so callers (M5.2's schedule, M5.3's outcome
  report) can tell "never asked/answered" from every actual answer, including a normal one.
* **Edits preserve provenance.** `updateResponseFacts` only ever patches the five non-tissue
  fact fields plus `updatedAt`; `sourceSession`/`occurrenceId`/`window`/`date`/`createdAt` have
  no code path that changes them after creation. Firestore rules enforce the same constraint
  server-side (`request.resource.data.sourceSession/window/date/createdAt ==
  resource.data....`), not just client discipline.
* **Cannot reference another user's occurrence.** Beyond the standard owner-scoped path and
  `userId` match, the rules require an `occurrenceId` (when present) to resolve via `exists()`
  against `users/{userId}/session_occurrences/{occurrenceId}` under that same authenticated
  user's own path -- a cross-user id structurally cannot resolve there, and a garbage/mistyped
  id is rejected rather than silently stored.
* **Window/date validated at both layers.** `window` and `sourceSession.kind` are checked
  against their exact enums, and every date field (`date`, `sourceSession.date`,
  `checkinRef.date`) is checked as a real calendar date, in both the TypeScript validator and
  the Firestore rules (`isValidActivityDate`) -- the same fail-closed, two-layer pattern every
  other M2/M3 record already uses.

**Files.** `responses/models.ts`, `responses/validation.ts` (+ `.test.ts`),
`persistence/parsers/sessionResponse.ts` (+ `.test.ts`), `services/sessionResponseService.ts`
(+ `.test.ts`), `firestore.rules`, `emulator/firestoreRules.emulator.test.ts`. Extended
`sessions/architecture.test.ts`'s optimizer/planner boundary check to also scan `responses/`
(a second distinct-lifecycle domain now exists, not only `sessions/`).

Verified by 15 validator cases, 8 service cases, 3 parser cases, 5 new Firestore-emulator
cases (record + revise, provenance-preserving edit rejection on each of the four immutable
fields, malformed-shape rejection, foreign-`userId` rejection, and the
occurrenceId-must-exist-for-this-user check both failing and then succeeding once the
occurrence is written) -- 82/82 emulator tests total -- and a full `npm run check`
(typecheck, lint, 1692 unit tests, catalog validation) pass with no regressions.

### M5.2 `[x]` Later-day and next-morning follow-up

**Change.** Surface due follow-ups on Today and Check-in rather than requiring notifications.
Use occurrence metadata and M3.5 tissue tags to ask only relevant regions. Next-morning answers
write to the canonical check-in so `injuryPolicy.ts` continues to consume the canonical daily
model and may only tighten (ADR-0020 D-SUBJFLOOR).

**Files.** `Home.tsx`, `DailyCheckin.tsx`, `checkinService.ts`, new
`responses/followupSchedule.ts`.

**Done when.** A field or novel lower session creates one later-day and one next-morning
prompt; answers link to the correct occurrence; skipped prompts stay unknown; a favorable
global readiness cannot override an adverse tissue response.

**Outcome (2026-08-19).** New pure `responses/followupSchedule.ts` (`relevantFollowupRegions`)
maps a session's resolved catalog exercises' M3.5 `facets.tissueDemand`/`safetyTags` to
`BodyRegion`s via a small, literal keyword table (an unrecognized tag contributes no region --
the safe failure mode, not a guess). Both windows are gated on this: a session with no
tissue-relevant movement in it (an easy aerobic spin, most field/mobility work) creates neither
prompt, which is what keeps this from nagging after every session.

* **`later_day` (new -- `Home.tsx` + new `components/session/LaterDayFollowupCard.tsx`).**
  There is no same-day tissue field on `RegionTissueResponse` to reuse (the model has
  `morningState`/`painDuringTraining`/`afterTrainingState`/`nextMorningReaction` only, and
  D-MRESP's "without rewriting existing documents" ruled out adding one), so this window is
  session-level, not region-level: "Feeling normal" / "Unexpectedly fatigued" / "Not now",
  recorded as an M5.1 `SessionResponse` (`unexpectedFatigue`, no tissue value). Home resolves
  today's finished (`completed`/`abandoned`) executions via
  `sessionExecutionService.getExecutionsInRange`, derives relevant regions from their logged
  entries' `exerciseRef`s, and skips a session once `sessionResponseService.getResponseForWindow`
  shows it already has a `later_day` answer. "Not now" writes nothing -- a locally tracked
  dismissal only prevents re-showing within the same mount, never persisted, so nothing here
  can silently look like a passed response later.
* **`next_morning` (generalized -- `DailyCheckin.tsx`).** M1.7's existing next-morning
  mechanism already worked, but only prompted for a region the athlete had *manually* flagged
  during/after the session. Candidate regions are now the union of that manual flag set
  (unchanged, still takes priority so its `sourceSessionRef` is preserved) with regions derived
  from yesterday's `session_executions` the same way `later_day` derives them -- so a session
  the athlete never manually flagged anything for still gets asked about a region its own
  movements make relevant. Answering still writes only to the canonical check-in's
  `nextMorningReaction` (unchanged tissue path, D-SUBJFLOOR/`injuryPolicy.ts` untouched), and
  now also records at most one session-level `next_morning` `SessionResponse` per session
  (checked via `getResponseForWindow` first, since several regions can share one session and
  must not create duplicates) -- again carrying no tissue value. Legacy standalone
  `strength_sessions` are out of this generalization's scope; their manual-flag path is
  unchanged from before M5.2.
* **Skipped stays unknown; answers link to the correct occurrence.** Neither window's skip
  path (`onDismiss` / `handleSkipFollowup`) writes anything. Every recorded response's
  `sourceSession`/`occurrenceId` comes from the actual resolved `SessionExecution`, not
  guessed or defaulted.
* **D-SUBJFLOOR untouched.** Nothing here changes what `injuryPolicy.ts` reads or how it
  reads it -- both windows write through the identical existing tissue-write path (checkin
  `tissueResponses[region].nextMorningReaction`) or write no tissue value at all
  (`later_day`'s `SessionResponse`). A favorable global readiness still cannot override an
  adverse tissue response, because that adjudication is unchanged.

**Files.** New `responses/followupSchedule.ts` (+ `.test.ts`), new
`components/session/LaterDayFollowupCard.tsx`/`.css` (+ `.test.tsx`), `Home.tsx`,
`DailyCheckin.tsx`. `checkinService.ts` needed no change -- the tissue write path it already
exposed was sufficient.

Verified by 7 `followupSchedule.test.ts` cases (the real back-squat/sprint fixture tag
vocabulary, empty/no-exercise sessions, an unrecognized tag contributing nothing,
dedup+sort, case-insensitivity), a `LaterDayFollowupCard` markup smoke test, and a full
`npm run check` (typecheck, lint, 1700 unit tests, catalog validation) pass with no
regressions. `Home.tsx`/`DailyCheckin.tsx` have no pre-existing component-test harness in
this repo (confirmed: neither file has a test file today) -- the new logic's real complexity
lives in the pure, directly-tested `followupSchedule.ts`; the component wiring is glue code
over already-tested services, consistent with how this repo tests these two files elsewhere.

### M5.3 `[x]` Outcome/override evidence report — history UI only if triggered

**Future usage trigger for richer UI.** Keep `components/session/ResponseHistory.tsx` deferred
until repeated evidence use creates a specific question that a dedicated history surface can
answer better (for example, comparing responses after a recurring lower-body session). Until
then, the report/export below is the product.

**Outcome (2026-08-20).** Pure derivation, report/export and the wiring service all shipped;
no dedicated history UI was built.

* **`responses/outcome.ts`.** `deriveSessionOutcome` derives `passed | caution | reactive |
  unknown` from already-recorded M5.1/M5.2 `SessionResponse[]` plus the canonical check-in's
  linked `RegionTissueResponse[]` (caller-resolved; this module still never queries a
  check-in itself, D-MRESP). It reuses `engine/injuryPolicy.ts`'s existing
  `deriveTissueSeverity` worst-signal mapping rather than restating a second threshold table
  for the same four-level tissue scale. `unknown` is returned both for zero data and for
  immediate-only data with no later_day/next_morning signal yet -- a `passed` claim requires
  actual follow-up to have happened, never a fabricated default. `SESSION_OUTCOME_POLICY_VERSION`
  (`'m5.3-outcome-v1'`) is carried on every result.
* **Scoping decision: no new persisted "reason" field.** The plan asks this to "record
  athlete override reason." No UI anywhere in the repository currently captures a structured
  reason for *any* session (`SessionAdjustment.athleteReason` itself has no writer today).
  Rather than add a second unused enum field, `SessionOutcomeInput.overrideReason` is threaded
  through as a plain optional parameter typed as `AthleteOverrideReason` (`NonNullable<SessionAdjustment['athleteReason']>`,
  reused per the plan's own instruction) -- the record shape exists for the moment a real
  capture point is built, but `deriveSessionOutcome` never invents a value for it.
  `override.note` is populated automatically from data that *does* already exist (the most
  recently updated `SessionResponse.note`/`techniqueNote`, preferring a `later_day`/
  `next_morning` note over a merely-more-recent `immediate` one).
* **Planned/performed delta.** Reuses M2.6's existing `comparePlannedVsPerformed`
  (`sessions/performedComparison.ts`) output (`completedStepsCount`/`missingRequiredStepsCount`/
  `totalPlannedSteps`) rather than recomputing it -- no new delta math was needed.
* **`responses/outcomeReport.ts`.** `buildSessionOutcomeReport` flattens `SessionOutcome[]`
  into a deterministic, chronologically sorted row set; `sessionOutcomeReportToCsv` is a pure
  RFC-4180-shaped serializer. This is the "compact inspectable view" -- `components/session/ResponseHistory.tsx`
  remains unbuilt; the usage trigger has not fired.
* **`services/sessionOutcomeReportService.ts`.** The one new IO-touching module: for every
  finished (`completed`/`abandoned`) execution in a date range it composes
  `sessionExecutionService.getExecutionsInRange`, `sessionResponseService.getResponsesForSource`,
  `checkinService.getCheckinsInRange` and, for a `completed` execution,
  `resolveSessionDefinition` (M3.1) + `comparePlannedVsPerformed` (M2.6) -- every one of those
  already existed and was already tested. Constructor-injected dependencies with singleton
  defaults follow `StrengthHistoryReadService`'s established M2.7 pattern, so the composition
  is unit-testable without the Firestore emulator. An in-progress execution is excluded
  outright (an outcome computed for one would always read `unknown`, indistinguishably from a
  genuinely unanswered follow-up). Tissue evidence is discovered by scanning every check-in in
  range (plus a bounded lookahead buffer) for a `RegionTissueResponse.sourceSessionRef`
  matching the execution, never by way of whether a `SessionResponse` happens to exist for it
  -- an earlier draft keyed discovery off `SessionResponse.checkinRef.date` and so silently
  missed a manually-flagged tissue reaction (the legacy pre-M5.1 check-in flow) that has no
  corresponding `SessionResponse`; caught in review before merge.
* **Architecture boundary.** `sessions/architecture.test.ts` gained a third check: no module
  under `engine/optimizer`, `engine/planner`, `engine/rules`, `engine/weeklyAllocation`,
  `engine/evergreenPlanning` or `engine/sequenceSearch` can reach `responses/outcome.ts` at
  runtime, directly or through any transitive import chain -- the M0.3 boundary's Done-when
  requirement, applied to this specific evidence-only summary per D-MPOLICY.

**Files.** New `responses/outcome.ts` (+ `.test.ts`), `responses/outcomeReport.ts`
(+ `.test.ts`), `services/sessionOutcomeReportService.ts` (+ `.test.ts`);
`sessions/architecture.test.ts` extended. No `firestore.rules` change -- nothing new is
persisted. Verified by 35 new unit tests, a full `npm run check` (typecheck, lint, 1764 unit
tests, catalog validation) and the Firestore-emulator rules suite (83/83), all passing with no
regressions. Four correctness issues raised in review (immediate-note precedence overriding a
follow-up note, unquoted bare `\r` in CSV export, tissue discovery silently missing a
`SessionResponse`-less check-in, and the architecture test only checking direct import edges)
were fixed before merge; see the bullets above.

---

## M6 — speed, field and power execution — **usage-triggered**

**Not on the active delivery chain.** M2 already logs repetitions, time, distance and
check-offs. M6 starts only when recurring real training demonstrates that these generic inputs
lose decision-relevant field/speed/power information. A future M8 analysis is not a trigger.

**M6 trigger.** At least one real, recurring session cannot be logged honestly enough with the
existing runner for a named athlete-facing purpose — e.g. side/angle/validity/split context is
being lost, or the athlete is maintaining the same information elsewhere because the app cannot
represent it. Record the concrete gap before starting M6.1.

**Justification (C10/C12).** If triggered, these items stand on athlete-facing value: recording
sprint, COD and jump work in native units with enough context that comparing two of them is
honest. They are *not* justified by M8 candidacy. If every M8 candidate is later rejected, an
independently-triggered M6 still remains worth having.

### M6.1 `[ ]` Representative speed/field/power taxonomy v1

**Trigger condition.** The M6 group trigger is documented with at least one real session and
named missing context. Build only the taxonomy needed by that evidence, not the full list below
by default.

**Candidate reviewed set, bounded by the trigger:**

* 10/20 m acceleration and flying 10 m;
* controlled and maximal deceleration;
* planned 45°/90° COD with side; reactive agility as a distinct family;
* low and high bilateral and unilateral elastic contacts;
* CMJ, low drop jump and one med-ball throw;
* ball technical and small-sided/chaotic exposure descriptors.

Record start, surface, approach/exit, angle, planned/reactive, side, contact intensity and
measurement-profile facets only where relevant. Avoid a flat list and do not add unused domains.

**Files.** `workouts/exercises.ts`, `workouts/models.ts`, the catalog validator, new
`sessions/domainFacets.ts` only to the extent the triggered workflows need them.

**Done when.** The triggered real session plus its representative fixture validate with no
irrelevant required fields, and materially different work (for example planned COD versus
reactive agility) cannot masquerade as the same exposure.

### M6.2 `[ ]` Sprint and field performed-entry cards

**Trigger condition.** A recurring sprint/COD/deceleration workflow has information the generic
`DistanceInputCard` / duration/check-off controls cannot retain without side notes or external
tracking.

**Change.** Add only the input cards required by that workflow. Training mode may support
completion, optional time and splits, rest, side, validity and notes, and a stop criterion. It
does not force a timing device or promote a training rep to a benchmark.

**Files.** `components/session/inputs/SprintEntry.tsx`, `CodEntry.tsx`, typed payload parsers
and services as actually required; visual tests.

**Done when.** The triggered acceleration/deceleration/COD workflow executes on a 390 px
viewport without external notes; left/right remain first-class where relevant; missing timing
is valid training data.

### M6.3 `[ ]` Jump/throw/contact performed-entry cards

**Trigger condition.** Jump/throw/contact work is being performed repeatedly and attempt/contact
facts are currently lost or tracked elsewhere.

**Change.** Add the smallest attempt/contact input needed by that workflow with native metrics
when available. Store every recorded attempt and validity; summaries are derived. Do not
require force-plate metrics from manual users.

**Files.** Trigger-specific input cards and payload validators; keep the M7 observation seam
only if repeated benchmarking is also triggered.

**Done when.** The triggered jump/throw/contact workflow records its native facts without a
generic "power score" and without forcing unused device fields.

### M6.4 `[ ]` Domain exposure read models

**Trigger condition.** Enough triggered M6 history exists that the athlete is asking a real
exposure question (for example days/reps/metres since acceleration or hard braking) that cannot
be answered from the execution list economically.

**Change.** Derive only the transparent histories needed by that question — days, reps, metres
or contacts — keeping raw units and confidence. Do not fuse them into ACWR or an injury
probability.

**Files.** `sessions/exposureHistory.ts`, the minimum report/progress surface and tests.

**Done when.** The requested history reconciles exactly to execution entries, unresolved
free-text movements are reported separately, and no production engine module imports it.

---

## M7 — observation provenance, testing and progress — **usage-triggered**

**Not on the active delivery chain.** M7 is for repeated standardized measurement, not for
ordinary training logging. It starts only when the athlete is actually running a repeated test
or benchmark workflow where protocol comparability matters. M6 completion is not a blanket
precondition; only the domain vocabulary/input capability needed by the chosen test is required.

**M7 trigger.** A test (e.g. sprint, jump, throw, optional bar velocity) will be repeated under
a deliberately standardized protocol and the result will be compared over time. One-off
training timings or curiosity measurements do not trigger M7.

### M7.1 `[ ]` Metric registry, protocols and comparable series

**Change after trigger.** Add the smallest static `MetricDefinition` registry and user-scoped
immutable `MeasurementProtocol` revision set required by the actual repeated tests. Define
unit, compatible entry kind, required context, summary methods and deterministic
comparable-series key inputs. Device/source changes and material protocol changes create a new
series or version.

Candidate metrics include sprint time/splits, jump height, contact time, RSI derivation, throw
distance and optional bar velocity. Do not implement the catalogue until a test needs it.

**Files.** New `observations/models.ts`, `observations/registry.ts`,
`observations/comparability.ts`, protocol service, rules and parsers — bounded to triggered
metrics.

**Done when.** The triggered test's same protocol/device/surface yields the same key; a material
setup change does not; units cannot mismatch registry definitions.

### M7.2 `[ ]` Metric observation persistence and adapters

**Change.** Persist the triggered raw observations with session/attempt, metric, value/unit,
`observedAt`, source/device/protocol/comparison series, quality/validity and raw reference.
Derived values carry an algorithm version and source observation IDs; raw values are never
overwritten (ADR-0021 D-SETLOG, ADR-0005).

Add the manual adapter first. Device adapters remain M9.3-triggered.

**Files.** New `services/metricObservationService.ts`, parser, rules and tests,
`observations/manualAdapter.ts`.

**Done when.** Raw attempts survive recalculation, cross-user and source spoofing fail, and any
derived value references its raw observations, protocol and algorithm rather than a bare
number.

### M7.3 `[ ]` Protocol-locked testing mode

**Change.** Add a distinct Testing route/state only for the triggered test workflow, with
protocol confirmation, warm-up, practice/valid/invalid attempts and reason, rest and explicit
finish. Training execution cannot promote its own result to a benchmark without a confirmation
flow that creates a test attempt under a compatible protocol.

**Files.** New `components/testing/`, route/navigation, session intent handling and tests,
limited to triggered tests.

**Done when.** The actual repeated test records attempts and validity under a locked protocol;
changing setup requires a new revision/series; ordinary training still cannot silently become a
benchmark.

### M7.4 `[ ]` Benchmark derivation and quality-aware progress

**Trigger condition.** There are enough repeated comparable observations that a progress view
will be used; do not build benchmark UI immediately after the first test.

**Change.** Derive the required best/mean/median summaries from valid comparable attempts.
Store only rebuildable summaries with algorithm version; never overwrite tested values with
estimated ones. Show change only within a comparable series and show data-quality/missing-
protocol badges. Meaningful-change claims require separately reviewed error metadata.

**Files.** `observations/benchmarks.ts`, the minimum `components/progress/` view and tests.

**Done when.** Invalid/practice attempts never become benchmarks; device/protocol mismatch
prevents a default PR comparison; raw attempts remain accessible; no "athleticism score" is
shown.

---

## M8 — engine evidence candidates

**Expected outcome (C10/C12).** This repository's record on measured candidates is D-BEAM built
and not adopted, D-ZONECRED no-ship, D-STRCOST deferred, subjective drift still default-off.
That is the discipline working. **A full sweep of no-ship results here is a success for M8.**

**No upstream scope creation.** M8 is not a reason to implement M6 or M7. A candidate must use
M5 plus whatever independently-justified evidence exists. If a candidate cannot be evaluated
without an untriggered measurement subsystem, the correct result is `defer: evidence not yet
collected`, not "build the subsystem so this experiment can run."

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

**Change.** Build a de-identified real-history report for a **named candidate question** using
only the evidence streams that already exist and were justified independently. M5 response
evidence is the baseline. Join M6 domain exposure or M7 observations only when those groups
were already triggered by athlete use and the candidate genuinely needs them. Report missing
follow-up and provenance coverage rather than manufacturing completeness.

**Files.** Candidate-specific simulation/report commands under `engine/simulation/` and
`scripts/`, output under gitignored `artifacts/`, plus a reviewed analysis snapshot when run.

**Done when.** The report reproduces its joins, names policy/algorithm versions, distinguishes
"no reaction" from "no response", and states explicitly which unavailable evidence prevented
evaluation. Synthetic scenarios alone do not satisfy the real-history gate (ADR-0020
D-SUBJCAL).

### M8.3 `[ ]` Policy ship/no-ship decision

**Change.** Write a dated analysis and an ADR amendment/new ADR for each candidate that has
sufficient evidence. A ship requires no hard-gate regressions, reviewed real-history evidence,
scenario invariants, a `POLICY_VERSION` increment, replay coverage and a rollback selector. A
negative result completes the measurement item and leaves production unchanged (D-BEAM
precedent). Insufficient evidence is an explicit `defer`, not a request to expand M6/M7.

**Done when.** Every evaluated candidate has an explicit ship, defer or reject result. "Code
exists" and "we could build more telemetry" are never treated as authorization.

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

**Trigger.** The athlete owns and repeatedly uses one of the devices **for data that has a
product use**. Owning hardware alone is not enough.

**Change.** Specify the minimum adapter for the triggered device (manual, Garmin/FIT, timing
gate, VBT, GPS or force plate) against `MetricObservation` if an observation boundary is
required. If M7 has not otherwise been triggered, activate only the minimum provenance model
needed by this device rather than the whole M7 roadmap. Deduplication links sources to one
occurrence/execution rather than creating duplicate completed sessions.

**Done when.** The bounded adapter conformance suite proves units, protocol/source identity and
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

Always-active scenarios:

1. manual full-body session: author → schedule → adjudicate → execute → correct → complete;
2. imported lower/Olympic session: semantic review → recorded choices → replay;
3. upper-only absorption: required-step gating does not fabricate heavy lower work;
4. timed per-side tissue block: native entry and correct side history;
5. Friday field: existing generic distance/time/check-off execution remains usable;
6. optional later spin: separate occurrence and Garmin deduplication;
7. offline kill/reopen/reconnect with a pending entry and no duplicate;
8. later and next-morning response: occurrence linkage, unknown missing response, tighten-only
   tissue;
9. legacy Strength: identical history and 1RM output through the v1 read model.

Conditional scenarios, added only when the corresponding trigger fires:

10. M6-triggered field/speed/power workflow: native domain details are retained without
    external notes;
11. M7-triggered test: protocol lock, invalid attempt and comparable benchmark for the actual
    repeated test being used.

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
* [ ] M8 does not create an implementation requirement for otherwise-untriggered M6/M7 work.
* [ ] The two metric-observation invariants above are unconditional (ADR-0023 D-MOBS). They
      bind any code that writes a `MetricObservation`, including the bounded M9.3 device
      boundary activated without a full M7 trigger. Deferring M6/M7 defers the capability,
      never the provenance rules that apply once observations exist.

---

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Plan stalls in the middle | Active cutline is M3.7/M3.8 → M4.3 → M5.1 → M5.2; M6/M7 are not queued by numbering | Stop after any useful capability; record the cutline rather than opening the next numbered milestone |
| Premature M6/M7 expansion | Explicit real-use triggers; generic runner is the default until a named gap exists; M8 cannot pull work forward | Leave M6/M7 `[ ]`; record the missing evidence as a defer rather than building speculative telemetry |
| Schema scope grows without bound | Fixture-led vocabulary; extension/versioning; speculative set/device types remain trigger-gated | Keep v1 routes/import; reject unsupported fields |
| Two runners coexist indefinitely | M3.4 has an explicit retirement step and a parity gate; M1 items are labelled carried or disposable | If parity fails, keep v1 for catalog Strength only and cap it — do not re-invest in disposable UI |
| Firestore nested validation stays weak | Performed entries are individual documents; D-MSNAP keeps nested content out of mutable rules-validated documents; immutable revision parsers validate bytes | Disable new writes; existing v1 data untouched |
| Recommendation document outgrows its limits | D-MSNAP stores a hash, not a snapshot; the snapshot is a separate write-once document | The snapshot document is orphanable without touching decision history |
| Phase 9.0 evidence contaminated by mid-block schema churn | M4.3 is decision-affecting, not evidence-only — it rewrites `engine/completedTraining.ts` and `engine/trainingHistory.ts`, so it is gated on a shadow-block boundary exactly like M3.2/M3.3/M3.4; only M5's evidence-only work may proceed inside a running segment | Land M4.3 before 9.0.7 starts, or end the segment and record the policy/version boundary; never pool the two segments |
| Offline concurrent correction conflicts | Stable entry IDs, parent lifecycle checks, idempotent writes, deterministic response IDs, emulator and browser tests | Keep the append-only v1 runner available during cutover |
| Recommendation replay drifts | Persist the hash and include it in decision equality/audit; replay verifies stored bytes | Fall back to catalog/external v1 replay paths; do not rewrite old audits |
| Rich logging becomes slow | Defaults, recent values, check-off modes and progressive disclosure; specialized controls only after trigger | Retain generic minimum performed payload; remove unused advanced controls |
| Free-text metadata creates false safety | Fail-closed engine adapter; visible low-confidence state | Treat unresolved as generic evidence only |
| Response data is mistaken for diagnosis | Raw language, transparent heuristics, no probability claims | Disable derived outcome view; retain raw responses |
| New detail silently changes selection | Evidence-only import guards, default-off candidates, M0.3 architecture tests | Remove selector/import; current production path remains |
| Garmin and manual data double-count | Occurrence keys and explicit source reconciliation | Prefer one source and mark the other linked/ignored; never delete raw evidence |
| Permanent v1 read model rots | M2.7 is explicitly permanent and keeps its own tests | None needed — that is the point of naming it permanent |

Historical documents and audits are never deleted during rollback.

### Stop conditions

This plan has no engine-policy ship gate before M8, so it needs honest exits. Any of these is
a valid place to stop and record the outcome, not a failure:

* **At M3.8.** If the current builder plus JSON import covers real authoring, stop hardening and
  defer residual advanced controls.
* **After M5.2.** This is now the default product cutline. Let real session→response history
  accumulate before deciding whether any further capability deserves implementation.
* **At M5.3.** Keep report/export only unless repeated use proves a dedicated history UI useful.
* **Before M6.** If no recurring real session exposes a generic-runner gap, M6 remains unstarted
  indefinitely — this is success, not backlog debt.
* **Before M7.** If no repeated standardized testing workflow exists, M7 remains unstarted
  indefinitely.
* **At M8.3.** A clean sweep of reject/defer results completes the evidence milestone; lack of
  M6/M7 evidence is a valid reason to defer a candidate.

A stop is recorded as a dated note in `docs/analysis/` and a status/startability change here,
following the same convention as D-BEAM and the zone-credit no-ship.

---

## Out of scope

* ACWR or injury-probability features;
* one universal readiness, load or athleticism score;
* automatic condition evaluation, live progression or substitution before M8 evidence;
* coach or team tenancy, permissions or dashboards;
* a relational, warehouse or Databricks migration;
* full force-plate, timing-gate, GPS, VBT or video integrations (M9.3 trigger only);
* broad exercise/metric taxonomies before a real usage trigger;
* dedicated response-history dashboards without repeated evidence use;
* push-notification infrastructure;
* changes to Garmin backend date or user-isolation semantics;
* enabling ADR-0021 Strength cost solely because richer execution data exists;
* a bulk migration of `strength_sessions` — the M2.7 read model is the permanent answer.

Each may receive a separate plan after the dependency, usage trigger and evidence it needs
exists.

---

## Documentation to update as work lands

* accepted ADR-0023 and the `docs/README.md` ADR index as implementation details land;
* `docs/architecture/recommendation-engine.md` for source-neutral adjudication and authority;
* `docs/workout-library.md` for definition/catalog adapter and ontology facets;
* `docs/external-plan-schema.md` for v2 and v1 compatibility;
* living `docs/architecture/session-execution.md` as M4/M5 behavior lands;
* Firestore collection/schema documentation after M5, and after M6/M7 only if those groups are triggered;
* `docs/ops/` for any triggered parser/integration credentials and deployment;
* this plan's task board and the plan-index startability after every completed item or trigger decision;
* dated analyses and policy ADRs for M8 measurement outcomes, and a dated note for any stop or
  M6/M7 trigger decision.

When this plan eventually becomes `Implemented`, remove or rewrite the present-tense problem
statements and keep an outcome summary, per `docs/plans/README.md`.
