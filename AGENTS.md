# AGENTS.md — AI Agent Guidance for Adaptive Training Recommender

This document outlines repository rules, code conventions, testing instructions, and architecture for AI assistants operating on this codebase.

## Repository Overview

`adaptive-training-recommender` is a hybrid Python/TypeScript repository:
* **Python Backend** (`src/garmin_sync/`): Ingests health & training metrics from Garmin Connect into user-scoped Firestore documents.
* **Frontend App** (`app/`): React + TypeScript + Vite + Firebase application that reads user recovery snapshots and computes adaptive training recommendations.

---

## Critical System Constraints

1. **User Isolation**: NEVER write recovery documents to `daily_recovery_snapshot/{date}` or with `"default_user"`. Always write to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`.
2. **Timezone Semantics**: Always use `Europe/Warsaw` for local date calculations (`local_today()` in Python, `getLocalDateString()` in TypeScript). Do not use UTC `toISOString().split('T')[0]` for calendar dates.
3. **No Credential Leaks**: Never commit `.env`, `.garth`, Firebase service account files, or raw health JSONs.
4. **Step Count Semantics**: `totalSteps` in recovery snapshots represents the completed previous calendar day (`D - 1`).

---

## Commands Reference

### Python Backend
* `uv sync` — Restore dependencies
* `uv run pytest` — Run unit tests
* `uv run ruff check .` — Run ruff linter & import sorter
* `uv run mypy src/garmin_sync` — Run static type checking on backend source
* `uv run python -m garmin_sync sync` — Run daily ingestion
* `uv run python -m garmin_sync backfill --days 56` — Run historical backfill
* `uv run python -m garmin_sync audit --days 90` — Report sync/archive completeness
* `uv run python -m garmin_sync rebuild --start-date X --end-date Y` — Offline snapshot rebuild

### Frontend App
* `cd app && npm ci` — Install node dependencies
* `cd app && npm run check` — Run full validation suite (TypeScript typecheck, ESLint, Vitest, workout catalog)
* `cd app && npm test` — Run engine unit test suite (`vitest run`)
* `cd app && npm run test:rules` — Firestore security-rule suite inside the local Firebase emulator (needs Java)
* `cd app && npm run build` — Build production bundle (`npm run check && vite build`)
* `cd app && npm run dev` — Start Vite dev server (automatically executes `npm run check` pre-flight)
* `cd app && npm run validate:workouts` — Validate workout catalog definitions and prescription contracts
* `cd app && npm run simulate:scenarios` — Run multi-week engine simulations; reports land in `artifacts/simulation-reports/latest/`
* `cd app && npm run simulate:diff` — Generate non-blocking semantic diff against committed baseline snapshot (`docs/analysis/simulation-baseline.json`)
* `cd app && node scripts/check-policy-drift.mjs <base-sha>` — Verify POLICY_VERSION increment when engine decision logic changes
* `cd app && npm run replay:recommendation -- <audit.json>` — Replay a persisted decision against its own audit to verify reproducibility
* `cd app && npm run visual:install` — Install Playwright Chromium binary for visual review tests
* `cd app && npm run visual:refresh` — Capture desktop/mobile visual review screenshots in `artifacts/visual-review/latest/`
* `cd app && npm run visual:serve` — Start visual review harness dev server with synthetic fixtures (`http://127.0.0.1:4174`)


### Docker
* `docker build -t adaptive-training-garmin-sync .` — Build container image

---

## Package Architecture

