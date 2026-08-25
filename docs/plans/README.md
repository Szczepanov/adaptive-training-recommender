# Implementation Plans

Plans describe **how a change gets made**. They are mutable working documents with a
status lifecycle, and they are expected to go stale — that is what `Superseded` and
`Archived` are for.

This is deliberately different from [`docs/adr/`](../adr/), which records **what was
decided and why** and is immutable once accepted (ADR-0001). If a plan proposes a
decision, that decision belongs in an ADR; the plan references it.

```text
docs/analysis/   point-in-time audits    "what is true today"    dated, never edited
docs/adr/        decisions               "what we chose, why"    immutable once accepted
docs/plans/      execution               "how we get there"      mutable, status-tracked
docs/architecture/  living reference     "how it works now"      updated with the code
```

---

## Status lifecycle

Status answers **"is the design agreed?"** — separately from **"can work start now?"**,
which is what `Blocked by` answers. Conflating the two made the table unusable: an earlier
revision marked all six phases `Ready` while four of them depended on phases that had not
landed.

| Status | Meaning |
|---|---|
| `Draft` | Being written; design not agreed. |
| `Approved` | Design agreed and decisions taken. **May still be blocked** — check `Blocked by`. |
| `Ready` | Approved **and** every dependency has landed. Work can start today. |
| `In progress` | Work started. |
| `Implemented` | Delivered. Retained for the reasoning, not as instructions. |
| `Superseded` | Replaced by a later plan (link it). |
| `Archived` | No longer pursued. Say why. |

`Approved → Ready` is a mechanical transition: it happens when the last blocker lands, and
requires no new decision.

Every plan carries `Status`, `Blocked by`, and `Unlocks` in its header. **Dependencies are
declared per work item, not only per phase** — a phase can be part-startable, and saying
"depends on nothing" at the header while an individual item requires the Phase-0 harness is
how a plan stops being executable.

A dependency being satisfied is not always enough to make optional capability work startable.
Where a plan declares an explicit **usage trigger**, the trigger is part of `Blocked by` even
when every code dependency has landed. This keeps capability numbering from silently becoming
a delivery queue.

---

## Current plans

These implement the way forward in
[`docs/analysis/2026-08-08-architecture-review.md`](../analysis/2026-08-08-architecture-review.md)
§7.5. Finding IDs (`F1`, `F16`, …) refer to that document.

