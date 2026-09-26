# AGENTS.md — Repository Reference for AI Agents

The reference index for `adaptive-training-recommender`: package and command routing,
verification gates, and which document to trust.

**Scope:** this root file applies to the whole repository. A deeper `AGENTS.md`, if added,
takes precedence for its subtree.

**Read [`CLAUDE.md`](./CLAUDE.md) first** — it holds the invariants you must not violate,
the pre-change checks, and the verification loop. This file answers *"where is it and what
do I run?"*; `CLAUDE.md` answers *"what am I allowed to do?"*.

## Repository overview

* **Python backend** (`src/garmin_sync/`) — ingests health and training metrics from Garmin
  Connect (and Eight Sleep / Google Health transports) into user-scoped Firestore documents.
* **Frontend app** (`app/`) — React + TypeScript + Vite + Firebase. Reads user recovery
  snapshots and computes adaptive training recommendations. The decision engine lives in
  `app/src/engine/`; its evaluators are pure, and only the orchestration entry points
  reach for IO — as a lazily-imported default when no provider was injected.

---

## Critical system constraints

Full statements, with rationale and the checks that enforce them, are in
[`CLAUDE.md` § 1](./CLAUDE.md#1-non-negotiable-invariants). In short:

1. **User isolation** — write to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`; never `daily_recovery_snapshot/{date}`, never `"default_user"` (ADR-0002).
2. **Timezone semantics** — `Europe/Warsaw` for every calendar date, via `local_today()` / `getLocalDateString()`; never UTC `toISOString().split('T')[0]` (ADR-0003).
3. **`D - 1` step semantics** — `totalSteps` is the previous completed day; baselines normalize ambient surges and `fatigue.ts` deducts estimated activity steps (ADR-0003).
4. **Knowledge lineage** — decision-authority constants are owned by registered claims with alignment tests; check `app/src/knowledge/` before changing one (ADR-0033).
5. **Policy version** — bump `POLICY_VERSION` when a change can alter a recommendation (ADR-0010).
6. **No credential leaks** — never commit `.env`, `.garth/`, service-account files, or raw health JSON.

---

## Commands reference

### Full suite (Makefile, repository root)

* `make verify` — the canonical scope-aware handoff/PR gate for coding agents; it reuses CI's docs-vs-code classification and runs the deterministic local gates required for that scope.\n* `make agent-evals` — validate the provider-neutral coding-agent evaluation corpus.\n* `make check` — the core local code gate: `ruff check`, `ruff format --check`, `mypy`,
  `pytest`, `tsc -b`, `eslint`, `vitest`, knowledge validation, knowledge-coverage
  validation, knowledge-freshness reporting, and workout validation. `check-frontend` mirrors the app's `npm run check`
  gate; CI adds further path-specific checks such as dependency audits, policy drift,
  coverage/rules, simulations, and Docker validation.
* `make all` — alias for `make verify` (the default target)
* `make test` — unit tests only (`pytest` + `vitest`)
* `make typecheck` / `make lint` — both stacks
* `make format` — auto-format Python and TypeScript; `make format-check` verifies Python formatting without writing
* `make validate-knowledge` / `make validate-knowledge-coverage` / `make validate-knowledge-freshness` / `make validate-workouts` — run the frontend registry/coverage/freshness/catalog checks individually
* `make simulate` — scenario simulations + baseline diff verification
* `make simulate-calibrate` / `make simulate-fatigue-fusion` / `make simulate-subjective-drift` / `make compare-sequence-search` — targeted evidence runs
* `make build` — production frontend build
* `make install` — install Python and Node dependencies
* `make deploy` / `make deploy-all` / `make deploy-rules` / `make deploy-indexes` — Firebase Hosting / all assets / security rules (with drift check) / indexes
* `make clean`, `make help` — housekeeping and target listing

### Python backend

* `uv sync` — restore dependencies
* `uv run pre-commit install` — install git hooks locally
* `uv run pre-commit run --all-files` — run every pre-commit check
* `uv run pytest` — unit tests
* `uv run ruff check .` — lint and import sort
* `uv run ruff format --check .` — formatting check (`uv run ruff format .` to apply)
* `uv run mypy` — static type check of `src/garmin_sync` and `scripts/` (scope set by `[tool.mypy] files`
  in `pyproject.toml`; passing a path explicitly narrows it)
* `uv run python scripts/bootstrap_garmin_tokens.py` — Garmin OAuth token bootstrap
* `uv run python scripts/respiration_baseline_evidence.py` — synthetic respiration baseline sweep (ADR-0024)

**`garmin_sync` CLI** (`uv run python -m garmin_sync <command>`):

| Command | Does |
|---|---|
| `sync [--date YYYY-MM-DD] [--force]` | Daily ingestion for `APP_USER_ID` |
| `sync-all` | Daily ingestion for every active Garmin link |
| `backfill --days 56 [--force]` | Historical backfill |
| `backfill-health --days 56` | Google Health backfill (Eight Sleep & Garmin) |
| `backfill-eight-sleep-direct --days 56` | Direct Eight Sleep connector backfill (ES8/ES9) |
| `rebuild --start-date X --end-date Y` | Offline snapshot rebuild from the raw archive |
| `audit --days 90` | Sync/archive completeness report |
| `audit-multisource --days 60` | Multisource shadow audit, Garmin direct vs Eight Sleep (MS14) |
| `probe-health` | Google Health source-provenance probe (MS0) |
| `compare-transports --days 60` | Garmin direct vs Google Health transport equivalence (MS10) |
| `compare-eight-sleep-transports --days 60` | Eight Sleep direct vs Google Health equivalence (ES9) |
| `export-identity-replay --days 60` | Export real data in `identityReplay.ts`'s input shape (PI8) |
| `export-activities --days 7` | Export recent activity telemetry as JSON for planning |
| `push-workout`, `push-pending-workouts[-all]` | Push queued/pending structured workouts to Garmin |
| `poll-manual-sync[-all]` | Poll manual sync status for one or every active link |

### Frontend app (run from `app/`)

* `npm ci` — install dependencies
* `npm run check` — the frontend gate: `tsc -b`, `eslint`, `vitest run`, knowledge validation, knowledge-coverage validation, knowledge-freshness reporting, workout catalog validation
* `npm test` — `vitest run` only; the fast inner loop (`npm run test:watch`, `npm run test:coverage`)
* `npm run test:perf` — wall-clock latency gates (`*.perf.test.ts`, `vitest.perf.config.ts`), run in a single worker; excluded from `npm test` because sibling workers preempt them. Part of `npm run check` / `make check`
* `npm run test:rules` — Firestore security-rule suite inside the Firebase emulator (needs Java)
* `npm run test:e2e` — Playwright browser E2E suite inside the Auth + Firestore emulators (`playwright.e2e.config.ts`; `npm run e2e:serve` serves the E2E app at `http://127.0.0.1:4173`)
* `npm run emulators:exec:rules -- "<cmd>"` / `npm run emulators:exec:e2e -- "<cmd>"` — run a command inside the same emulators `test:rules` / `test:e2e` use; CI shards with e.g. `npm run emulators:exec:rules -- "npm run test:rules:emulator -- --shard=1/2"` (`test:e2e:emulator` is the Playwright counterpart)
* `npm run build` — `npm run check && vite build`
* `npm run dev` — Vite dev server (`predev` runs `npm run check` first)
* `npm run validate:workouts` / `npm run validate:knowledge` / `npm run validate:knowledge-coverage` — catalog and registry validators, individually
* `npm run validate:knowledge-freshness` — SKR5 due/stale review-cadence report for every knowledge claim; always exits 0, never gates CI (see `app/src/knowledge/knowledgeFreshness.ts`)
* `npm run simulate:scenarios` — multi-week engine simulations → `artifacts/simulation-reports/latest/`
* `npm run simulate:diff` — non-blocking semantic diff against `docs/analysis/simulation-baseline.json` (`npm run simulate:update-baseline` to re-baseline)
* `node scripts/check-policy-drift.mjs <base-sha>` — verify `POLICY_VERSION` was bumped when decision logic changes
* `npm run replay:recommendation -- <audit.json>` — replay a persisted decision against its own audit
* `npm run build:plan-judge-corpus && npm run report:sequencing` — deterministic sequencing collision/spacing/opportunity-cost diagnostics (issue #458; report only, no gate)
* `judge:*` and `persona:*` are script-name families, **not executable npm wildcards**. Use concrete scripts such as `npm run judge:run`, `npm run judge:diff`, `npm run judge:update-baseline`, `npm run persona:run`, `npm run persona:diff`, and `npm run persona:update-baseline`; see `app/package.json` for local/quick/e2e/resume variants.
* `npm run evidence:health-anomaly`, `npm run evidence:identity-replay`, `npm run measure:garmin-zone-credit` — shadow-mode evidence runs
* `npm run visual:install` → `npm run visual:refresh` — finalized Playwright review bundle for `visual-desktop` (1440 px) + `visual-mobile` (390 px) in `artifacts/visual-review/latest/`; `npx playwright test` can ad hoc capture `visual-mobile-narrow` (360 px) and `visual-mobile-wide` (412 px), but does not prepare/finalize the review bundle; `npm run visual:serve` runs the harness at `http://127.0.0.1:4174`

### What CI gates (`.github/workflows/ci.yml`)

CI is path-sensitive. `detect-changes` chooses the applicable jobs, and the final `CI Gate`
fails the PR if any required job on that path fails.

| Change class | Job | Gates on |
|---|---|---|
| Docs-only | Documentation & security hygiene | repository-hygiene `pre-commit` checks (the CI job skips the code-only uv-lock/Ruff/mypy/ESLint hooks) |
| Code | Python test suite | `uv lock --check`, repository-hygiene `pre-commit`, `ruff check`, `ruff format --check`, `mypy` (`src/garmin_sync` + `scripts/`), `pytest` with coverage, `uvx pip-audit` |
| Code | Frontend hygiene & static gates | `npm audit --audit-level=high`, `typecheck`, `lint`, `validate:knowledge`, `validate:knowledge-coverage`, `validate:knowledge-freshness` (reports only, non-blocking), `validate:workouts`, policy-version drift vs the PR base, `build:bundle` |
| Code | Frontend unit tests, Firestore rules & browser E2E | `npm run test:coverage` then `npm run test:perf`, `npm run test:rules`, `npm run test:e2e` (emulators + Java + Chromium), run as parallel jobs; the rules and E2E suites are each split into two `--shard` jobs with their own emulator, and one aggregate check passes only when every job and shard passes |
| Code | Engine simulations & AI gates | `simulate:scenarios` plus committed-baseline `git diff --exit-code`, `simulate:plan-judge`, persona corpus build; `simulate:diff` is advisory (`continue-on-error`) |
| Code | Docker build & compose smoke | root image build, Compose config/build/up, smoke checks |

`make check` already covers Python lint **and formatting**, mypy, pytest, frontend typecheck,
ESLint, Vitest, the knowledge validators, and workout validation. The important CI-only
additions are dependency/lock audits, pre-commit hygiene, policy-drift and bundle checks,
coverage/rules tests, simulation/AI gates, and Docker validation.

### Docker

* `docker compose build` (`make docker-build`) — build backend and frontend images
* `docker compose up -d` (`make docker-up`) — backend API on 8081, frontend Nginx SPA on 8080
* `docker compose down` (`make docker-down`) — stop and remove services and networks
* `make docker-smoke` — health and reverse-proxy smoke checks against running containers
* `docker build -t adaptive-training-garmin-sync .` — standalone Garmin sync image

---

## Package architecture

Read this as a routing aid, not a complete file listing. **Where it disagrees with the
directory, the directory wins** — and fix the line you found wrong.

```text
src/garmin_sync/
  config.py            # Typed Settings & validation
  dates.py             # Europe/Warsaw date provider
  models.py            # Schema Version 3 models (ADR-0002); provenance records (ADR-0010)
  canonical.py         # Vendor-neutral canonical metric/activity models
  provider.py          # WearableProvider protocol (vendor-neutral boundary)
  garmin_client.py     # Garmin API wrapper with exponential backoff
  garmin_provider.py   # Garmin adapter; the ONLY module allowed to know Garmin response shapes
  token_store.py       # LocalTokenStore & GcsTokenStore abstraction
  firestore_repository.py # Firestore user-scoped repository
  metrics.py           # Pure baseline and intensity classification math
  mapper.py            # Provider-neutral snapshot assembly over canonical.py types
  archive.py           # Immutable raw payload archive (ADR-0005)
  audit.py             # Sync completeness reporting
  service.py           # Daily sync, backfill, rebuild orchestrator
  coordination.py      # Multi-user ingestion coordination and batch runs
  account_link.py      # Multi-user Garmin account linking and token storage
  account_link_api.py  # Local/remote HTTP API for account linking workflows
  base_api.py          # Shared JSON request-handler base for the link API services
  connection_status.py # Client-visible provider connection status reconciliation (ADR-0029)
  error_reporting.py   # Sanitized error classification/reporting -- never emits health values
  migrate_user_data.py # User-scoped data migration between uids (planned, summarized, redacted)
  workout_export.py    # FIT/TCX workout export integration
  google_health_auth.py     # Google Health OAuth tokens & refresh locking (MS4, ADR-0027)
  google_health_client.py   # Google Health v4 raw list endpoint client (MS5)
  google_health_mapper.py   # Raw v4 data points -> CanonicalHealthObservation + provenance (MS6)
  google_health_provider.py # RecoveryObservationProvider over Google Health (MS3/MS6)
  google_health_account_link.py     # Browser-redirect OAuth account linking for Google Health
  google_health_account_link_api.py # Separate HTTP service for that linking flow
  webhook_receiver.py  # Google Health webhook signature verification & subscriber (MS9)
  health_observation_service.py # Multi-source observation sync, archive & persistence (MS7/MS8)
  health_probe.py      # Google Health source-provenance probe runner (MS0)
  equivalence.py       # Garmin direct vs Google Health transport equivalence analyzer (MS10)
  multisource_audit.py # Multisource coverage/baseline/cross-source shadow audit (MS14)
  presence_filter.py   # @deprecated secondary-source concordance filter; superseded by PI
  identity_eligibility.py   # Fail-closed effective-identity eligibility projection (PI5, ADR-0028)
  identity_replay_export.py # Real-data exporter for the PI8 historical identity replay
  eight_sleep_config.py    # Configuration for the opt-in direct Eight Sleep transport (ADR-0030)
  eight_sleep_client.py    # Minimal read-only client for Eight Sleep's private API
  eight_sleep_mapper.py    # Eight Sleep trends -> ADR-0027 source-aware observations
  eight_sleep_provider.py  # RecoveryObservationProvider over direct Eight Sleep ingestion
  eight_sleep_probe.py     # Sanitized local probe; never prints secrets or health values
  eight_sleep_equivalence.py # Eight Sleep direct vs Google Health equivalence (ES9)
  fit_activity.py      # Strict in-memory decoding boundary for Garmin FIT downloads (ADR-0031)
  fit_workout_identity.py # Versioned fingerprint for a device-recorded structured workout (ADR-0034)
  hr_fidelity.py       # Shadow-only exercise HR trace fidelity assessment (ADR-0031)
  _hr_fidelity_detectors.py # Deterministic artifact candidates for hr_fidelity (HRF3)
  _hr_fidelity_timing.py    # Timer-window, sampling and coverage primitives for hr_fidelity (HRF3)
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
  stimulus.ts          # V2 fractional objective credit; the live credit authority (ADR-0014)
  planningMode.ts      # THE single authority for effective planning mode (ADR-0017)
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
  composer.ts          # Decision composer combining readiness, context brief, and intent
  contextBrief.ts      # Recovery context brief; daily (2d, morning) / full (14d, planning) / diagnostic (14d) purposes
  healthAnomaly.ts     # Pure physiological anomaly & possible-illness evaluator (ADR-0025)
  healthAnomalyFeatures.ts # Anomaly-grade baseline feature mappings (RHR/HRV/respiration)
  healthAnomalyOutcome.ts  # Prospective outcome follow-up label resolver
  healthAnomalyReplay.ts   # Historical replay runner for health anomaly telemetry
  externalSession.ts   # Adjudicates ONE imported session on ONE day (ADR-0019). Pure
  externalSessionProfiles.ts # Imported session -> cost/stimulus/GateableSession shim
  externalPlacement.ts # Imported plan -> dates; missed-session proposals
  externalCritique.ts  # Advisory weekly review of a placed plan week (D-CRITIQUE)
  externalPlanHash.ts  # Canonical SHA-256 of a stored revision; replay anchor (D-IMMUT)
  authoredSessionGates.ts # Adjudicates authored occurrences against readiness/gates (ADR-0023)
  scheduleWindows.ts   # ADR-0036 D-WINDOW: versioned athlete schedule windows; structure only
  localInstant.ts      # ADR-0036 D-TIME: local wall-clock -> instant; fails closed on DST gaps
  dailyLedger.ts       # ADR-0036 D-LEDGER: as-of daily minute/systemic-cost accounting boundary
  intradayLedgerInputs.ts # Builds today's LedgerEntry[] from resolved occurrence/execution facts
  fixedActivityLedger.ts  # Adapts a persisted fixed activity to the D-LEDGER accounting boundary
  fixedActivityCostProfile.ts # Shared six-dimension cost reduce over a fixed activity's expectedCost
  intradayBundlePlacement.ts # ADR-0036 D-PLACEMENT: binds a bundle's members to real windows
  intradayReassessment.ts # ADR-0036 D-REASSESS: fresh as-of verdict before a later session starts
  intradayDecision.ts  # ADR-0036 D-AUDIT: write-once intraday decision records & replay verification
  externalRestProvenance.ts # ADR-0035 authored-rest identity, incl. explicit same-day override marker
  recoveryPlacement.ts # ADR-0038: exact recovery identity; product-policy vs authored authority
  recoveryFacts.ts     # ADR-0038 RP2: performed/authored/generated recovery truth derivation
  blockIntent.ts       # ADR-0037: per-objective intent, dose envelopes, protected roles (H5a)
  blockIntentReplay.ts # ADR-0037 D-REPLAY: canonical semantic projection & SHA-256 hash
  progressionReview.ts # ADR-0037: pure report-only progression review; no selection authority (H5b)
  sequenceIntent.ts    # Derived sequencing preference; shapes soft ranking only, never gates
  occupationalLoad.ts  # Physical-work check-in -> occupational strain context (issues #459-461)
  sequenceSearch.ts    # Phase 5.1 beam-search prototype -- measured, NOT in any live path
  shadowAgreement.ts   # Phase 9.0: pure engine-vs-athlete verdict classifier (evidence only)
  shadowLog.ts         # Phase 9.0: pure day-row joiner + CSV renderer for export
  subjectiveBaseline.ts # Phase 9.1: pure recent-vs-long subjective baseline
  subjectiveDriftAudit.ts # Phase 9.7: compact SubjectiveDriftAudit shape + replay validation
  decisionEvidence.ts  # Pure evidence ranking, DoD deltas, boundary classification, confidence tiers
  adapters.ts           # mapSnapshotToEngineInput and the other read-model -> engine input mappers
  validationCore.ts     # Validates untyped external input (raw Firestore docs/client payloads)
  dataConfidence.ts     # Read-confidence classification shared across context/composer
  eventPresets.ts       # Preset user-event -> demand-profile mapping (goalToUserEvent)
  checkinCompletion.ts  # isCompletedSubjectiveCheckin / hasCompletedSubjectiveCheckinForDecision
  fixedActivityIdentity.ts # Resolves a FixedActivity's catalog identity & occurrence key
  firestoreTrainingHistory.ts # Firestore-backed TrainingHistoryProvider implementation
  microcycleHistory.ts  # @deprecated -- import the TrainingHistoryProvider boundary from trainingHistory.ts instead
  sessionChoiceEligibility.ts # Gates select_alternative choice options against resolved injury restrictions (D-MCHOICE)
  contextBriefActivityTelemetry.ts # Per-activity telemetry: full tables (diagnostic) or bounded digest (planning)
  contextBriefPlanningHandoff.ts # Upcoming external-plan/recovery-timeline context for planning handoff
  contextBriefPurpose.ts # Export purposes (morning/planning/diagnostic), section titles, goal/use-instruction renderers
  contextBriefRecovery.ts # Objective wearable + body-composition sections of the context brief
  contextBriefRecoverySynthesis.ts # Explanatory multisignal recovery synthesis for the brief; no decision authority (#812)
  briefPlanAuthority.ts # Reconciles persisted verdict + imported occurrence into one brief authority outcome (#810)
  trainingSettingsSchema.ts # Persisted TrainingSettings schema version gate (current v3, supports v2)
  strengthSessionLifecycle.ts # Strength session state machine (new/in_progress/... transitions)
  strengthSessionValidation.ts # Shared persisted/UI bounds for ADR-0021 strength-session data
  knowledgeLineage.ts   # Sports-knowledge-registry provenance lineage (ADR-0033)
  healthContextDefaults.ts # Canonical defaults for a newly reported health-context block
  healthContextValidation.ts # Health-context/symptom check-in raw-input validator
  healthAnomalyModels.ts # HA domain models: anomaly features, thresholds, rationale, respiration elevation
  respirationElevation.ts # Respiration-elevation status/evidence evaluator feeding healthAnomalyModels
  garminTelemetryEvidence.ts # Power-zone feature extraction & direct-share stimulus candidate (measured, off by default)
  garminTelemetryComparison.ts # compareGarminZoneCredit -- TE-derived vs power-zone credit comparison report
  crossSourceTelemetry.ts # Cross-source sensor agreement/data-quality telemetry (MS13, ADR-0027)
  multisourceBaselines.ts # Source-specific robust 7d/28d median+MAD baseline calculator (MS12, ADR-0024/0027)
  multisourceFusion.ts  # Multi-source recovery evidence fusion evaluator (MS15, ADR-0027)
  coPresenceValidator.ts # @deprecated secondary-source identity/session concordance validator; superseded by PI
  identityFeatures.ts   # Cross-source night/session pairing & physiological relation features (PI2, ADR-0028)
  identityLineage.ts    # Provenance-lineage independence evaluation feeding identity attribution (PI2)
  identityAttribution.ts # Shadow-only ternary physiological-identity evaluator with abstention (PI4)
  identityEligibility.ts # Pre-baseline effective-identity eligibility boundary (PI5, D-PID-PREBASE)
  identityPassport.ts   # Versioned Physiological Identity Passport model + historical bootstrap (PI3)
  identityProvenance.ts # Replay-oriented identity provenance for ADR-0010 recommendation audits (PI6)
  identityReplay.ts     # Historical out-of-sample shadow replay of the PI2/PI3 pipeline (PI8)
  identityReviewUi.ts   # Pure selection/copy/mapping logic for the suspicious-night review UI (PI7)
  activityHrFidelity.ts # getHrUseAuthority -- per-use-case HR authority status (ALLOWED/BOUNDED/OBSERVATIONAL/BLOCKED) (HRF5)
  activityHrFidelityAdapters.ts # HR-dependent field/training-load/effect authority adapters over activityHrFidelity
  activityHrFidelityReplay.ts # Deterministic shadow-only HR-fidelity replay/report over real activity history (HRF7)
  sleepRecoveryEvidence.ts # Sleep-decision-authority evidence evaluator (2026-08-29 sleep-decision-authority plan)
  performedTrainingFacts.ts # Canonical occurrence -> facts & weekly role credit derivation (ADR-0034)
  strengthSpacingPolicy.ts # Pure resistance training spacing & recovery candidate suppression
  simulation/          # Scenario harness: runAllScenarios, decision-quality metrics, drift comparisons
  testing/             # Adversarial PRNG generators & property testing runner
  tests/safety/        # Adversarial domain scenarios, safety invariants, wellness language audit

app/src/sessions/
  models.ts            # Source-neutral session definitions, prescriptions, occurrences, executions
  validation.ts        # Canonical schema validators for definitions, prescriptions, occurrences, entries
  sessionDefinitionResolver.ts # Pinned revision / occurrence resolution and hash verification
  sessionDefinitionHash.ts # Canonical SHA-256 content hashing of definition and prescription
  sessionDefinitionDiff.ts # M3.7: fine-grained content diff between two definition revisions
  inputProfiles.ts     # Input card profiles (repetition, duration, distance, check-offs, gauges)
  performedComparison.ts # Planned vs completed steps, volume, omissions, hold duration
  legacyStrengthAdapter.ts # Two-way bridge between legacy strength_sessions and session_executions
  catalogSessionAdapter.ts # Adapts catalog templates to source-neutral SessionDefinition
  canonicalWorkoutAdapter.ts # Adapts canonical (Garmin/import) workouts to SessionDefinition
  externalPlanV2.ts    # M3.6: external-plan@2 imported-plan envelope
  externalSessionAdapter.ts # Imported external session -> SessionDefinition shim
  externalPlanV3.ts    # external-plan@3 (ADR-0035) -- adds plan-level `restDays` directives
  externalPlanV4.ts    # external-plan@4 (ADR-0036 D-SCHEMA) -- adds session-level `intraday` requests
  externalPlanAny.ts   # Type-only union across v2/v3/v4, kept separate to avoid an import cycle
  restEventTiming.ts   # Pure start/adjust/close transitions for one performed rest interval
  choiceResolution.ts  # Athlete-facing effective view from recorded branch-point choices (D-MCHOICE)
  groupProgression.ts  # Repeating-rotation execution-mode step sequencing
  occurrenceReconciliation.ts # M4.3: companion occurrence identity & duplicate reconciliation
  sessionDraft.ts       # In-progress authored-definition draft field mutations
  sessionLaunch.ts       # Persisted definition + immutable execution snapshot pairing to run it
  restTiming.ts          # Advisory rest countdown resolution after a logged entry
  loadDisplay.ts         # Human-readable, source-neutral load copy (never resolves to kg)
  stepDisplay.ts         # Athlete-facing step label fallback order (title -> exercise name -> id)

app/src/responses/
  models.ts             # M5.1: SessionResponse linkage & non-tissue session facts (ADR-0023 D-MRESP)
  validation.ts         # Pure SessionResponse validator; self-contained, distinct lifecycle from sessions/
  followupSchedule.ts   # M5.2: which body regions a completed session's movements make worth follow-up
  outcome.ts             # M5.3: deriveSessionOutcome -- passed/caution/reactive/unknown evidence summary
  outcomeReport.ts       # M5.3: deterministic report/export over SessionOutcome[]

app/src/observations/
  models.ts             # Canonical metric observation definitions, series, and attempts
  validation.ts         # Strict observation schema validators and comparability gates
  identityModels.ts     # Physiological Identity Passport & measurement-trust contracts (PI1, ADR-0028)
  protocols.ts           # Testing-protocol definitions consumed by the observation registry
  registry.ts             # Observation/protocol lookup and registration
  observationCanonical.ts # Canonicalization of raw observation input into the shared model
  manualAdapter.ts        # Manually-entered observation -> canonical model adapter
  reliability.ts          # Evidence-provenance reliability metadata (source + statistic, not a probability model)
  performanceTestingCatalog.ts # Catalog of structured performance-testing protocols
  progress.ts             # Series comparison and true-change interpretation against noise thresholds
  testingWorkflow.ts      # Testing-session workflow state machine
  comparability.ts        # Canonical comparison-series construction & comparability gate

app/src/outcomes/
  evaluationSpec.ts       # OV: OutcomeEvaluationSpec/metric-binding contracts & validators
  evaluationHash.ts       # OV: canonical content hash of an outcome evaluation snapshot
  blockOutcome.ts         # OV: deriveBlockOutcome -- on_track/mixed/off_track/insufficient_evidence verdict
  blockOutcomeReport.ts   # OV: block outcome -> CSV/JSON export + metric progress rows
  blockProcessEvidence.ts # OV: deriveBlockProcessEvidence -- key-role/completed-session process evidence
  feedbackLoopEvidence.ts # OV: deriveFeedbackLoopEvidence -- decision-action & counterfactual-regret counts
  policySegments.ts       # OV: policy-version/planning-mode segment bookkeeping for evaluation windows

app/src/knowledge/
  sportsKnowledge.ts   # Core schema, validation, and foundational load/intensity/readiness claims (ADR-0033)
  sportsKnowledgeRegistry.ts # Canonical aggregate registry of all Git-backed domain knowledge modules
  knowledgeCoverage.ts # 54-family engine coverage inventory, classification, and research backlog (SKR2)
  optimizerScoringKnowledge.ts # Product-policy claims for candidate selection and fatigue/stimulus weights (SKR3 W2a)
  stimulusHeuristicsKnowledge.ts # Product-policy claims for stimulus credit, fatigue fusion, and planning priors (SKR3 W2b)
  periodizationEventDemandKnowledge.ts # Scientific boundaries and product presets for periodization (SKR3 W1)
  injuryPainKnowledge.ts # Tissue-response, severity scaling, and standing injury restriction claims (SEP)
  readinessCardiorespiratoryKnowledge.ts # RHR and respiration monitoring claims
  subjectiveReadinessKnowledge.ts # Subjective readiness claims + mode-threshold policy claims
  strengthConcurrentKnowledge.ts # Concurrent strength/endurance performance & sequencing claims
  strengthWarmupKnowledge.ts # General and specific warm-up protocol claims
  taperFuelingKnowledge.ts # Pre-event taper boundaries and fueling/hydration claims
  athleteEvidence.ts   # Identity-scoped athlete-specific evidence contracts, domain models, and validator (SKR4)
  athleteEvidencePolicy.ts # Pure policy refinement engine and safety monotonicity evaluator (SKR4)
  knowledgeFreshness.ts # Deterministic review-cadence classification and due/stale reporting (SKR5)
```

**Before changing engine behaviour**, read `docs/architecture/recommendation-engine.md`
(the two selection paths) and the relevant ADR. Known divergences between the ADRs and the
code are tracked in `docs/analysis/2026-08-08-architecture-review.md`, with remediation
sequenced in `docs/plans/`.

---

## External library documentation with Context7

Context7 is configured per developer/client rather than committed as repository MCP state. When its
tools are available, use Context7 **before relying on model memory** for external library/API
documentation, setup/configuration, migrations, deprecations, or version-specific code examples.

Before querying, derive the installed dependency version from this repository's manifest/lockfile
when practical and request version-appropriate docs. Do not use Context7 for repository-internal
architecture, business rules, ADRs, current implementation, or Git history.

If Context7 is unavailable or lacks the required version, use the dependency's official docs/source
and state the fallback when it materially affects confidence.

The normative routing and versioning policy is
[`docs/standards/agent-tooling.md`](./docs/standards/agent-tooling.md).

---

## Shared agent skills

Cross-agent workflow skills live in `.agents/skills/` (single source of truth):

- `issue-to-pr` — GitHub issue number → plan → implementation → verification → linked PR.
- `planner` — implementation planning.
- `external-library-docs` — Context7-first third-party documentation lookup.

Claude Code only discovers skills under `.claude/skills/`, so a Claude-visible skill there is a
thin pointer to the `.agents/skills/` file. Edit the shared file, never the pointer.

## Code navigation with Serena

The repository ships a [Serena](https://github.com/oraios/serena) project config in
`.serena/` (TypeScript and Python language servers). Serena is an optional local dependency,
but **when its tools are connected it is the preferred semantic navigation layer for source-code
discovery**. Do not block a task because Serena is unavailable; fall back to the normal repository
tools.

### Retrieval policy

For reviews, refactors, bug tracing and unfamiliar code:

1. Use `get_symbols_overview` for an unfamiliar file/area and `find_symbol` for the target.
2. Use `find_referencing_symbols` before changing a public/exported symbol, an engine
   decision-authority constant, or cross-module wiring. Add `find_implementations` when an
   interface/abstract symbol can have multiple implementations.
3. Use exact text search for literals, error messages, configuration keys, docs, YAML/JSON,
   generated files, and as a completeness check when appropriate.
4. If the language server cannot answer reliably, fall back rather than forcing a semantic query.

Do not make ceremonial Serena calls for docs-only work or a known tiny edit whose target is already
established. The objective is better evidence with less broad reading, not tool-call count.

### Semantic-navigation economy

For one cohesive issue, refactor, or review, prefer **one semantic-discovery pass by the primary
agent**. Serena is a precision tool for answering concrete symbol/reference questions, not a second
way to exhaustively read the repository.

- Once the target file/symbol and its relevant callers are established, read the code directly
  instead of repeatedly calling `find_symbol` for already-known locations.
- Do not have multiple subagents independently reconstruct the same call graph or architecture.
  Give reviewers the issue acceptance criteria, implementation summary, changed-file list and diff
  first; semantic lookup is only for a specific unresolved wiring/impact question.
- Use `find_referencing_symbols` / `find_implementations` when caller/implementation evidence is
  actually needed, not as a routine follow-up to every symbol lookup.
- Treat Serena project/language-service initialization as a transient startup state. If an early
  semantic call cannot run because initialization is still in progress, do the minimum useful
  fallback work and retry Serena before starting a broad source-reading sweep.
- As a soft tripwire, if semantic navigation reaches roughly 10–15 Serena calls for a single
  cohesive issue without materially narrowing the change surface, stop and reassess the retrieval
  strategy. This is not a hard correctness limit; larger refactors can legitimately exceed it.

This matters especially before changing an engine constant
([`CLAUDE.md` § 2](./CLAUDE.md#2-before-you-change-a-number-in-the-engine)): one reference
query can expose the implemented constant, its knowledge claim/coverage ownership, and the
`*PolicyAlignment.test.ts` assertions that must remain aligned.

### Worktree safety

Serena is stateful around an active project. A shell `workdir` change does not prove that a
long-lived Serena server is reading the same checkout. If a workflow creates a worktree after the
session starts:

- activate/retarget Serena to the **worktree path** and verify that project before semantic reads;
- prefer per-session startup with Serena's current `--project-from-cwd` support when possible;
- if the client cannot safely verify/retarget the active Serena project, skip Serena for that
  worktree and use ordinary repository tools rather than querying the wrong checkout.

See the dated tooling review
[`docs/analysis/2026-09-24-serena-agent-tooling-adoption-review.md`](./docs/analysis/2026-09-24-serena-agent-tooling-adoption-review.md)
for client-specific Claude Code/Codex/Antigravity guidance and the rationale for this policy.

### Memory and edit policy

* **Memories are an index, not a source.** `.serena/memories/` holds only pointers into
  `CLAUDE.md`, this file and `docs/`, plus Serena-specific notes. Do not copy invariants,
  command lists, package maps or version pins into a memory. When a memory disagrees with
  repository docs, the docs win; fix the memory.
* **Serena edits pass the same gates.** Edits made with `replace_symbol_body`,
  `rename_symbol` or `replace_content` get the same verification as any other change
  ([`CLAUDE.md` § 3](./CLAUDE.md#3-working-loop)). Review the diff before finishing.

---

## Reading the documentation

`docs/` directories are not interchangeable — each has a different relationship to the
truth, and reading one as if it were another has already caused a fixed defect to be
re-reported three times. **[`docs/README.md`](./docs/README.md) opens with the routing
table**: which directory is authoritative for what, precedence when two documents disagree,
and task-oriented entry points. Read it before trusting any other document here.

The short version:

| Directory | Is | Trust for | Do not trust for |
|---|---|---|---|
| `docs/adr/` | Immutable decisions | Intended design and rationale | What the code does today |
| `docs/architecture/` | Living reference | How it works today | Why it was chosen |
| `docs/standards/` | Normative living standards | Cross-cutting quality requirements | What the code necessarily does today |
| `docs/analysis/` | Dated audit | Evidence as of its date | Current state — verify against code |
| `docs/plans/` | Mutable, status-tracked | Work to be done; the status board in [`docs/plans/README.md`](./docs/plans/README.md) | Anything marked `Implemented`/`Archived` — that is history |
| `docs/ops/` | Runbooks | Operational procedure | Design intent |

**When documents disagree about current behaviour, the code wins, then `architecture/`,
then `adr/`.** Standards are normative: a code/standard mismatch is a deviation to fix or
document explicitly, not evidence that the standard should silently change.

**Before changing user-facing UI, responsive layout, navigation, accessibility, forms,
dialogs, or interaction behavior**, read [`docs/standards/ui-ux.md`](./docs/standards/ui-ux.md)
first, then [`docs/architecture/user-flows.md`](./docs/architecture/user-flows.md) and the
relevant flow-specific architecture document. Dated UX analyses and implemented plans are
evidence/history, not the current quality bar.

### Writing conventions

* **Reference symbols, never line numbers.** Write `` `rules.ts` `evaluateEnvelopes` `` or
  `` `prescription.ts:workoutForTemplate` ``, never `` `rules.ts:544-556` ``. Line numbers
  drift within hours; a 2026-08-08 audit found 91 of them in `docs/plans/`, three of six
  sampled already pointing at the wrong code on the day they were written.
* **A finished plan must not read like a work list.** When a plan reaches `Implemented`,
  strike or delete its present-tense problem statements. See
  [`docs/plans/README.md`](./docs/plans/README.md#conventions-that-exist-because-they-were-violated).

---

## Code style & testing standards

* **Python** — type hints on every module; `uv run mypy` (covering `src/garmin_sync` and
  `scripts/`) stays clean. Format with `ruff format`; lint with `ruff check`.
* **TypeScript** — every change must pass `tsc -b` and `eslint`. Engine evaluators stay
  pure: no Firestore, no `fetch`, no `Date.now()` in a decision path (there is none today).
  IO arrives through an injected boundary — `trainingHistory.ts` in TypeScript,
  `provider.py` in Python. `rules.ts`, `trainingIntent.ts` and `replay.ts` are the
  orchestration exceptions: they lazily import a Firestore-backed default only when the
  caller injected nothing. Do not widen that set.
* **Immutability** — derive new objects rather than mutating inputs; the engine's replay and
  audit guarantees (ADR-0010) depend on it.
* **Tests** — synthetic fixtures only (`tests/fixtures/` in Python,
  `app/src/sessions/fixtures/` and inline builders in the frontend). Never call a live API
  from a test. New decision-authority behaviour needs a policy-alignment test (ADR-0033);
  new engine behaviour needs a scenario the simulation harness can see.
* **Commits** — conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, …).
  Reference symbols, not line numbers, in messages too.
