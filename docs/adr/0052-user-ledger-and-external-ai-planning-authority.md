# ADR-0052: User Ledger with External-AI Planning Authority

* **Status:** Proposed
* **Date:** 2026-10-25
* **Deciders:** Repository owner
* **Related:** ADR-0003, ADR-0007, ADR-0010, ADR-0012, ADR-0013, ADR-0017, ADR-0019, ADR-0023,
  ADR-0025, ADR-0032, ADR-0033, ADR-0034; issues #893, #895, #897, #962

## Context and Problem Statement

The application has two halves, and the owner now values them very differently.

* **The record.** Garmin, Eight Sleep and multisource health ingestion (`src/garmin_sync/`,
  ADR-0026/0027/0030), structured session execution and the diary (ADR-0023, #895),
  canonical performed-training occurrences (ADR-0034), assessments (ADR-0046/0047, #897),
  anthropometry and nutrition (ADR-0039/0042), goals and events (ADR-0041/0048–0050), and the
  Context Brief export with the `external-plan@5` import round trip (#893).
* **The decider.** About 56k non-test lines in `app/src/engine/`: selection (`optimizer.ts`,
  `planner.ts`, weekly allocation, periodization, evergreen planning) and adjudication
  (`rules.ts` `evaluateReadinessAndSafetyEnvelope`, `eligibility.ts`, `injuryPolicy.ts`,
  `dose.ts`, `fatigue.ts`). These are governed by the knowledge registry (ADR-0033), the
  `POLICY_VERSION` drift check (ADR-0010), and the simulation and plan-judge CI gates.

ADR-0019 already moved *selection* to an external AI in `externally_planned` mode and kept
*adjudication* in the engine (D-CANDIDATE: every imported session passes every gate). It
rejected "replace the generated planner entirely" so that the two could be compared in real use.

That comparison has now happened informally. The owner's experience is that planning in
conversation with an external AI, fed by this app's data, is much more useful than the
generated plan or the engine's adjudication of the imported plan. This is owner judgement,
not a measured result. D-EVAL below defines what must be measured before anything is
deleted.

The engine still costs a lot to keep. Most open non-tracker issues validate or extend engine
decision authority (#637–#640, #642, #648, #649, #806, #872, #920). Every engine constant
needs a registered claim, a coverage item and an alignment test. Any engine edit forces a
`POLICY_VERSION` bump, and every code PR pays for a 20-minute simulation job. Meanwhile, the
part the owner relies on most has acceptance work that is still waiting: real-device and
offline capture (#895, #897, #725–#729).

The question: should the application stop making training decisions and become the
system of record that an external AI plans from? If so, what happens to the engine, its
safety role, and the CI gates built around it?

## Decision Outcome

The application becomes a **user ledger**: a provenance-preserving record of training,
health and user context, with three capabilities, in priority order:

1. **Training tracking:** structured execution, especially gym workouts, as the canonical
   lossless record (ADR-0023, ADR-0034, #895).
2. **User information:** health observations, assessments, body composition, goals, events,
   and athlete-stated context (injuries, equipment, constraints, preferences).
3. **Context export:** a structured, provenance-labelled export for an external AI, and
   import of the plans it writes.

Planning and recommendation authority moves to the external AI. The app records, derives,
flags and executes. It does not prescribe.

### D-AUTHORITY — the app makes no training prescription

The app no longer selects, ranks, doses or gates sessions. An imported session is shown and
run **as authored**. Missed or changed sessions are recorded as facts for the next export.
The app does not re-plan.

This supersedes ADR-0019 D-CANDIDATE, D-CRITIQUE and the generated-planner fallback in D-EXT.
It keeps ADR-0019's import contract: D-RELDATE, D-IMMUT, D-NOTRAVEL, D-NOPARSE, D-EVENT
(advice only) and D-IRREDUCIBLE (as an authored property the runner displays). ADR-0007,
ADR-0012 and ADR-0017 stop describing live behaviour once Phase 2 of D-ENGINE ships, and they
are marked **Superseded by ADR-0052** at that point.

### D-FLAGS — deterministic advisory flags replace vetoes

Dropping adjudication must not silently drop the safety signals it was built on. A small,
fixed set of deterministic **flags** is kept. They are computed from existing pure modules
and have no veto:

| Flag | Source module (current) | Basis |
|---|---|---|
| Possible illness / physiological anomaly | `healthAnomaly.ts` | ADR-0025 |
| Reported symptom with an illness-risk cause | subjective check-in gating | ADR-0032 |
| Active injury constraint touching the session's patterns | `injuryPolicy.ts` | ADR-0013 |
| Recovery metric beyond baseline (HRV, RHR, sleep) | baseline estimators | ADR-0024 |

Rules:

* A flag is a **fact with provenance**: its inputs, threshold, baseline window and the
  source data's state. It is exported in the flags layer (D-EXPORT).
* When a flag is active, it is shown next to today's imported session and on the session
  launch screen. It never blocks, modifies or re-doses the session.
* The flag set is closed. Adding a flag needs an amendment to this ADR, because every flag
  makes the app more of a decider again.
* Flag thresholds keep decision-adjacent weight, so they stay under the knowledge registry
  (D-CI).

### D-ENGINE — freeze, extract, then retire in phases

| Phase | Trigger | Engine state | User-visible behaviour |
|---|---|---|---|
| **0 — Freeze** | ADR accepted | No new engine features. Engine-authority issues are parked with a reason (#962). Bug fixes only. | Unchanged |
| **1 — Extract** | Phase 0 done | Move derivations with no decision authority into a derived-metrics module outside `engine/`: biometric baselines (ADR-0024), the D−1 step normalization and activity-step deduction now in `fatigue.ts` (ADR-0003, I3), performed-training facts (`performedTrainingFacts.ts`), exposure/coverage ledgers (#813), assessment reducers, and the flag evaluators. Each move is behaviour-preserving and tested against the old output. | Unchanged |
| **2 — Switch off** | Phase 1 done, and D-EXPORT v1 shipped | Home, Plan and the week-ahead strip render today's imported session, flags and facts instead of `rules.ts` / `planner.ts` / `trainingIntent.ts` output. The generated planner and adjudication stay in the tree behind a default-off profile setting, as a rollback. `daily_recommendations` writes stop while the setting is off. | No engine recommendation shown by default |
| **3 — Retire** | D-EVAL passed, and no rollback used for one full training block | Delete selection and adjudication modules, their knowledge claims, coverage items and alignment tests, the simulation harness, and `POLICY_VERSION`. Tag the last commit that contains them (`engine-final`) before deleting. | None |

Historical records stay readable: persisted `daily_recommendations`, recommendation audits
and their `policyVersion` fields are not migrated or deleted. ADR-0010 replay *verification*
retires with the engine in Phase 3. An old audit can still be replayed offline by checking
out `engine-final`. That is an accepted reduction from ADR-0010, not an oversight.

### D-CI — what happens to each gate

| Gate (CI job / script) | Phase 0–1 | Phase 2 | Phase 3 |
|---|---|---|---|
| `engine-simulations`: `simulate:scenarios` + aggregate bounds + baseline diff | Run only when `app/src/engine/`, `app/src/knowledge/` or simulation files change (path rule in `scripts/detect_ci_changes.py`) | Advisory (`continue-on-error`) | Removed |
| `simulate:plan-judge`, persona-judge corpus build | As above | Advisory | Removed |
| `simulate:diff` | Advisory (unchanged) | Advisory | Removed |
| `check-policy-drift.mjs` (I5) | Kept. It fires only on engine edits, which the freeze makes rare | Kept while the rollback setting exists | Removed with `POLICY_VERSION` |
| `validate:knowledge`, `validate:knowledge-coverage`, `*PolicyAlignment.test.ts` (I4) | Kept | Kept for flag thresholds and derived-metric definitions; coverage items for switched-off modules marked retired | Scoped to flags and derived metrics only |
| `validate:knowledge-freshness` | Warn-only (unchanged) | Unchanged | Scoped as above |
| `validate:workouts` | Kept: the catalog feeds authoring and the runner | Kept | Kept |
| Python tests, mypy, ruff, Firestore rules, unit tests, browser E2E, Docker build, docs hygiene | Kept | Kept | Kept |
| **New: ledger export contract tests** | — | Required. Schema validation; every fact carries source, unit and state; no engine-derived field appears in the facts or derived layers | Required |
| **New: round-trip E2E** (export → import `external-plan@5` → execute offline → re-export shows the performed occurrence) | — | Required | Required |

Invariant changes: **I1, I2, I3 and I6 are unchanged.** For I3, the deduction moves with
the extraction, and its semantics are unchanged. **I4** narrows at Phase 2 to flags and
derived metrics. **I5** retires at Phase 3. `CLAUDE.md` and `AGENTS.md` change in the same PR
as each phase, not before.

### D-EXPORT — structured facts first, Markdown rendered from them

The Context Brief's design flips. Today, Markdown is canonical and JSON is a transport
envelope around it. Under this ADR, a **ledger export schema** (structured JSON) is
canonical, and the Markdown brief is rendered from it. The export has explicit layers:

1. **facts:** observations and performed training as recorded, with units, source/provider,
   ingestion state and missingness;
2. **derived:** the Phase 1 metrics, each naming its definition and window;
3. **flags:** D-FLAGS, with their inputs;
4. **user context:** D-USER;
5. **coaching history:** D-COACHLOG.

Engine-opinion sections in the current brief (plan authority from `briefPlanAuthority.ts`,
periodization phase, capability-maintenance and development-authority verdicts) leave the
default export at Phase 2. Until Phase 3 they may appear only in a separate, labelled
`legacy_engine` layer, because they would otherwise anchor the external AI on a decider
the owner has stopped trusting.

The existing information bounds, determinism (identical inputs → identical semantic
output), ADR-0003 dates and contract-version discipline carry over unchanged.

Transport stays user-initiated: the owner exports and chooses which AI receives it.
ADR-0019 D-NOPARSE stands: no in-app model call. A read-only, pull-based interface (for
example an MCP server) is an expected follow-up, but it needs its own ADR covering
authentication, scopes, rate limits and health-data exposure (I6). Whichever transport is
used, the export means the owner is sending personal health data to a third-party provider
they chose.

### D-USER — athlete-stated context is first-class

What the athlete says about themselves counts as much as sensor data for an external coach.
Athlete-stated context gets an explicit, revisioned home and is exported as facts:

* injuries and pain history (reusing ADR-0013 `InjuryConstraint`, now as a record, not a
  gate input);
* available equipment and locations;
* schedule constraints and availability;
* training preferences and dislikes;
* goals and events (already structured, ADR-0041/0048–0050).

Each change is a new revision with a timestamp, so the export can say "since 2026-10-03"
rather than only giving the current value.

### D-COACHLOG — the ledger carries coaching continuity

An external AI starts every conversation with no memory. The engine used to hold that
continuity. Now the ledger must. The existing immutable, content-hashed plan revisions
(ADR-0019 D-IMMUT) are the anchor. The ledger adds:

* the plan author's stated rationale, when the import provides one;
* athlete overrides (skipped, swapped or modified sessions) with an optional reason;
* the outcome link: which performed occurrence (ADR-0034) answered which planned session.

The schema is defined in the Phase 2 export work, not here.

### D-EVAL — what must be true before Phase 3 deletes anything

Phase 3 is irreversible in practice, so it is gated on recorded evidence, not on how the
owner feels at the time. Over at least one full training block (planned by the external AI,
four weeks minimum) the owner records:

* plan adherence (planned vs performed occurrences, from data the ledger already has);
* assessment or benchmark direction for the block's stated goals (#897);
* whether any D-FLAGS signal was active on a day the owner trained hard, and what happened;
* whether the rollback setting was used, and why.

If the rollback setting was used for a safety reason, Phase 3 does not proceed until this
ADR is amended.

## Consequences

**Positive.**

* The product's focus matches what the owner uses.
* The parked issues and the engine-specific CI cost go away.
* The deferred real-device acceptance becomes the clear priority.
* The export loses engine opinions that could anchor the external AI.
* Planning moves to the tool the owner finds better, and the app's own safety signals
  survive as flags.

**Negative.**

* The app gives up the one thing ADR-0019 called non-negotiable: refusing an unvetted
  session. A confident but wrong external plan will run as authored. D-FLAGS lowers this
  risk but does not remove it.
* ADR-0010 replay verification is lost for future decisions (none are made) and, after
  Phase 3, for historical ones without checking out `engine-final`.
* A large, well-tested body of work and its knowledge lineage is retired.
* External-AI quality is outside the app's control and changes when models change.
  Coaching continuity is only as good as what D-COACHLOG records.

**Neutral.**

* Phase 2 changes user-visible behaviour, so it needs the UI/UX standard and browser E2E.
* Ingestion (`src/garmin_sync/`) is unaffected.
* Assessment, diary and occurrence authorities (ADR-0023/0034/0046) are unaffected.

## Alternatives Considered

**Keep ADR-0019 as it is (external selection, engine adjudication).** This is the cheapest
option. It is rejected because the owner finds the adjudication itself to be the low-value
part, and it keeps every engine maintenance cost.

**Keep the engine's veto only for hard injury constraints.** This is a credible middle
ground. It is not chosen, because one live gate keeps `rules.ts`, `POLICY_VERSION` and the
simulation harness alive for a single rule. The injury flag in D-FLAGS shows the same
information on the launch screen. If D-EVAL finds a flag ignored on a day that mattered,
this is the first amendment to revisit.

**Delete the engine immediately.** This is rejected. It removes the rollback before D-EVAL
has any evidence, and it would mix the behaviour-preserving extraction (Phase 1) with the
deletion in one unreviewable change.

**Call an AI model from inside the app to plan.** This is rejected for now, as in ADR-0019
D-NOPARSE: key custody, recurring cost, and a non-deterministic transform at the persistence
boundary.

## References

* ADR-0019 decisions superseded: D-CANDIDATE, D-CRITIQUE, D-EXT (fallback planner).
* Context Brief contract: `docs/architecture/context-brief-contract.md`;
  `app/src/services/contextBriefService.ts`; `app/src/utils/contextBriefExport.ts`.
* Engine consumers to switch in Phase 2: `components/Home.tsx`, `components/PlanView.tsx`,
  `components/WeekAheadStrip.tsx`, `services/activeExternalPlanService.ts`,
  `components/ExternalVerdictBanner.tsx`.
* CI: `.github/workflows/ci.yml` (`engine-simulations`, `frontend-hygiene`),
  `scripts/detect_ci_changes.py`, `scripts/check-policy-drift.mjs`.
* Backlog mapping (core / re-scope / park): issue #962.