Phases 0–8 are **implemented**; Phase 9.0 and Phase 9 remain **In progress**.
Among capability plans, Garmin per-activity telemetry (G) and Mobile UX/UI (UX) are
**implemented**; Strength session logging (S) is **In progress (default-off)** with all
numbered code delivered; Multidomain sessions (M) is **In progress** with M0–M5.3
complete; Performance outcome validation (OV) is **In progress** with the engineering
stack through OV6.1 merged; Health anomaly alerting (HA) is **In progress** with HA0–HA5
on `main` (HA5 shadow observability/replay merged via #171) and HA6.1–HA6.3 prospective
outcome labels implemented via PR #174 (evidence-only, gated behind the shadow surface).

For Multidomain delivery, the 2026-08-19 evidence-first cutline chain from
[`2026-08-19-product-scope-cutline-review.md`](../analysis/2026-08-19-product-scope-cutline-review.md),
`M3.7 → bounded M3.8 → M4.3 → M5.1 → M5.2`, is complete, and M5.3 (the report-first
outcome/override evidence summary that chain unlocked) landed 2026-08-20. M6 remains a
usage-triggered capability family. The repeated-standardized-testing trigger originally
recorded under M7 fired on 2026-08-21, and **implementation/status ownership transferred to
OV**. Former M7.1–M7.4 are no longer actionable M items; the M plan keeps only the historical
mapping. M8 may consume independently justified M6/OV evidence but cannot create scope for it.
M9 remains behind its own named triggers.

OV is therefore the sole status board for repeated testing/progress. Its evidence/reporting
engineering path through `OV6.1` is merged via #154, #155, #163, #164 and #169. The next
value-bearing work is operational OV7 on the real event/block timeline. `OV4.4` remains gated
on real close-spaced repeat trials, and `OV6.2` remains usage-triggered until repeated report
use proves a product/UI question. None of the merged OV evidence modules has recommendation
selection authority.

HA is the canonical plan for physiological-anomaly/possible-illness evidence. HA-A/#162
landed the fail-closed policy contract plus optional check-in context; #166/#165 and follow-up
fixes put the anomaly-grade feature mapping, pure evaluator, explanations, persistence,
episode continuity and composition boundary on `main`. HA-D/#171 landed HA5 shadow
observability/replay on `main` on 2026-08-21. HA6.1–HA6.3 prospective outcome labels are
implemented in PR #174 (evidence-only, behind the shadow surface); HA6.4's personal expected-response model additionally
needs enough labelled personal history to evaluate without fitting sparse noise. User-visible
wording remains gated by HA7 evidence, and tighten-only training integration remains a separate
later release decision.

The Phase 0–5 task boards are historical implementation records; the
[follow-up analysis](../analysis/2026-08-09-phase-0-5-completion-review.md) records
which original findings are fully closed and which remain ongoing work.

`Status` is a single plan-level lifecycle value from the table above. Because a plan can
be part-startable, **which work items are unblocked is a separate column** — `Ready` at
the plan level would otherwise have to mean "some of it", which is how the earlier
all-`Ready` table became unusable.

| # | Plan | Status | Startable items | Blocked by | Addresses |
|---|---|---|---|---|---|
| 0 | [Instrumentation & developer baseline](./phase-0-instrumentation.md) | **Implemented** | — | — | F11, F14, F15, part of F10 |
| 1 | [Live defects](./phase-1-live-defects.md) | **Implemented** | — | — | F1, F2, F6 |
| 2 | [Plan intent is the planning authority](./phase-2-plan-intent-authority.md) | **Implemented** | — | — | F16, F17, F9 |
| 3 | [One ranking path](./phase-3-single-ranking-path.md) | **Implemented** | — | — | F3, F4, F5 |
| 4 | [Objective credit V2](./phase-4-objective-credit-v2.md) | **Implemented** | — | — | F7, F8, F12 |
| 5 | [Sequence planning](./phase-5-sequence-planning.md) | **Implemented** | — | — | the cutover proper |
| 6 | [Evidence-driven calibration & operational assurance](./phase-6-evidence-and-operational-assurance.md) | **Implemented** | none | none | remaining F11, F12, F15 |
| 6.2c | [Recommendation quality & weekly coverage](./phase-6-2c-recommendation-quality-and-weekly-coverage.md) | **Implemented** | none | none | separates adaptation credit from weekly programming-role coverage; not an original review finding |
| 7A | [Weekly allocation & safe role reservations](./phase-7-weekly-allocation-and-role-reservations.md) | **Implemented** | none | none | resolves PR #17's healthy/fresh cycling role-coverage failure without recalibrating recovery |
| 7B | [Training intent, capacity & planning modes](./phase-7-training-intent-and-planning-modes.md) | **Implemented** | none | none | evidence-derived Evergreen dose packed into real capacity, while preserving structured and demand-derived event planning — not an original review finding |
| 8 | [Externally-planned mode](./phase-8-externally-planned-mode.md) | **Implemented** | — | — | imports an externally-authored plan and narrows the engine to per-session adjudication plus weekly critique — not an original review finding |
| 9.0 | [Shadow mode & decision journal](./phase-9-0-shadow-mode-and-decision-journal.md) | **In progress** | 9.0.1 (operational; 9.0.2-9.0.6 code is done) | — | runs the app against the athlete's existing AI loop for one block and records the disagreements — the first evidence in this repository from a real athlete rather than a synthetic corpus |
| 9 | [Subjective baselines in readiness mode](./phase-9-subjective-baselines.md) | **In progress** | only 9.8 remains (9.1–9.7 done — 9.8 needs Phase 9.0's prospective evidence) | — | self-normalises subjective scores as a tighten-only drift term, measured behind a default-off selector before any ship decision — not an original review finding |
| AJ 5–6 | [AI judge calibration controls & reference audit](./ai-judge-phase-5-6-calibration-and-reference-audit.md) | **In progress** | none | none | evaluates the offline LLM judge against frozen controls and compares compatible reference runs without changing production policy or the committed planner baseline |
| G | [Garmin per-activity telemetry](./garmin-activity-telemetry-ingestion.md) | **Implemented** | none | none | ingests per-activity power/HR time-in-zone, normalized power and lap averages; the measured zone-credit candidate remains off after an evidence-backed no-ship decision |
| S | [Strength session logging](./strength-session-logging.md) | **In progress (default-off)** | none; all numbered work is built | real logged-history evidence before enabling manual Strength load — [M1.7](./multidomain-session-authoring-execution-and-evidence.md) is the item that starts producing it | closes the strength return path — per-set logging, self-calibrating 1RM, and measured strength load — not an original review finding |
| M | [Multidomain session authoring, execution & evidence](./multidomain-session-authoring-execution-and-evidence.md) | **In progress** | M8.1 | M6 still requires an explicit real-use trigger; repeated-testing implementation has transferred to OV and is not an M blocker/task; M8.2 needs real history and only independently justified M6/OV evidence if required; M9 needs its own named triggers | source-neutral authored sessions, safe mixed-dose execution and occurrence-linked response; specialized field work remains usage-triggered, while repeated testing/progress is owned by OV |
| UX | [Mobile UX/UI redesign](./mobile_ux_implementation_plan.md) | **Implemented** | none | none | mobile-first daily decision flow, single-page rapid check-in, state-first Home layout, unblocked recommendation, 44px+ touch targets, and mobile layout tokens |
| OV | [Performance outcome validation & goal-progress loop](./performance-outcome-validation.md) | **In progress** | OV7 operational evidence; OV4.4/OV6.2 only when their triggers are met | OV7 follows the event/block timeline; OV4.4 needs close-spaced repeats; OV6.2 needs repeated report use; OV8 needs multiple prospective blocks | sole implementation/status owner of repeated testing/progress; engineering through OV6.1 is merged (#154/#155/#163/#164/#169), with production selection authority still explicitly excluded |
| HA | [Health anomaly and possible-illness alerting](./health-anomaly-and-illness-risk-alerting.md) | **In progress** | HA7 evidence & prospective accumulation | HA6.4 needs enough labelled personal history; HA7 needs real replay/prospective evidence; HA8/HA9 remain release-gated | explainable physiological-anomaly evidence with structured confounders; HA0–HA5 on `main` (HA5 via #171), HA6.1–HA6.3 prospective labels implemented in PR #174 |

Rows G, S, M, UX, OV, and HA are **not phases**. They are capability/surface plans whose work items are
prefixed `G*`, `S*`, `M*`, `UX*`, `OV*`, `HA*` precisely so they cannot be mistaken for the `Phase 0`–`9`
sequence; the `#` column carries that prefix rather than a phase number. For capability plans, an item
with satisfied dependencies but an unmet usage trigger is **not** listed as startable. A transferred
historical item (former M7) is likewise not listed under its old plan; only the canonical owner tracks it.

Phases 0–8 are implemented. Phase 6 delivered explicit scenario evidence, calibration
traces, coverage visibility, a verified repository-owned local Firestore-rules deployment
and rollback procedure, and an evidence-backed decision to retain production fatigue
fusion. [Phase 7A](./phase-7-weekly-allocation-and-role-reservations.md) implemented the
explicit allocation/reservation contract that resolved the historical greedy role-loss and
recovery-share interaction; the affected cycling scenarios now match the reviewed baseline.
The Phase 5.1 beam-search prototype remains measured but non-production; the live planner
stays greedy until ADR-0015 is revisited.

---

## Decision register

Choices resolved when the plans were approved. Each is argued at the linked location;
this table exists so none of them has to be rediscovered by reading six documents.

| ID | Decision | Where | One-line reason |
|---|---|---|---|
| **D-INJ** | Structured `InjuryConstraint[]` (Option B), not consolidation onto guardrails (Option A) | [1.1](./phase-1-live-defects.md#two-options-and-the-decision) | Guardrails cannot express a modality exclusion, cannot expire, and Phase 5.4 needs the schema anyway |
| **D-KWD** | The keyword matcher is legacy last-resort only; recognised Garmin sessions get an inferred vector | [1.2](./phase-1-live-defects.md) | Routing to it trades a false negative for double credit on one ride |
| **D-GATE** | Coaching invariants gate CI; the simulation snapshot is a non-blocking semantic diff | [0.1](./phase-0-instrumentation.md) | A byte-exact gate would freeze today's known-bad behaviour and make every improvement look like a regression |
| **D-PHASE** | `EventPlanPhase` is the canonical phase vocabulary; `PhaseWeights.phaseName` becomes a derived label | [2.1 D1](./phase-2-plan-intent-authority.md) | It is what a coach actually names, and it can express `travel`, which days-to-event structurally cannot |
| **D-INT** | `intensityScale` gets a consumer (`PlannedDose.intensity`), it is not deleted | [2.1 D2](./phase-2-plan-intent-authority.md) | Taper is volume down / intensity held; collapsing both into one scalar is why taper has to be reconstructed elsewhere |
| **D-LEX** | Lexicographic priority ordering replaces multiplicative composition | [3.2](./phase-3-single-ranking-path.md) | F3 is the proof: two reasonable multipliers composed into a policy nobody chose |
| **D-TIER** | Build the next-day tier selector; do not settle for a `yellow` default | [3.4](./phase-3-single-ranking-path.md) | All three branches are already computed and paid for; only the control is missing |
| **D-AXES** | Delete the `*0.8` / `*0.7` stimulus derivations; templates declare the axes | [4.2](./phase-4-objective-credit-v2.md) | No citation can justify a repository-wide fixed ratio between per-session properties |
| **D-FUSE** | Fatigue fusion is *measured before chosen*, not prescribed now | [4.3](./phase-4-objective-credit-v2.md) | Prescribing a formula here would repeat exactly the uncited-constant practice F11 criticises |
| **D-BEAM** | Beam search is approved to be **built and measured**, not to be shipped regardless of result | [5 increment order](./phase-5-sequence-planning.md) | Whether it beats greedy is empirical; "it didn't" is a valid, useful outcome |
| **D-LIFE** | Recommendations become append-only revisions; decision fields immutable *per revision* | [1.3](./phase-1-live-defects.md) | Same-day recomputation is a real second decision; naive field-pinning would reject it and leave the audit contradicting the UI |
| **D-RECOV** | `EventPlanPhase` gains a canonical `recovery` member | [2.1 D1](./phase-2-plan-intent-authority.md) | Mapping `Post-Event Recovery → build` would make fitness-developing objectives eligible during recovery |
| **D-SUBJHIST** | `throughDateExclusive = D`; today's check-in never enters today's own baseline | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Today's values already enter `overallFatigueScore` at full weight; including them in the baseline would double-count the same measurement |
| **D-SUBJDRIFT** | The subjective term measures persistent adverse recent-vs-long prior history, never an acute today-vs-baseline term | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Today's reading already enters unnormalised; an acute term would double-count the noisiest input |
| **D-SUBJADD** | A separate `subjectiveDrift` contribution, not a modification of `objectiveStrain` | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Keeps `DecisionScoreTelemetry`'s components independently readable and reconciling to the total |
| **D-SUBJFLOOR** | Absolute subjective thresholds stay as hard floors; drift may only escalate | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | A chronically elevated soreness baseline must never read as "normal, proceed" |
| **D-SUBJCOV** | Recent-state and long-reference coverage are tracked and required separately | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Ten observations bunched early in a 28-day window can satisfy one combined count while saying nothing about the recent state the term measures |
| **D-SUBJEST** | Estimator details (windows, scaling, variability floor/cap, weights) are versioned policy, not ADR invariants | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Same discipline as D-FUSE; Phase 9.6 must report sensitivity rather than presenting one setting as physiological fact |
| **D-SUBJPURE** | Baselines arrive precomputed; the readiness evaluator stays pure and synchronous | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Objective baselines already arrive as data on the snapshot; subjective should not be the one that needs a history provider |
| **D-SUBJANCHOR** | Never show the subjective baseline before a check-in is submitted | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | `initialSubmittedAt`/`editedAfterWearableReveal` already record that pre-submission context contaminates a check-in |
| **D-SUBJCAL** | Coefficients and the estimator come from evidence; synthetic scenarios alone cannot authorize shipping | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | Same discipline as D-FUSE, extended: a synthetic-only result is not sufficient prospective evidence |
| **D-SUBJAUDIT** | Persist compact normalized drift provenance only when it can affect a decision | [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) | An audited decision that depended on prior history is not reproducible without recording which policy and how many days it rested on |
| **D-GAUGE** | Set intensity persists as a tagged gauge (`rir`, `rpe_rts`, `velocity_loss`, `technical`); no conversion on write, conversion allowed on read | [ADR-0021](../adr/0021-strength-session-logging-and-intensity-gauges.md) | RPE and RIR are one scale inverted, but power work is quality-limited rather than failure-limited; a bare number makes the two indistinguishable and corrupts 1RM estimation |
| **D-SETLOG** | The raw per-set log is the source of truth; every derivation is recomputable from it and none is written back into it | [ADR-0021](../adr/0021-strength-session-logging-and-intensity-gauges.md) | ADR-0005's rebuild philosophy applied to athlete-entered data: a changed formula must be a recomputation, not a data-loss event |
| **D-1RMSRC** | A derived 1RM joins `targetSources` as its own rung and never overwrites `manual` or `coach` | [ADR-0021](../adr/0021-strength-session-logging-and-intensity-gauges.md) | `targetSources` exists precisely to stop an automated value replacing a human-set one; writing blind reintroduces that bug from a new direction |
| **D-STRCOST** | Strength load reaches the engine only after measurement; built default-off, coefficients from evidence | [ADR-0021](../adr/0021-strength-session-logging-and-intensity-gauges.md) | Same discipline as D-FUSE and D-SUBJCAL; a tonnage→fatigue coefficient asserted in an ADR is the uncited-constant practice F11 criticised |
| **D-DETAIL-GATE** | Detail ingestion is default-off, limited to non-easy power-bearing activities in the target-date daily pass, and never runs in lookback/backfill/rebuild | [ADR-0005 amendment](../adr/0005-raw-archive-store-and-rebuild-pipeline.md#2026-08-17-amendment-bounded-per-activity-detail-ingestion) | Bounds live calls to `3 × N`, avoids overlapping-window refetches, and keeps historical operations offline |
| **D-ZONECRED** | A complete cycling power-zone distribution may produce a default-off direct-share stimulus candidate inside `measuredEffort`; production remains TE-derived | [ADR-0022](../adr/0022-zone-derived-completed-training-credit.md) | Granularity is measured without pretending it establishes exact intent or calibrated dose-response |
| **D-MODE** | `evergreen` and `event_directed` are first-class modes; event strategy is a separate capability | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Cycling can use a structured plan while other existing event categories retain demand-derived direction |
| **D-DOSE** | Evidence-derived adaptation dose precedes capacity and role packing | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Exercise evidence speaks in dose dimensions; a session is a container, not the physiological requirement |
| **D-CAP** | Real sessions, minutes, and windows constrain dose packing; they do not define the dose | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Three 25-minute sessions and three 90-minute sessions are not equivalent capacity |
| **D-COVSET** | The coverage catalog becomes a named generic-plan registry, not an event-shaped module constant | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Evergreen needs to be a peer plan descriptor, not a fabricated event phase |
| **D-OWNERSHIP** | Each preference field has one persisted authority | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | Two live preference models create contradictory valid states with no safe merge rule |
| **D-ORG** | Persist only executable Auto/Adaptive Hybrid policy | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | A valid stored choice must not make normal recommendation generation fail |
| **D-TAPERSCOPE** | Taper requires a real event; a star rating is not one | [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) | `deriveEventPriority(5) → 'A'` currently grants a dated `general_target` goal a 14-day taper |
| **D-RESERVE** | Allocate exact, eligible minimum coverage roles before support work | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Anchor modifiers cannot preserve a future role opportunity in a greedy loop |
| **D-FEASIBILITY** | Reuse production eligibility and revalidate reservations after every pick | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | A second planner would drift from safety, spacing, and fatigue gates |
| **D-BOUND** | One deterministic search budget; exhaustion is `unresolved_search_budget`, never a miss | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | A wall-clock cut-off would make identical input plan differently on different devices |
| **D-SUPPORT** | Supporting work may not destroy the last safe allocation | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Reduced-dose support is useful only when it preserves required role opportunity |
| **D-MISS** | Forecast required-role misses are typed, first-class diagnostics | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | Safety-forced omission must be distinguishable from a scheduling defect |
| **D-NO-BEAM** | Keep production greedy; do not treat this fix as beam-search adoption | [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) | ADR-0015 deferred adoption for measured latency and coaching-review reasons |
| **D-EXT** | `externally_planned` is a third planning mode; the generated planner is retained as a labelled fallback | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Selection and adjudication are already separate modules; only selection is being replaced |
| **D-CANDIDATE** | An imported session is a candidate, never a prescription — every gate applies | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | It is the only thing the app does that reading the plan on a phone does not |
| **D-SHIM** | Imported sessions reach the engine as synthetic templates, not by widening `Recommendation` to a union | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Confines the change to one adapter instead of six modules, and keeps replay coherent |
| **D-EXTTIER** | Imported sessions get an `authoredExternal` rung on the existing evidence ladder; no cost input is accepted | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | An AI asked for a calibrated load figure supplies a confident one, silently moving the `modify` ceiling |
| **D-RELDATE** | Sessions carry week index and day preference; the plan header carries one absolute date | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Removes calendar arithmetic from the authoring AI, where LLM plans most reliably fail |
| **D-IMMUT** | The imported revision is immutable and content-hashed; placement is a separate overlay | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | ADR-0010 replay needs the exact bytes a decision was made from |
| **D-NOTRAVEL** | Travel stays an `AuthoredPlanBlock` and is excluded from the import schema | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Travel is the athlete's calendar; including it would apply the dose reduction twice |
| **D-CRITIQUE** | The weekly planning machinery is repointed to advisory critique, not retired | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | An external AI holds no fatigue state or adherence history and cannot produce this |
| **D-NOPARSE** | JSON import only; no in-app model call in this phase | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | A non-deterministic transform at the persistence boundary conflicts with ADR-0010 |
| **D-EVENT** | A target event reconciles onto `FixedActivity` and is adjudicated for advice, never permission | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Telling an athlete to skip a race they entered is not the speech act the app has standing to make |
| **D-IRREDUCIBLE** | `scaling.reducible: false` sends a short-of-full readiness to `defer`, not to a prescribed compromise | [ADR-0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Otherwise "ride easy and retry Thursday" gets prescribed as the same session at lower volume |
| **D-MSESSION** | `SessionDefinition` is the source-neutral executable content contract; catalog, external and manual sources adapt to it | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Eliminates separate source models across runner, authoring, and planning |
| **D-MRECORDS** | Definition, occurrence, execution prescription and performed execution are distinct records/lifecycles | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Separates static authored definitions from mutable execution state and historical audit |
| **D-MAUTH** | Date-scoped athlete occurrences explicitly replace/add; `save_only` creates no occurrence, `schedule`/`unplanned_log` have no engine surface | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Enforces hard clinical/readiness gating while keeping execution runners accessible without engine entanglement |
| **D-MENTRY** | Performed rows are subcollection entries; v1 Strength arrays remain read-only compatible | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Prevents document write contention during live set logging and avoids bulk migrations |
| **D-MSNAP** | Recommendations store reference-only bindings (`prescriptionHash`); snapshots live in separate write-once content-addressed documents | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Eliminates Firestore document size pressure while preserving bit-exact replay |
| **D-MCHOICE** | Authored branch points are bounded option sets presented to the athlete, not evaluated rules | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Keeps execution purely deterministic without runtime script evaluation |
| **D-MOBS** | Metrics retain unit, source, protocol, validity and comparison-series provenance | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Prevents uncalibrated comparisons across disparate testing conditions |
| **D-MRESP** | `DailySubjectiveCheckin.tissueResponses` remains the sole tissue authority; response records store occurrence linkage | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Preserves single source of truth for tissue readiness |
| **D-MPOLICY** | Step-derived profiles, response-based progression, automatic option selection and domain exposure remain default-off evidence candidates | [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md) | Adheres to repository evidence discipline before promoting candidates to production |

Five of the **accepted** decisions — **D-KWD**, **D-GATE**, **D-LIFE**, **D-RECOV**, and the
withdrawal inside **D-FUSE** — correct errors in earlier drafts and came out of PR #5 review
rounds rather than from the original analysis.

### Archived

* [Workout library expansion](./0000-workout-library-expansion.md) — `Implemented`
  2026-08-07. Retained because §1.2 is still the fullest written description of the
  two selection paths; its line references are stale (see F9).

---

## Task status

Every work item inside a plan carries a status marker on its heading and a matching row in
that plan's **Task board**:

| Marker | Meaning |
|:--:|---|
| `[ ]` | Not started |
| `[-]` | In progress |
| `[x]` | Finished |

Update **both** the heading marker and the board row in the same commit — a board that
disagrees with its headings is worse than no board, because it will be trusted.

A task is `[x]` only when its own *Done when* condition holds, not when the code was
written. Where a task's outcome is a measurement rather than a migration (notably Phase
5.1), recording a negative result satisfies it — see D-BEAM.

Phase-level `Status` (`Approved` / `Ready`) is about the *plan*; task markers are about
the *work*. A `Ready` plan can be entirely `[ ]`, and an `Approved (blocked)` plan should
be.

---

## Conventions that exist because they were violated

Both of these were added after a document in this directory misled a reader. They are
cheap to follow and the failure mode is expensive.

### Reference symbols, never line numbers

Write `` `rules.ts` `evaluateEnvelopes` `` or `` `prescription.ts:workoutForTemplate` ``.
Do **not** write `` `rules.ts:544-556` ``.

Line numbers drift within hours of being written. A 2026-08-08 audit of this directory
found 91 line references, and a six-sample spot check found **three already pointing at
the wrong code** — all written the same day. An agent following a stale line reference
lands on unrelated code and either acts on it or burns time reconciling it. Symbol names
survive refactors, are greppable, and fail loudly when renamed rather than silently
pointing somewhere plausible.

### An `Implemented` plan must not read like a work list

When a plan flips to `Implemented`, **strike through or delete its findings, "problems
found", and "fix this" sections**, keeping the outcome summary. Do not leave a
pre-implementation problem statement sitting in the present tense.

This is not hygiene. On 2026-08-08 an already-fixed P1 from
[`0000-workout-library-expansion.md`](./0000-workout-library-expansion.md) §1.3 was
re-reported as a live defect three times — in two PR comments and a summary — because the
archived plan still described it in the present tense with a "fix in Phase 1"
instruction. `Status: Implemented` in the header was not a strong enough signal; the body
read as current, so it was treated as current.

Every archived plan therefore also carries a reader warning at the top stating that it is
a historical record and that its findings must be verified against the code before being
acted on.

---

## Writing a plan

Keep them executable. A plan that cannot be picked up by someone who did not write it is
not finished. Each should have:

1. **Goal** — one or two sentences, no preamble.
2. **Preconditions** — what must be true before starting.
3. **Work items** — numbered, each naming real files and a concrete change.
4. **Tests to add** — named, with the behaviour asserted.
5. **Acceptance criteria** — a checklist that can be verified, not described.
6. **Risks & rollback** — including what to do if the change is wrong.
7. **Out of scope** — the adjacent work this plan deliberately does not do.
8. **Docs to update** — ADRs to write or amend, architecture docs to correct.

Reference symbols rather than line numbers (see the convention above).

Each work item should be implementable by someone who has not read the rest of the
document: name the real files, state the current behaviour, state the change, and give a
verifiable *Done when*. If a task needs a decision made first, say so and point at the
decision register rather than leaving the implementer to choose.

Prefer to state the smallest change that closes the finding. Where a plan proposes both a
tactical fix and a structural one, say which unblocks work now and which is the
destination.
