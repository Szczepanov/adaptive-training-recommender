# Phase 6 — Evidence-driven calibration and operational assurance

* **Status:** In progress
* **Blocked by:** no phase-wide blocker. Task 6.5 requires the production Firebase project
  identity and deployment owner; Task 6.7 requires evidence from 6.3–6.4 before any
  production fatigue-policy experiment can be proposed.
* **Unlocks:** trustworthy policy calibration, explicit handling of the remaining Phase 5
  integration gaps, and operational confidence that the rules tested in CI are the rules
  protecting production data.
* **Addresses:** remaining portions of F11, F12, and F15, plus two Phase 5 carryovers that
  are not original review findings: mid-horizon multi-event objective re-resolution
  (Phase 5.6) and fixed-activity projection/availability semantics (Phase 5.3).
* **Rough effort:** 7–12 focused engineering days for 6.1–6.6, excluding external access
  delays for 6.5 and any later fatigue-policy candidate experiment in 6.7.

---

## Execution order

Phase 6 is deliberately split into correctness, measurement, and operations. Do not start
with coefficient tuning.

1. **6.1 — Baseline ownership**: make the existing harness safe to run. **Implemented in
   this PR.**
2. **6.2 — Close the two Phase 5 correctness carryovers**: fix behavior that can change a
   real recommendation before adding more calibration machinery. **Implemented.**
3. **6.3 — Expand the deterministic scenario input contract and targeted cases** so the
   fixed behavior is permanently exercised.
4. **6.4 — Add decision traces and calibration reports**. This is the F11 evidence layer;
   it measures policy activation, it does not auto-tune constants.
5. **6.6 — Coverage visibility** can proceed in parallel with 6.3–6.4 because it does not
   change decision behavior.
6. **6.5 — Firestore deployment assurance** starts as soon as production ownership is
   identified; it is operationally independent from the recommendation engine work.
7. **6.7 — Fatigue-fusion decision** is last. `max()` stays production behavior unless the
   evidence collected above demonstrates a concrete failure mode and a candidate improves
   it without violating contracts.

Any change in 6.2 or an adopted change in 6.7 that can alter a persisted recommendation
must bump `POLICY_VERSION` in the same commit and pass `check-policy-drift.mjs`.

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.

| Task | Status | Blocked by | Outcome | Primary files |
|---|:--:|---|---|---|
| 6.1 | `[x]` | — | Scenario runs cannot mutate the committed baseline; reviewed baseline update is explicit | `scripts/simulate-scenarios.mjs`, `scripts/simulate-diff.mjs`, `scripts/simulate-update-baseline.mjs`, `package.json` |
| 6.2 | `[x]` | — | Closed Phase 5.6 mid-horizon objective drift and Phase 5.3 fixed-activity projection semantics, including the live day-0/day-1 path, not only the week-ahead forecast; `POLICY_VERSION` bumped to `2026-08-phase6-correctness-carryovers-v1` | `planner.ts`, `periodization.ts`, `schedule.ts`, `models.ts`, `policy.ts`, `optimizer.ts`, `rules.ts`, `sequenceSearch.ts`, `validation.ts`, `firestore.rules`, `components/Home.tsx`, plus corresponding tests |
| 6.3 | `[ ]` | 6.2 interface decisions | Scenario harness can represent the real boundaries added in Phases 4–5 and permanently exercises them | `simulation/scenarios.ts`, `simulation/analyze.ts`, `scenarios.test.ts`, integration tests |
| 6.4 | `[ ]` | 6.3 | Produce daily decision traces and reproducible trigger-frequency/calibration reports without auto-tuning | `simulation/analyze.ts`, new calibration/report script, `docs/analysis/` |
| 6.5 | `[ ]` | production Firebase project + deployment owner | Detect drift between repository rules and deployed rules | `.github/workflows/`, Firebase config, `docs/ops/` |
| 6.6 | `[ ]` | — | Publish frontend/backend coverage as review evidence without a vanity global threshold | `app/package.json`, `pyproject.toml`, `.github/workflows/ci.yml` |
| 6.7 | `[ ]` | evidence review from 6.3–6.4 | Adopt a fatigue-fusion change only if evidence justifies one; retaining `max()` is valid completion | `engine/fatigue.ts`, simulation-only comparison code, ADR/analysis docs |

