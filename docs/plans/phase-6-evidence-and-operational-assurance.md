# Phase 6 — Evidence-driven calibration and operational assurance

* **Status:** Draft
* **Blocked by:** approval of the measurement contract for Tasks 6.1–6.3; production
  Firebase project identity and deployment owner for Task 6.4
* **Unlocks:** evidence-backed changes to fatigue fusion and tuned decision thresholds
* **Addresses:** remaining portions of F11, F12, and F15 in
  [`2026-08-09-phase-0-5-completion-review.md`](../analysis/2026-08-09-phase-0-5-completion-review.md)
* **Rough effort:** 4–7 focused days, excluding any later fatigue-policy experiment

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Blocked by | Summary | Primary files |
|---|:--:|---|---|---|
| 6.1 | `[ ]` | measurement-contract approval | Make scenario runs reproducible observations; separate report generation from baseline mutation | `simulation/scenarios.ts`, `simulation/analyze.ts`, `scripts/simulate-*.mjs` |
| 6.2 | `[ ]` | 6.1 | Add targeted multi-event, fixed-activity, load/readiness, and completion-evidence scenarios | `simulation/scenarios.ts`, `scenarios.test.ts`, `goldenWeek.test.ts` |
| 6.3 | `[ ]` | 6.1, 6.2 | Report decision-critical telemetry and distinguish contract from observational scenarios | `simulation/analyze.ts`, `scripts/simulate-scenarios.mjs`, `docs/analysis/` |
| 6.4 | `[ ]` | Firebase project and deployment-owner decision | Establish a Firestore-rule source of truth and detect deployed-rule drift | `.github/workflows/`, Firebase configuration, `docs/ops/` |
| 6.5 | `[ ]` | evidence review from 6.1–6.3 | Decide whether a fatigue-fusion experiment is justified; retain `max()` if it is not | `engine/fatigue.ts`, `docs/adr/`, `docs/architecture/` |
| 6.6 | `[ ]` | evidence review from 6.1–6.3 | Add useful coverage reporting without an arbitrary coverage gate | `package.json`, `.github/workflows/ci.yml`, test reports |

---

## Goal

Make future recommendation-policy changes measurable and explainable without storing raw
athlete health data, and close the operational gap between tested Firestore rules and the
rules actually serving users. This plan does **not** pre-approve a new fatigue formula or
a numeric coverage threshold.

## Why this is a separate phase

Phase 0 already supplies a blocking scenario gate, while ADR-0014 records why the current
fatigue fusion remains `max()`: the one tested capped-addition alternative was worse on
the available aggregate measure. That is enough to reject an unsupported retune, but not
to claim physiological calibration.

The current `AthleteScenario` contract is intentionally simple: one event, a static
context, a week-level readiness function, and no seeded completion history or fixed
activities. It cannot exercise the multi-event authority, fixed-activity, local-tissue,
or load-versus-readiness boundaries introduced by later phases. Adding scenarios without
making those inputs observable would inflate the count without improving the evidence.

The emulator validates committed `firestore.rules`; it cannot establish that a production
Firebase project serves that same file. That is a deployment-ownership question first,
not an engine-simulation question.

---

## `[ ]` 6.1 — Reproducible scenario observations and baseline ownership

### Change

1. Split report generation from baseline updates.
   - `simulate:scenarios` writes only generated artifacts under
     `app/artifacts/simulation-reports/`.
   - Add an explicit, reviewed `simulate:update-baseline` command. It is the only command
     allowed to overwrite `docs/analysis/simulation-baseline.json`.
   - Make `simulate:diff` compute fresh current output in memory and compare it with the
     committed baseline without mutating either input. It fails clearly when the baseline
     is absent or malformed.
   - CI runs the scenario gate and semantic diff but never updates the baseline.
2. Extend `AthleteScenario` compatibly rather than replacing existing fixtures:
   - `events?: UserEvent[]`, retaining the current `event` as a temporary single-event
     shorthand;
   - `initialHistory?: CompletedExposure[]` for load and completion-evidence seeding;
   - `fixedActivities?: FixedActivity[]` threaded to the week-ahead planner options;
   - `readinessForDate?(date, weekIndex)` while preserving `readinessForWeek` as the
     default.