```text
src/garmin_sync/
  config.py            # Typed Settings & validation
  dates.py             # Europe/Warsaw date provider
  models.py            # Schema Version 3 models (ADR-0002); provenance records (ADR-0010)
  garmin_client.py     # Garmin API wrapper with exponential backoff
  token_store.py       # LocalTokenStore & GcsTokenStore abstraction
  firestore_repository.py # Firestore user-scoped repository
  metrics.py           # Pure baseline and intensity classification math
  mapper.py            # Payload transformation with metric dates
  provider.py          # WearableProvider protocol (vendor-neutral boundary)
  garmin_provider.py   # Garmin adapter implementing WearableProvider
  canonical.py         # Vendor-neutral canonical metric/activity models
  archive.py           # Immutable raw payload archive (ADR-0005)
  audit.py             # Sync completeness reporting
  service.py           # Daily sync, backfill, rebuild orchestrator
  cli.py               # Argument parsing and entry points

app/src/engine/
  models.ts            # Domain models, event schemas, microcycle & strain telemetry
  rules.ts             # Adaptive rules engine (acute/drift strain, mode hierarchy & rationale)
  templates.ts         # Session template catalog & systemic load caps with dual profiles
  validation.ts        # Input schema validators & sanitizers
  schedule.ts          # Multi-layered schedule availability & location context resolution
  periodization.ts     # Structured event demand profiles & continuous phase weighting
  microcycle.ts        # Weekly training objectives & exposure progress tracker
  fatigue.ts           # 6-dimensional fatigue state, exponential decay & internal response
  optimizer.ts         # Benefit vs cost utility optimization candidate selector
  eligibility.ts       # The single hard-gate resolver (time/equipment/environment/guardrails)
  trainingIntent.ts    # Composes periodization + objectives + fatigue + planned dose (ADR-0009)
  trainingHistory.ts   # TrainingHistoryProvider boundary; Firestore impl is injected
  trainingHistorySnapshot.ts # Immutable, revisioned bounded history (ADR-0010)
  completedTraining.ts # Garmin/adherence reconciliation into completed exposures
  dataState.ts         # AVAILABLE / MISSING / INVALID / UNAVAILABLE read semantics
  dose.ts              # Planned dose x clinical ceiling x athlete adjustment
  planner.ts           # Rolling 7-day projection & weekly anchor pre-pass (ADR-0008/0011)
  provenance.ts        # Builds the persisted RecommendationAudit
  replay.ts            # Verifies a persisted decision against its own audit
  policy.ts            # POLICY_VERSION -- bump when a decision-affecting change lands
  stimulus.ts          # V2 fractional objective credit; the live credit authority (ADR-0014).
                       #   Consumed by microcycle.ts, planner.ts, completedTraining.ts
  planningMode.ts      # THE single authority for effective planning mode (ADR-0017).
                       #   No other module may derive mode
  planSchedule.ts      # PlanDefinition / PlanBlock / plan objective definitions
  planningOverlays.ts  # Authored travel overlays applied to planned dose (ADR-0012)
  planningCandidate.ts # Planner <-> workout-library boundary; per-workout spacing data
  coverage.ts          # Exact weekly programming-role coverage, distinct from credit (ADR-0016)
  weeklyAllocation.ts  # Required weekly-role reservations & typed misses (ADR-0018)
  evergreenPlanning.ts # Evergreen plan resolution entry point (ADR-0017)
  evergreenStrategy.ts # Evidence-backed adaptation dose requirements
  trainingCapacity.ts  # Real sessions/minutes/windows that bound dose packing
  weeklyDosePacking.ts # Maps dose requirements onto exact workout identities
  injuryPolicy.ts      # Structured injury constraints & tissue-response tightening
  taperPolicy.ts       # Event taper window resolution
  safetyCheckin.ts     # Minimum-safety check-in gate & provisional recommendation
  externalSession.ts   # Adjudicates ONE imported session on ONE day (ADR-0019). Pure;
                       #   selects and ranks nothing, and no selection module may import it
  externalSessionProfiles.ts # Imported session -> cost/stimulus/GateableSession/`ext:` shim
  externalPlacement.ts # Imported plan -> dates; missed-session proposals (never writes
                       #   without confirmation)
  externalCritique.ts  # Advisory weekly review of a placed plan week. Cannot change a
                       #   verdict, and cannot import externalSession.ts (D-CRITIQUE)
  externalPlanHash.ts  # Canonical SHA-256 of a stored revision; the replay anchor (D-IMMUT)
  sequenceSearch.ts    # Phase 5.1 beam-search prototype -- measured, NOT in any live path
  shadowAgreement.ts   # Phase 9.0: pure engine-vs-athlete verdict classifier (evidence only)
  shadowLog.ts         # Phase 9.0: pure day-row joiner + CSV renderer for the export (evidence only)
  subjectiveBaseline.ts # Phase 9.1: pure recent-vs-long subjective baseline (not yet wired into rules.ts)
  simulation/          # Scenario harness: runAllScenarios, decision-quality metrics
```

This map is a routing aid, not a complete file listing. Where it disagrees with the
directory, the directory wins.

**Before changing engine behaviour**, read
`docs/architecture/recommendation-engine.md` (the two selection paths) and the relevant
ADR. Known divergences between the ADRs and the code are tracked in
`docs/analysis/2026-08-08-architecture-review.md`, with remediation sequenced in
`docs/plans/`.

---

## Reading the documentation

`docs/` directories are not interchangeable — each has a different relationship to the
truth, and reading one as if it were another has already caused a fixed defect to be
re-reported three times. **[`docs/README.md`](./docs/README.md) opens with the routing
table**: which directory is authoritative for what, precedence when two documents
disagree, and task-oriented entry points. Read it before trusting any other document
here.

The short version:

| Directory | Is | Trust for |
|---|---|---|
| `docs/adr/` | Immutable decisions | Intended design and rationale — *not* current behaviour |
| `docs/architecture/` | Living reference | How it works today |
| `docs/analysis/` | Dated audit | Evidence as of its date — verify findings against code |
| `docs/plans/` | Mutable, status-tracked | Work to be done; `Implemented`/`Archived` plans are history, not instructions |
| `docs/ops/` | Runbooks | Operational procedure |

**When two documents disagree, the code wins, then `architecture/`, then `adr/`.** Do not
silently pick one — fix the doc or record the divergence in the current review document,
and say which you did.

### Writing conventions

* **Reference symbols, never line numbers.** Write `` `rules.ts` `evaluateEnvelopes` `` or
  `` `prescription.ts:workoutForTemplate` ``, never `` `rules.ts:544-556` ``. Line numbers
  drift within hours; a 2026-08-08 audit found 91 of them in `docs/plans/`, three of six
  sampled already pointing at the wrong code on the day they were written.
* **A finished plan must not read like a work list.** When a plan reaches `Implemented`,
  strike or delete its present-tense problem statements. See
  [`docs/plans/README.md`](./docs/plans/README.md#conventions-that-exist-because-they-were-violated).

---

## Code Style & Testing Standards

* Maintain type hints across all Python modules.
* Use synthetic JSON fixtures (`tests/fixtures/`) for unit tests; do not call live APIs during tests.
* Ensure all frontend changes compile with TypeScript (`npm run build`).