---

## Decisions fixed by this plan

These are implementation decisions, not open questions for the engineer picking up the
work.

### D6-A — Historical credit is not revoked by a future phase transition

When a multi-event objective definition changes mid-horizon, credit already earned or
projected on an earlier day remains valid. The planner re-resolves the **future objective
definition**, not history. For the same `ObjectiveKey`, carry `completedCredit`,
`projectedCredit`, and the compatibility projection forward; update the current title,
qualification, target stimulus, priority, and required amount from the newly resolved
objective definition. An objective that disappears stops influencing later ranking but its
past credit remains in the trace/audit.

Reason: a threshold session that was admissible and prescribed on Monday does not become
physically undone because an A-event enters taper on Wednesday.

### D6-B — Fixed-activity venue metadata is not automatically a whole-day restriction

`FixedActivity.environment` and `FixedActivity.equipment` describe the fixed activity
itself. A football match at an outdoor field does **not** imply that a separate morning
session must also be outdoor or limited to football equipment. Do not simply intersect
these fields with the athlete's standing equipment for the whole day.

A fixed activity affects planning in three distinct ways:

1. **time/availability** — `durationMin` and `availabilityOverride` constrain the day;
2. **projected training exposure** — `expectedStimulus` and `expectedCost` influence
   objective credit and adjacent-day fatigue;
3. **whole-day context only when explicitly authored** — if travel/location truly changes
   what is available for every additional session that day, add a separate optional
   `availabilityContextOverride` rather than overloading activity venue fields.

### D6-C — Unknown planned load is zero, not an invented heuristic

Do not turn a missing `FixedActivity.expectedCost` into an arbitrary default such as
`systemic: 0.2`. Missing expected load means "unknown/not modelled" and contributes zero
projected load while the activity's time remains reserved. If product later requires a
fallback estimate, it must be a named policy with evidence and policy-versioning.

### D6-D — `fixed: false` remains conservative under the greedy production planner

A movable placeholder still occupies its authored date until a production sequence
planner can actually choose and persist a different date. Phase 6 does not pretend that
`fixed: false` is rescheduled automatically. If beam/sequence search is later promoted,
movable-activity relocation becomes part of that adoption plan.

### D6-E — Synthetic scenarios are policy-regression evidence, not physiological calibration

Synthetic fixtures can prove invariants, expose threshold activation, and compare policy
variants. They cannot establish that a fatigue threshold is physiologically correct.
Any document or report generated in this phase must keep that distinction explicit.

---

## `[x]` 6.1 — Baseline ownership and reproducible semantic diff

### Implemented in this PR

`npm run simulate:scenarios` now generates the report and runs the aggregate invariant
gate **without writing** `docs/analysis/simulation-baseline.json`.

`npm run simulate:update-baseline -- --reviewed`:

1. refuses to run without the explicit `--reviewed` flag;
2. runs a fresh simulation first, so a stale artifact cannot become the baseline;
3. only writes the baseline if the simulation/gate completes successfully;
4. normalizes `commit` and `capturedAt` to stable baseline values.

`npm run simulate:diff` already computes current results independently; it now also fails
with a targeted message when the baseline is absent, malformed JSON, or lacks a scenarios
array.

### Acceptance

- [x] normal scenario generation leaves the committed baseline untouched;
- [x] baseline mutation requires a separately named command and `--reviewed`;
- [x] baseline update always regenerates the scenario report first;
- [x] malformed/missing baselines fail clearly;
- [x] CI can continue running `simulate:scenarios` followed by `simulate:diff` without
      rewriting its comparison input.

---

## `[x]` 6.2 — Close Phase 5 correctness carryovers

This task is intentionally before calibration. Both sub-items affect what the live planner
can recommend.