3. Keep scenario dates as `Europe/Warsaw` calendar-date strings and continue using
   `addDaysToLocalDateString`; do not derive fixture dates through UTC serialization.

### Tests

* A scenario run leaves the committed baseline byte-identical.
* Only `simulate:update-baseline --reviewed` can alter the baseline.
* `simulate:diff` detects a deliberate semantic difference after a scenario report run.
* Existing fixtures preserve their output when omitting the new optional fields.

### Done when

The baseline is an intentional review artifact, not a test side effect, and the harness
can represent multiple events, carried load, fixed activities, and date-level readiness.

---

## `[ ]` 6.2 — Targeted scenario set

Keep the existing 11 scenarios as controls. Each addition names one decision risk, uses
fixed synthetic inputs, and is classified as a blocking contract or an observational
diagnostic.

### 6.2a — Multi-event taper conflict

Add `multi_event_taper_conflict`: an A-priority cycling event inside taper and a nearby
scheduled B-priority event with overlapping demand.

* Contract: `evaluatePeriodizationPhase` reports one taper authority.
* Contract: `resolveMultiEventObjectives` includes eligible contributor demand, takes the
  maximum rather than sum on collisions, and records a taper-incompatible quality drop.

### 6.2b — Travel and fixed-activity week

Add `travel_fixed_activity_week`: a fixed travel activity with an
`availabilityOverride`, constrained environment, and unavailable equipment.

* Contract: `resolveAvailability` applies the restrictive budget before selection.
* Contract: selected templates fit time, environment, and equipment.
* Observation: record the effect on next-day projected fatigue and objective urgency.

### 6.2c — External load despite good readiness

Add `external_load_green_readiness`: consecutive high-cost completed exposures in
`initialHistory`, followed by green wearable and subjective readiness.

This is **observational at first**. Report raw external, clamped external, internal, and
combined fatigue; selected cost; mode; and recovery spacing. It must not assert a new
fusion formula before an evidence review specifies the desired outcome.

### 6.2d — Readiness crash and controlled return

Add `readiness_crash_then_return`: poor readiness for several dates followed by a nominally
green date.

* Contract: no lower-body spacing, injury, availability, or equipment constraint breaks
  during the return.
* Observation: record whether the return creates an abrupt selected-cost or urgency jump.

### 6.2e — Inferred and partial completion evidence

Add `inferred_partial_completion`: exact prescribed, Garmin-inferred, and
partial-duration completed exposures.

* Contract: exact, inferred, and partial evidence obey documented fractional-credit and
  cost semantics.
* Contract: lower-confidence evidence cannot silently resolve a full-credit objective.

### 6.2f — Tissue response stays an integration contract

Do not force `DailyCheckin` state through this planner-only harness. Extend integration
coverage from `mapContextFromGoalsAndTrainingSettings` through
`resolveEffectiveInjuryConstraints` and the optimizer instead.

* Green wearable input plus moderate/severe regional tissue response excludes matching
  mechanical work.
* A tissue response can tighten, but never weaken, a standing constraint.

### Done when

Every scenario has a stated risk and expected observable, with contracts reserved for
safety and policy guarantees rather than exact selection distributions.

---

## `[ ]` 6.3 — Telemetry, review contract, and calibration evidence

1. Extend `ScenarioResult` with a daily trace: date, readiness tier, mode, selected
   template/category, selected cost, raw external fatigue, clamped external fatigue,
   internal response, combined fatigue, objective credits, and hard-gate reasons where
   available.
2. Add `classification: 'contract' | 'observational'` to scenario metadata. Contract
   failures block CI; observational scenarios remain visible in reports and semantic diff.
3. Report trigger frequency by scenario and in aggregate: readiness mode, fatigue tier,
   recovery selection, objective misses, hard-gate rejections, and fragile selections.
   Link to a named rule only where the relationship is unambiguous.
4. Keep fixtures synthetic and documented. Do not commit raw Garmin payloads, check-ins,
   Firebase exports, or re-identifiable health data.
5. For each deliberate policy change, add a dated analysis note identifying the mechanism,
   affected scenarios, and whether coach/product approval was required.

### Done when

A reviewer can explain a changed recommendation trace without rerunning the engine, and
the report distinguishes external load from internal response.

---