> Landed as one PR rather than the two separate PRs (6B/6C) suggested under "Recommended
> PR slicing" below -- 6.2a and 6.2b touch overlapping code (`planner.ts`'s per-day loop,
> `ResolvedAvailability`) closely enough that splitting them would have meant threading one
> half's plumbing through the other's review. Both are covered by the single
> `POLICY_VERSION` bump (`2026-08-phase6-correctness-carryovers-v1`) and the same semantic
> diff below.

### 6.2a — Re-resolve multi-event objectives across the forecast horizon

#### Current behavior

`prepareWeekAheadPlanSeed` resolves contributor objectives at `todayDate` and
`generateWeekAheadPlan` carries that objective set through the whole strip. Although
`evaluatePeriodizationPhase(events, date)` is recomputed each projected day, contributor
admissibility is not. An authority entering taper on day 3 can therefore leave a
`threshold_quality` contributor active on days 3–7 even though the same objective would be
dropped if the plan were generated fresh on day 3.

#### Change

1. Extract one helper that resolves the generic objective definition for an arbitrary
   planning date from:
   - current periodization/taper authority;
   - authority objectives;
   - contributor objectives and drop reasons.
2. Before ranking each projected day, resolve that day's definition and reconcile it with
   the current microcycle using D6-A.
3. Reconciliation key is `ObjectiveKey`, not generated object id. Generated ids are an
   implementation detail and can change when objective ordering changes.
4. If an objective becomes inadmissible:
   - remove it from the future unresolved set;
   - retain already earned/projected credit in the trace;
   - record a dated drop reason so the UI/report can explain when the transition occurred.
5. If an objective enters the set mid-horizon:
   - use the newly resolved qualification/target/required amount;
   - restore prior credit for that key if it existed earlier in the same projection;
   - otherwise start from zero.
6. Keep the existing Phase 5 scope boundary: generic multi-event contribution is not
   silently added to authored `PlanDefinition` blocks in this task. That needs a separate
   plan/ADR if desired.

#### Tests

- A-event enters 14-day taper on day 3: contributor `threshold_quality` is present before
  the boundary and absent afterward.
- Contributor enters the 35-day contribution window on day 4: its eligible objective
  appears on day 4, not day 1.
- Credit earned before the boundary remains credited after the objective definition
  changes.
- Two same-key contributors remain deterministic and preserve the existing max-credit /
  modality-union semantics.
- The drop trace contains the effective date and athlete-facing reason.

#### Done when

Generating the week on day 1 and inspecting day N yields the same objective admissibility
as generating a fresh plan on day N from the equivalent projected history.