## `[ ]` 6.4 — Firestore-rule deployment authority and drift detection

### Required decision

Identify production Firebase project(s), deployment owner, and whether rules are deployed
manually, by another repository, or here. Do not guess a project ID or grant CI production
credentials while resolving this.

### Change after the decision

Choose and document exactly one source-of-truth model in `docs/ops/`:

* **Repository-owned deployment:** reviewed Firebase configuration and a least-privilege
  deployment workflow, with a protected production environment and approval gate; or
* **External deployment owner:** scheduled/read-only authenticated drift check that
  compares the deployed ruleset identifier or contents with `app/firestore.rules` and
  supplies remediation instructions on mismatch.

Retain `npm run test:rules`; deployed-file identity is an operational check, not a
substitute for emulator behaviour tests.

### Done when

The repository can state which rules protect users, who changes them, and how a mismatch
is detected before treating emulator results as production assurance.

---

## `[ ]` 6.5 — Fatigue-fusion experiment decision gate

### Preconditions

* Tasks 6.1–6.3 identify a concrete undesirable trajectory.
* At least one candidate has a written interpretation of external load versus internal
  response, expected failure modes, and rollback path.
* A coach/product owner approves success criteria; lower rest-day percentage alone is not
  sufficient.

### Protocol

1. Leave production `fatigue.ts` on `max()`.
2. Implement candidates behind a simulation-only selector, reusing the real planner and
   gates as `compare:sequence-search` does.
3. Compare full-scenario contract results, decision traces, constraint violations,
   rest/recovery distribution, objective completion, and runtime.
4. Write an ADR only if a candidate is adopted. Retaining `max()` is valid completion.

### Done when

There is an evidence-backed adoption with policy-version bump and updated baseline, or a
written decision to retain `max()` with the evidence ruling out available candidates.

---

## `[ ]` 6.6 — Coverage visibility, not a vanity gate

Generate frontend and backend coverage reports on demand and publish summaries as CI
artifacts. Do not introduce a global percentage threshold initially. Add a targeted
threshold only after an escaped defect demonstrates a specific critical-module gap.
Engine contracts, emulator tests, type checks, and scenario invariants remain blocking.

### Done when

Coverage guides review without incentivizing low-value tests or replacing behaviour-based
gates.

---

## Acceptance criteria

- [ ] Scenario generation cannot overwrite the committed semantic baseline accidentally.
- [ ] The harness has deterministic multi-event, initial-history, fixed-activity, and
      date-level readiness inputs while legacy fixtures remain valid.
- [ ] The targeted scenario risks and tissue integration contract are covered.
- [ ] Daily reports distinguish external, raw-external, internal, and combined fatigue.
- [ ] Contract scenarios block CI; observational scenarios remain visible in reports and
      semantic diff.
- [ ] No raw or re-identifiable athlete health data is committed.
- [ ] Firestore deployment ownership and drift detection are documented and implemented
      only after the production-project decision.
- [ ] Any adopted decision-policy change bumps `POLICY_VERSION`, passes the drift guard,
      and has a dated evidence note.
- [ ] Coverage reporting is available without an arbitrary global threshold.

## Risks and rollback

* **False certainty from synthetic fixtures:** label every result synthetic; never call it
  clinical calibration. Roll back unsupported policy experiments by retaining `max()`.
* **Scenario brittleness:** only safety/contract assertions block CI; selection
  distributions remain reviewed observations.
* **Sensitive-data leakage:** use generated fixtures only; reject payloads and exports.
* **Production deployment risk:** add no CI credential or rule deployment until ownership
  and protected-environment decisions are approved.
* **Baseline churn:** require the explicit reviewed update command and PR explanation.

## Out of scope

* A new fatigue formula or clinical recovery claim.
* A generic code-coverage percentage gate.
* Automatic production rule deployment before the ownership decision.
* Replacing unit, emulator, or integration tests with scenario simulation.

## Docs to update when tasks land

* `docs/architecture/recommendation-engine.md` — scenario inputs, telemetry, and any
  adopted fatigue policy.
* `docs/ops/` — Firestore-rule source of truth and drift-response runbook.
* `docs/adr/` — only for an adopted fatigue policy or deployment architecture decision.
* `docs/analysis/` — dated evidence note for intentional semantic changes.