**Delivered as:** `reconcileObjectivesForDate` (new, `planner.ts`) rebuilds the day's
objective definition via `generateWeeklyObjectives` + `resolveMultiEventObjectives` --
exactly what a fresh plan on that date would produce, respecting the existing plan-derived
vs generic scope boundary -- then reconciles it onto the running microcycle by
`ObjectiveKey`: a survived key keeps its `completedCredit`/`projectedCredit`, a dropped
key's credit is cached in a per-projection `creditMemory` map (restored if the same key
re-enters later in the same horizon, per D6-A), and a genuinely new key starts at zero.
Called before ranking on every day the loop itself picks a template (today's/tomorrow's
externally-supplied recs are unaffected, since this function doesn't choose them). A
`DroppedContributorObjective.date` field (new) records the actual transition date, and
`accumulateNewDrops` dedupes so a taper that stays active for the rest of the horizon logs
one dated trace entry, not one per remaining day. This also transitively fixes the
*same-event* Build→Specificity/taper transitions the original Phase 5.6 comment didn't
single out -- the fix re-resolves on any periodization change, not only multi-event ones,
which is what moved several scenarios' `threshold_quality` weekly target down once a
mid-week taper correctly stops demanding it (see the reviewed baseline update). Tests:
`planner.test.ts` "Phase 6.2a" describe block (day-3 taper drop with dated trace, day-4
contribution-window entry, credit preserved across a definition change, credit restored on
re-entry) plus the pre-existing seed-level `periodization.test.ts`/`planner.test.ts`
coverage, all still green.

**Amended after manual review (a real gap, not a style note):** a genuinely new key still
started at zero credit even when an earlier day's own pick in the SAME projection would
already have qualified for it -- breaking the "fresh plan on day N from equivalent
projected history" contract for the reconstructed-history half, not just the definition
half. `planner.ts` now tracks a `projectionExposures` ledger (every applied
pick's/fixed-activity's own stimulus, dated) and `reconcileObjectivesForDate` replays the
exposures strictly before `date` against a newly-admitted definition via
`backfillCreditFromPriorExposures`, capped at the objective's required amount and recorded
as `projectedCredit` (not `completedCredit` -- it is still a projection). Tests: two more
cases in the same describe block (backfills from an earlier qualifying exposure; does not
backfill from an exposure dated on/after the reconciled date).

### 6.2b — Treat fixed activities as projected exposures, not just calendar blockers

#### Current behavior

`resolveAvailability` deducts duration and computes a scalar `reservedCapacityCost`, but
that scalar is not consumed by ranking or fatigue. `expectedStimulus` is not used by the
week-ahead projection either. The current fallback of `0.2` systemic when expected cost is
missing would become an undocumented decision heuristic if wired into ranking.

#### Change

1. Replace the scalar reservation concept with a dimensional reserved cost profile (or add
   one while keeping the scalar only as a compatibility field until callers migrate).
2. Sum only explicitly authored `expectedCost` from uncompleted fixed activities on the
   target date; no invented default cost (D6-C).
3. Same-day ranking sees the reserved fixed-activity cost when deciding how much additional
   work is safe. Do not mark that load as already completed before the activity occurs.
4. At the end of the projected date, apply each uncompleted fixed activity as a projected
   exposure:
   - `expectedCost` contributes to next-day external fatigue;
   - `expectedStimulus`, when present, can earn projected objective credit using the same
     canonical credit primitive as another structured exposure;
   - missing cost/stimulus contributes zero rather than falling back to keyword matching.
5. Preserve the current time semantics: `availabilityOverride` caps the day, then
   `durationMin` is deducted.
6. Keep `environment`/`equipment` as activity metadata (D6-B). If a travel day needs to
   constrain every additional session, introduce and validate an explicit optional
   `availabilityContextOverride` with day-level environment/equipment semantics.
7. `fixed: false` continues occupying its authored date under greedy planning (D6-D).

#### Tests

- Evening football with explicit lower-body/systemic cost makes the following day more
  conservative than the same calendar without the match.
- The same fixed activity with `expectedStimulus` can satisfy part of an appropriate
  objective and prevents redundant additional work.
- A fixed activity without `expectedCost` reserves time but adds zero fabricated fatigue.
- An outdoor football activity does not remove access to a separately available morning
  indoor-bike session merely because its venue equipment is different.
- A true travel-day `availabilityContextOverride` does restrict additional session
  equipment/environment.
- Completed fixed activities are not projected a second time.

#### Done when

A booked training event shapes both the day around it and the following day through its
explicitly authored expected dose, while venue metadata cannot accidentally over-restrict
an unrelated session.

**Delivered as:** `schedule.ts`'s `ResolvedAvailability` gained
`reservedCapacityCostProfile` (dimensional; `calculateReservedCapacityProfile` sums only
authored `expectedCost` fields, D6-C removes the old `?? 0.2` default) and
`environmentOverride`/equipment-intersection from an explicit
`FixedActivity.availabilityContextOverride` (D6-B; the activity's own `environment`/
`equipment` never restrict another session by themselves). `reservedCapacityCost` stays as
a `.systemic`-derived compatibility scalar.

`planner.ts`'s loop folds the day's `reservedCapacityCostProfile` into the fatigue used for
*that day's ranking only* (never into the carried-forward `externalFatigue` ledger, so it's
never marked complete before it happens) and filters candidates by `environmentOverride`.
`applyFixedActivityStimulusCredit`/`fixedActivityCostProfileForDate` (new, module-level,
pure) apply an uncompleted activity's `expectedStimulus`/`expectedCost` to objective credit
and fatigue respectively -- exported so `rules.ts`'s single-day live evaluation
(`evaluateTrainingWithIntent`) can share exactly the same treatment, not a second
implementation of it. `buildOptimizationContext` (`optimizer.ts`) now takes
`fixedActivities` directly and is the single place availability gets resolved for ranking,
removing a latent wiring gap where its own internal `resolveAvailability` call always
passed an empty fixed-activity list regardless of what the caller already had.

**Amended after manual review (real gaps, not style notes):**

* **Stimulus credit was applied AFTER that day's own pick, not before.** A booked activity
  that already satisfied an objective could not stop the optimizer from separately ranking
  and selecting more work for that same still-"unresolved" objective -- only marking it
  resolved once both had already been scheduled. `applyFixedActivityStimulusCredit` is now
  called before `unresolvedObjectives` is computed for ranking (today's own fixed activity
  in `evaluateTrainingWithIntent`; each loop day's in `generateWeekAheadPlan`), while cost
  is still applied after the pick (`applyFixedActivityCost`) since it only becomes real
  once the day has actually happened.
* **The reserved-cost fatigue fusion used `combineMax`, not addition.** A booked activity's
  reserved cost is genuinely additional load stacking on top of whatever fatigue already
  exists, not an independent signal to take the max against -- `max(existing, reserved)`
  silently hid the reservation whenever existing fatigue already exceeded it. Both
  `planner.ts`'s loop and `evaluateTrainingWithIntent` now fuse it via
  `applyCompletedSessionLoad(fatigue, date, reservedCapacityCostProfile)` (elapsedHours=0,
  since the fatigue was already decayed to `date`), the same additive-then-clamped
  semantics a real completed session uses, transiently for ranking only.
* **Today's and tomorrow's own fixed activities had no effect on the live pick at all.**
  `evaluateTrainingWithIntent`/`evaluateNextDayPlanWithIntent` (`rules.ts`) never accepted
  a `fixedActivities` parameter -- only the week-ahead forecast strip (day 2+) saw any of
  this. Both now accept it (defaulting to `[]`) and apply the same availability/reserved-
  cost/stimulus-credit-before-ranking treatment as the week-ahead loop, scoped to that
  call's own date (cross-day cost propagation from an still-uncompleted PRIOR-day activity
  is out of scope here -- each call independently replays real completed history via
  `resolveTrainingIntent`). `Home.tsx` now fetches today's/tomorrow's fixed activities
  (fails open to `[]` with a console warning on a read failure -- an interactive one-day
  decision, unlike the week-ahead strip's fail-closed 7-day forecast) and passes them
  through.
* **`availabilityContextOverride` was not reachable through persistence.**
  `validateFixedActivity` (`validation.ts`) neither validated nor copied the field, and
  `firestore.rules`' `hasValidFixedActivity` excluded it from the `hasOnly(...)` allow-list,
  so a client write containing it would have been silently dropped or rejected outright.
  Both now validate/allow it (mirrored between the two, per the existing convention for
  every other `FixedActivity` field); `FixedActivityService` already round-trips whatever
  `validateFixedActivity` produces, so no separate service change was needed.

Tests: `architecture.test.ts` (D6-C zero fallback, dimensional summation, D6-B
non-restriction, `availabilityContextOverride` equipment intersection and multi-override
intersection), `validation.test.ts`/the emulator suite (`availabilityContextOverride`
accepted/rejected at both validation layers), `planner.test.ts` "Phase 6.2b" describe block
(next-day fatigue delta, completed-activity no-op, stimulus credit via the canonical
primitive, zero-fallback at the plan level, environment-override gating an actual pick,
the additive-vs-`max()` masking regression with non-zero pre-existing fatigue, the
redundant-same-day-work ordering regression), and `trainingIntentAcceptance.test.ts`
"Phase 6.2b" describe block (today's own availabilityOverride/stimulus credit affecting
`evaluateTrainingWithIntent`'s actual pick; tomorrow's own fixed activity affecting
`evaluateNextDayPlanWithIntent`'s provisional plan).

---

## `[ ]` 6.3 — Scenario input contract and targeted regression set

### Input contract

Extend `AthleteScenario` compatibly:

- `events?: UserEvent[]` while retaining `event` temporarily as single-event shorthand;
- `initialHistory?: CompletedExposure[]`;
- `fixedActivities?: FixedActivity[]`;
- `readinessForDate?(date, weekIndex)` with `readinessForWeek` as the fallback;
- optional scenario tags (`multi-event`, `fixed-activity`, `fatigue`, `evidence`, etc.) for
  report grouping.

Do **not** make `classification: contract | observational` a single scenario-level flag.
One scenario can contain both a blocking safety assertion and useful observational
metrics. Classification belongs to the assertion/check, while every scenario can still
emit observations.

Keep all dates as Europe/Warsaw calendar-date strings and use
`addDaysToLocalDateString`; never derive fixture dates through UTC serialization.

### Targeted cases

Keep the existing 11 scenarios as controls and add at least these deterministic cases:

1. `multi_event_taper_conflict_static` — authority already tapering on day 1;
2. `multi_event_taper_conflict_mid_horizon` — authority/contributor boundary on day 2–6;
3. `fixed_football_midweek` — explicit cost/stimulus plus a separate optional session;
4. `travel_day_context_override` — true day-level equipment/time restriction;
5. `external_load_green_readiness` — high recent external load with nominally green
   wearable/subjective readiness;
6. `readiness_crash_then_return` — several poor days then a sudden green day;
7. `inferred_partial_completion` — exact, Garmin-inferred, and partial-duration evidence.

Local tissue response stays an integration test from adapter → injury resolution →
optimizer; do not force UI state through the planner-only scenario harness.

### Contract assertions

Contracts block CI only for safety/policy guarantees, for example:

- no time/equipment/injury/spacing hard-gate violation;
- mid-horizon objective set changes on the actual transition date;
- booked fixed-activity dose affects next-day projection exactly once;
- lower-confidence evidence cannot silently become full-credit evidence;
- a tissue response tightens but never weakens a standing constraint.

Exact category distributions, rest percentages, and optimizer winner identity remain
observations unless a product/coaching decision explicitly promotes them to contracts.

---

## `[ ]` 6.4 — Decision traces and calibration evidence (F11)

### Daily trace

Extend scenario output with enough information to explain a changed recommendation without
rerunning the engine:

- date and readiness tier/mode;
- selected template/category/modality and selected projected cost;
- raw external load, clamped external load, internal response, combined fatigue;
- active objective keys and their completed/projected/required credit;
- contributor objectives dropped/added on that date;
- fixed-activity projected cost/stimulus applied that date;
- hard-gate rejection counts/reasons where available;
- top utility, runner-up utility, best-benefit candidate and selected-vs-best gap.

Keep the trace compact and derived. Do not persist raw Garmin payloads, free-text check-ins,
or Firebase exports.

### Calibration corpus

F11 needs representative evidence, but the first committed corpus should be deterministic
and synthetic, not disguised as clinical data. Build a small curated matrix rather than a
combinatorial explosion. It should cross the decision boundaries that actually exist:

- readiness: clearly green / borderline / clearly poor;
- recent load: low / moderate / high;
- event state: no event / build / specificity / taper;
- constraints: normal / reduced time / equipment-limited / injury-limited;
- completion evidence: exact / inferred / partial.

Target roughly 24–40 named cases with fixed inputs. Every tuned threshold used in the live
engine should have at least one case on each side of the boundary before anyone proposes a
retune.

### Trigger-frequency report

Add a reproducible report command (for example `simulate:calibrate`) that reports, by
scenario and aggregate:

- train/modify/recover mode counts;
- projected fatigue tier counts;
- time/equipment/injury/recovery-spacing rejection counts;
- recovery-session selection frequency;
- objective creation/resolution/miss frequency;
- fragile top-two selections;
- fixed-activity reservation activations;
- multi-event contributor add/drop transitions.

The report is descriptive. It must not print a recommended new threshold merely because a
rule fires frequently.

### Policy-change evidence note

Every deliberate recommendation-policy change after this task lands must include a dated
analysis note containing:

1. mechanism changed;
2. policy version before/after;
3. scenarios affected;
4. contract result;
5. observed distribution changes;
6. reason the change is preferable;
7. rollback condition;
8. whether coach/product approval was required.

### Done when

A reviewer can identify **why** a recommendation changed, which rule boundary activated,
and whether the change broke a contract, without needing private athlete data or an
interactive debugger.

---

## `[ ]` 6.5 — Firestore-rule deployment authority and drift detection (F15)

### External decision required

Identify:

- production Firebase project(s);
- deployment owner;
- whether rules are deployed from this repository, another repository, or manually;
- the credential/identity allowed to perform a **read-only** deployed-rules check.

Do not guess a project id and do not add production credentials merely to satisfy this
plan.

### Choose exactly one operating model

**Repository-owned deployment**

- reviewed Firebase project alias/configuration;
- least-privilege deployment workflow;
- protected production environment and manual approval;
- drift check before/after deployment;
- runbook for rollback to the previous ruleset.

**External deployment owner**

- this repository remains test/source artifact only;
- scheduled or PR-time read-only drift check compares deployed ruleset identity/content
  against `app/firestore.rules`;
- mismatch reports the external owner and remediation path rather than attempting an
  unauthorized deploy.

`npm run test:rules` remains mandatory in both models. Emulator correctness and deployed
identity answer different questions.

### Done when

The repository can name which deployed rules protect users, who owns deployment, and how a
mismatch is detected and remediated.

---

## `[ ]` 6.6 — Coverage visibility, not a vanity gate (F15)

### Change

- Frontend: add the Vitest coverage provider required by `test:coverage` and generate
  machine-readable + human-readable summaries.
- Backend: add `pytest-cov` as a dev dependency and produce XML/text coverage.
- CI publishes both summaries/artifacts on every PR.
- Do **not** add a repository-wide percentage threshold initially.

### When a threshold becomes justified

A threshold may be added only when tied to a specific escaped defect or safety-critical
module, for example "injuryPolicy.ts branches must stay above X because an untested branch
caused Y." Prefer module/branch-specific gates over global line coverage.

### Done when

Coverage makes untested decision code visible in review without rewarding low-value tests
or replacing behavior-based contracts.

---

## `[ ]` 6.7 — Fatigue-fusion evidence gate (F12)

Production remains on `max(external, internal)` until this task proves a reason to change.

### Preconditions

- 6.3 includes external-load-vs-readiness scenarios;
- 6.4 exposes raw external, clamped external, internal, and combined trajectories;
- at least one concrete undesirable trajectory is documented;
- success criteria include safety and objective behavior, not merely fewer rest days.

### Protocol

1. Leave production `fatigue.ts` unchanged.
2. Put candidate fusion functions behind a simulation-only selector.
3. Reuse the real planner, hard gates, scenario contracts, and trace output.
4. Compare:
   - contract violations;
   - day-by-day combined fatigue trajectories;
   - selected cost and recovery spacing;
   - rest/recovery distribution;
   - objective completion/misses;
   - fragile selections;
   - runtime.
5. Explicitly discuss double-counting risk: internal response can already be a response to
   external training load.
6. Adopt a candidate only with an ADR, policy-version bump, reviewed semantic baseline,
   and rollback condition. A written decision to retain `max()` is successful completion.

### Done when

The project has either an evidence-backed replacement or an evidence-backed reason to keep
`max()`. "Another formula looked smoother" is not sufficient.

---

## Overall acceptance criteria

- [x] Normal scenario generation cannot overwrite the committed semantic baseline.
- [x] Baseline update is a separately named, explicitly reviewed operation.
- [x] Multi-event objective admissibility is date-correct across a 7-day horizon and
      preserves already-earned credit.
- [x] Fixed activities affect time, projected objective credit, same-day capacity, and
      adjacent-day fatigue exactly once using explicit authored dose.
- [x] Fixed-activity venue metadata cannot accidentally become a whole-day equipment
      restriction; true travel/day restrictions have explicit semantics.
- [ ] The scenario harness supports multiple events, initial history, fixed activities,
      and date-level readiness.
- [ ] Safety/policy contracts are separated from observational distribution metrics.
- [ ] Daily traces explain readiness, load, objectives, fixed activities, gates, and
      optimizer diagnostics.
- [ ] A deterministic synthetic calibration corpus and trigger-frequency report exist and
      are clearly labelled non-clinical.
- [ ] Firestore deployed-rule ownership and drift detection are documented and implemented
      once production ownership is known.
- [ ] Frontend/backend coverage summaries are available in CI without an arbitrary global
      threshold.
- [ ] Any adopted fatigue-policy change has evidence, an ADR, a policy-version bump, a
      reviewed baseline update, and a rollback condition.
- [ ] No raw or re-identifiable athlete health data is committed.

---

## Recommended PR slicing

Do not land all of Phase 6 as one giant change.

1. **PR 6A — baseline ownership** — the 6.1 work already started here; no engine behavior
   change.
2. ~~PR 6B — multi-event horizon correctness (6.2a only)~~ / ~~PR 6C — fixed-activity
   projected exposure (6.2b only)~~ — **landed together** instead of split; see the note
   under 6.2 above for why. `POLICY_VERSION` bumped once for both.
3. **PR 6D — scenario input contract + targeted cases** — 6.3.
4. **PR 6E — trace + calibration report** — 6.4.
5. **PR 6F — coverage reporting** — 6.6; can run in parallel with 6D/6E.
6. **PR 6G — Firestore drift** — 6.5 after ownership/access decision.
7. **PR 6H — fatigue experiment** — 6.7 only if evidence makes it necessary.

Each behavior-changing PR must include the semantic diff in its description and explain
why every observed change is intended.

---

## Risks and rollback

* **Synthetic evidence mistaken for physiology:** reports must say they are policy tests,
  not medical validation.
* **Objective re-resolution revokes work already done:** D6-A forbids this; preserve
  historical credit and only change future eligibility.
* **Fixed-activity double counting:** projected fixed load must be applied once and omitted
  once actual completion enters history.
* **Over-restricting a day from activity venue metadata:** D6-B separates activity venue
  from day context.
* **Baseline churn:** normal simulation cannot write the baseline; reviewed update remains
  explicit.
* **Operational credential risk:** no production Firebase credential enters CI before the
  ownership model and least-privilege access are approved.
* **Coverage gaming:** no global threshold until a concrete risk justifies one.
* **Fatigue retune by aesthetics:** 6.7 requires a documented failure mode and contract-safe
  evidence.

## Out of scope

* Automatically rescheduling `fixed: false` activities while greedy planning remains the
  production planner.
* Adding multi-event contributors to authored `PlanDefinition` blocks without a separate
  design decision.
* A new clinical recovery model or medical claim.
* Automatic ML tuning of optimizer constants.
* A generic code-coverage percentage target.
* Automatic production Firestore deployment before ownership is decided.
* Replacing unit, emulator, integration, or golden-week tests with simulation.

## Docs to update as work lands

* `docs/architecture/recommendation-engine.md` — fixed-activity projection, scenario trace,
  and any adopted fatigue policy.
* `docs/adr/` — only for a genuine decision such as fatigue-policy adoption or Firestore
  deployment architecture.
* `docs/ops/` — Firestore source of truth, drift-response, and deployment/rollback runbook.
* `docs/analysis/` — dated evidence notes for deliberate semantic policy changes.
* `docs/plans/README.md` — keep Phase 6 status/startable items synchronized with this task
  board.
