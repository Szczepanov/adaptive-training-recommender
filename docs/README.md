# Adaptive Training Recommender — Documentation Hub

Welcome to the documentation for **Adaptive Training Recommender**, a hybrid system providing automated Garmin Connect ingestion and adaptive training recommendations.

---

## Start here: which document is authoritative?

Directories in `docs/` are not interchangeable. Each has a different relationship to the
truth, and reading one as if it were another is the single most expensive mistake made in
this repository so far — a fixed defect was re-reported three times because an
`Implemented` plan still read like a work list.

| Directory | Answers | Trust it for | Do **not** trust it for |
|---|---|---|---|
| [`adr/`](./adr/) | "What did we choose, and why?" | The intended design and its rationale. Immutable once accepted. | What the code *does today* — an ADR can be aspirational or partly unimplemented. |
| [`architecture/`](./architecture/) | "How does it work now?" | Current behaviour. Living reference, updated with the code. | Rationale — it describes, it does not justify. |
| [`analysis/`](./analysis/) | "What was true on date X?" | Evidence gathered on its date. Dated, never edited after publication. | Current state. Findings may have been fixed since. Verify against code. |
| [`plans/`](./plans/) | "How do we get from here to there?" | Sequenced work, with per-task status markers. | Anything in a plan marked `Implemented` or `Archived` — historical record only. |
| [`ops/`](./ops/) | "How do I run it?" | Operational procedure. | Design intent. |

**Precedence when two documents disagree: the code wins, then `architecture/`, then
`adr/`, then everything else.** If you find a disagreement, do not silently pick one —
record it in the current review document
([`analysis/2026-08-08-architecture-review.md`](./analysis/2026-08-08-architecture-review.md))
or fix the doc, and say which you did.

Two conventions apply to every document here, both added after being violated (see
[`plans/README.md` § Conventions](./plans/README.md#conventions-that-exist-because-they-were-violated)):

* **Reference symbols, never line numbers.** Write `` `rules.ts` `evaluateEnvelopes` ``,
  not `` `rules.ts:544-556` ``. Line numbers were measured to go stale within hours.
* **A finished plan must not read like a work list.** Present-tense problem statements in
  `Implemented` documents get acted on as if they were live.

### Task-oriented entry points

| If you are… | Read, in order |
|---|---|
| Changing engine decision behaviour | [`architecture/recommendation-engine.md`](./architecture/recommendation-engine.md) → the relevant ADR → [`analysis/2026-08-08-architecture-review.md`](./analysis/2026-08-08-architecture-review.md) for known divergences |
| Picking up scheduled work | [`plans/README.md`](./plans/README.md) — the status table says what is startable today |
| Changing Firestore paths, rules, or schema | [ADR-0002](./adr/0002-user-scoped-firestore-isolation.md) → [ADR-0010](./adr/0010-decision-provenance-and-audit-replay.md) → `app/firestore.rules` |
| Changing performance-outcome evidence | [`architecture/performance-outcome-evidence.md`](./architecture/performance-outcome-evidence.md) → [ADR-0023](./adr/0023-multidomain-session-authoring-execution-and-evidence.md) → [`plans/performance-outcome-validation.md`](./plans/performance-outcome-validation.md) |
| Changing dates or step semantics | [ADR-0003](./adr/0003-timezone-semantics-and-d1-step-window.md) — these are hard invariants, not preferences |
| Adding or editing workouts | [`workout-library.md`](./workout-library.md) → [ADR-0004](./adr/0004-workout-library-architecture.md) |
| Deploying or backfilling | [`ops/`](./ops/) |

---

## 📚 Documentation Index

### 🏛️ Architecture Decision Records (ADRs)
Architectural choices, system invariants, and technical trade-offs are documented as ADRs in [`docs/adr/`](./adr/):

* [**ADR-0001: Record Architecture Decisions**](./adr/0001-record-architecture-decisions.md) — Standardizing architectural decision tracking.
* [**ADR-0002: User-Scoped Firestore Isolation & Schema Version 3**](./adr/0002-user-scoped-firestore-isolation.md) — Strict multi-tenant security and user-scoped data modeling (`users/{userId}/...`).
* [**ADR-0003: Timezone Semantics & Previous-Day Step Window**](./adr/0003-timezone-semantics-and-d1-step-window.md) — Explicit `Europe/Warsaw` calendar boundaries and `D-1` completed day step semantics.
* [**ADR-0004: Decoupled Workout Library & Prescriptions**](./adr/0004-workout-library-architecture.md) — Layered exercise catalog, adjustable parameters, parameter bindings, and prescription semantics.
* [**ADR-0005: Raw Ingestion Archive & Offline Rebuild Pipeline**](./adr/0005-raw-archive-store-and-rebuild-pipeline.md) — Opt-in immutable GCS/local raw payload archiving and offline snapshot recalculation.
* [**ADR-0006: Reconciled Strain Telemetry & Baseline Drift Scoring**](./adr/0006-reconciled-strain-telemetry.md) — Acute metric deviation vs 28-day baseline drift strain decomposition.
* [**ADR-0007: Adaptive Multi-Sport Engine Architecture & Utility Optimization Pipeline**](./adr/0007-adaptive-multisport-engine-architecture.md) — 6-tier adaptive engine, schedule availability, event periodization, microcycle objectives, 6D fatigue decay, and utility optimization.
* [**ADR-0008: Rolling 7-Day Week-Ahead Planning**](./adr/0008-week-ahead-planning.md) — Confidence-tiered multi-day forecast, rolling microcycle window, and never-persisted recomputation.
* [**ADR-0009: Training Intent Is History-Seeded**](./adr/0009-training-intent-history.md) — Evaluation-time intent resolution, the `TrainingHistoryProvider` boundary, and advisory-only sequence context.
* [**ADR-0010: Decision Provenance, Audit Records & Replay**](./adr/0010-decision-provenance-and-audit-replay.md) — `DataState` read semantics, immutable history revisions, persisted audits, `POLICY_VERSION`, and replay verification.
* [**ADR-0011: Weekly Architecture — Session Anchors & Ranking Modifiers**](./adr/0011-weekly-architecture-anchors.md) — The anchor pre-pass and optimizer Patches 4–6, including why this composition should not be extended.
* [**ADR-0012: Plan Intent and Sequence Planning are the Training Authorities**](./adr/0012-plan-intent-authority.md) — `PlanDefinition` and sequence planning collapse the two selection paths into one training authority (Phase 2).
* [**ADR-0013: Structured Injury Constraints Are the Canonical Safety Input**](./adr/0013-structured-injury-constraints.md) — *Retroactive record.* Structured `InjuryConstraint[]` (D-INJ), not consolidation onto guardrails, as the canonical safety input (Phase 1).
* [**ADR-0014: Objective Credit V2 & Honest Delivered Load**](./adr/0014-objective-credit-v2-and-honest-load.md) — Fractional credit, canonical stimulus axes, delivered cost, and the deferred fatigue-fusion decision.
* [**ADR-0015: Sequence Planning — Bounded Beam Search Prototype, Adoption Deferred**](./adr/0015-sequence-planning-and-session-role-model.md) — Phase 5.1's beam-search prototype, its comparison data against the production greedy planner, and why adoption is deferred rather than shipped or rejected.
* [**ADR-0016: Adaptation Credit & Weekly Coverage**](./adr/0016-adaptation-credit-and-weekly-coverage.md) — Separates physiological adaptation credit from exact authored weekly programming-role coverage.
* [**ADR-0017: Training Intent Profile & First-Class Planning Modes**](./adr/0017-training-intent-profile-and-planning-modes.md) — Accepted evidence-to-dose-to-capacity Evergreen contract that preserves structured and demand-derived event paths (Phase 7B).
* [**ADR-0018: Weekly Allocation, Safe Role Reservations & Explicit Misses**](./adr/0018-weekly-allocation-and-role-reservations.md) — Accepted production-greedy allocation contract for preserving safe, required weekly roles after PR #17.
* [**ADR-0019: Externally-Authored Plans & Session Adjudication**](./adr/0019-externally-authored-plans-and-session-adjudication.md) — *Accepted.* A third planning mode in which an imported plan owns selection and the engine owns safety, dose, and weekly critique.
* [**ADR-0020: Subjective Baselines in Readiness Mode**](./adr/0020-subjective-baselines-in-readiness-mode.md) — *Accepted.* Self-normalised subjective drift as a tighten-only term, gated on check-in coverage, with estimator details deferred to calibration and a production ship decision gated on Phase 9.0's prospective evidence.
* [**ADR-0021: Strength Session Logging & Intensity Gauges**](./adr/0021-strength-session-logging-and-intensity-gauges.md) — *Accepted.* Durable raw strength-session logging, gauge semantics, safe estimated-1RM write-back, and the evidence gate before logged work can affect engine cost or stimulus.
* [**ADR-0022: Zone-Derived Completed-Training Credit Is a Measured Candidate**](./adr/0022-zone-derived-completed-training-credit.md) — *Accepted.* A direct power-zone-share candidate may be measured inside the existing evidence tier, but production remains on TE pending a later evidence-backed activation decision.
* [**ADR-0023: Multidomain Session Authoring, Execution, and Evidence**](./adr/0023-multidomain-session-authoring-execution-and-evidence.md) — *Accepted.* Source-neutral session definition, occurrence authority, subcollection performed entries, D-MSNAP content-addressed snapshots, D-MCHOICE bounded option sets, and single tissue authority linkage.
* [**ADR-0024: Metric-Specific Biometric Baseline Estimators**](./adr/0024-biometric-baseline-estimator-policy.md) — *Accepted.* Metric-specific robust location/scale estimators (median/MAD vs mean/stdev) justified by replay evidence.
* [**ADR-0025: Physiological Anomaly and Possible-Illness Signals**](./adr/0025-physiological-anomaly-and-possible-illness-signals.md) — *Accepted.* Defines a separate health-anomaly capability, independent of training strain, using respiration/RHR/HRV to detect pre-symptomatic patterns.
* [**ADR-0026: Wearable Telemetry Enrichment Boundaries and Ownership**](./adr/0026-wearable-telemetry-enrichment-boundaries.md) — *Accepted.* Separates date-bound recovery data (including SpO2/skin-temperature), current Garmin performance/profile/gear imports, per-activity enrichment (including running dynamics), and replay ownership; a gait-asymmetry alert, an interactive sleep-stage chart, and a generic gear-retirement rule remain explicitly deferred.
* [**ADR-0027: Source-Aware Multisource Health Observations**](./adr/0027-source-aware-multisource-health-observations.md) — *Accepted.* Provenance-separated provider and transport dimensions, day-source observation bundling, source-specific baselines with maturity lifecycle, no arithmetic cross-sensor averaging, step count provenance locking, and evidence-gated fusion.

---

### 🔍 Reviews & Analysis
Point-in-time assessments of the system as built, including gaps between documented decisions and implemented behaviour:

* [**2026-08-08 Codebase, Docs & Decision Review**](./analysis/2026-08-08-architecture-review.md) — Full-repository review with a sequenced remediation plan.
* [**2026-08-09 Phase 0–5 completion review**](./analysis/2026-08-09-phase-0-5-completion-review.md) — Current reconciliation of the remediation plans, verification evidence, and remaining calibration/process work.
* [**2026-08-10 Phase 6 Calibration Corpus**](./analysis/2026-08-10-phase-6-calibration-corpus.md) — Multi-week scenario definitions, real history coverage, and telemetry verification targets.
* [**2026-08-10 PR #17 semantic-baseline follow-up**](./analysis/2026-08-10-pr17-semantic-baseline-follow-up.md) — Evidence, rejected calibration candidates, and the remaining sequence-level acceptance work.
* [**2026-08-10 Training-intent & periodization architecture analysis**](./analysis/2026-08-10-training-intent-periodization-architecture.md) — Evidence for Phase 7A/7B mode, preference-ownership, capacity, and stateful-allocation proposals.
* [**2026-08-11 Phase 6 & 7 compliance review**](./analysis/2026-08-11-phase-6-7-compliance-review.md) — Code, test, simulation, deployment, and plan-status review of the delivered Phase 6 and Phase 7 work.
* [**2026-08-15 Externally-authored plan feasibility**](./analysis/2026-08-15-externally-authored-plan-feasibility.md) — Structural assessment of importing an externally-authored plan and narrowing the engine to per-session adjudication.
* [**2026-08-16 ADR consistency, evidence, and governance review**](./analysis/2026-08-16-adr-review.md) — Cross-ADR audit verifying structural decisions, deferred features, and evidence boundaries.
* [**2026-08-16 Manual AI loop vs app adjudication**](./analysis/2026-08-16-manual-loop-vs-app-adjudication.md) — Whether the athlete's manual daily AI loop should be replaced by the app now that Phase 8 has landed. Verdict: shadow both for one block first; the subjective input is the one unmeasured path.
* [**2026-08-17 Garmin high-resolution telemetry**](./analysis/2026-08-17-garmin-high-resolution-telemetry.md) — Live endpoint-shape evidence and bounded ingestion recommendations for per-activity zones, power metrics, and laps.
* [**2026-08-17 Garmin zone-credit measurement**](./analysis/2026-08-17-garmin-zone-credit-measurement.md) — Bounded de-identified real-history comparison of ADR-0022's candidate against TE; decision: keep the candidate off.
* [**2026-08-17 Strength session logging: the missing return path**](./analysis/2026-08-17-strength-logging-gap.md) — Analysis of raw set-logging requirements, gauge representations, and self-calibrating 1RM.
* [**2026-08-17 Strength S-task implementation review**](./analysis/2026-08-17-strength-s-phase-implementation-review.md) — Review of the delivered S0–S6 logging and estimation foundation.
* [**2026-08-18 Strength session UI/UX review**](./analysis/2026-08-18-strength-session-ui-ux-review.md) — Browser- and code-backed review of the gym-floor logging flow; verdict: durable persistence foundation, but resume, correction, terminal-action safety, mobile layout, prescription context, accessibility, and visual coverage need work before the UX is finished.
* [**2026-08-18 Authored composite session import and execution**](./analysis/2026-08-18-authored-composite-session-import-and-execution.md) — Design analysis for importing or manually building the supplied strength/Olympic/field sessions and executing them against a source-neutral, revisioned prescription without weakening engine authority or replay.
* [**2026-08-18 Multidomain training system — consolidated analysis**](./analysis/2026-08-18-multidomain-training-system-consolidated-analysis.md) — Consolidates the Strength UX, composite-session and speed/field/power requirements into one bounded architecture: deterministic session execution first, protocol/response evidence next, and engine policy only after measurement.
* [**2026-08-19 Product-scope cutline review**](./analysis/2026-08-19-product-scope-cutline-review.md) — Evidence-first cutline establishing the delivery chain for multidomain execution.
* [**2026-08-20 M-plan status and next steps**](./analysis/2026-08-20-m-phase-status-and-next-steps.md) — Reconciliation of multidomain session execution and report-first evidence summary.
* [**2026-08-21 Performance outcome validation**](./analysis/2026-08-21-performance-outcome-validation.md) — Closes the recommendation → adaptation loop: the repeated-testing usage trigger formerly recorded under M7 has fired, and OV is the dedicated evidence-only outcome/progress/block-report implementation plan rather than a parallel M task family.
* [**2026-08-21 Physiological anomaly and illness-risk research**](./analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md) — Evidence-backed research into respiratory rate, RHR, HRV, and confounder modelling for health anomaly alerting.
* [**2026-08-21 Post-HA-D plan reconciliation**](./analysis/2026-08-21-post-ha-d-plan-reconciliation.md) — Status audit of executable tasks across HA, OV, S, and Multidomain following PR #171.
* [**2026-08-26 Architecture and maintainability review**](./analysis/2026-08-26-architecture-and-maintainability-review.md) — Architectural integrity, policy boundaries, and schema evolution audit across the backend, frontend, and rules layer.
* [**2026-08-26 Scientific and recommendation-quality validation**](./analysis/2026-08-26-scientific-and-recommendation-quality-validation.md) — Point-in-time analysis of physiological/mathematical validity of signals, baseline sensitivity, and closed-loop feedback design.
* [**2026-08-26 Scientific validation PR review hardening**](./analysis/2026-08-26-scientific-validation-review-hardening.md) — Review corrections for the SV1–SV3 evidence-sidecar implementation.
* [**2026-08-27 Google Health and Multisource Wearable Integration**](./analysis/2026-08-27-google-health-and-multisource-wearable-integration.md) — Structural analysis of Google Health REST/webhook integration, Eight Sleep export uncertainties, transport vs provider separation, and raw observation storage.
* [**Phase 9.4 Subjective history integration**](./analysis/phase-9-4-subjective-history-integration.md) — Integration analysis for composition-boundary range reads and data-quality handling.

---

### 🗺️ Implementation Plans
How agreed changes get made. Mutable, status-tracked, and expected to go stale — see [`docs/plans/`](./plans/) for the index and conventions.

* [**Phase 0: Instrumentation & developer baseline**](./plans/phase-0-instrumentation.md) — Coaching invariants as the CI gate; clean-clone runnability.
* [**Phase 1: Live defects**](./plans/phase-1-live-defects.md) — Injury gate, Garmin objective credit, recommendation immutability.
* [**Phase 2: Plan intent is the planning authority**](./plans/phase-2-plan-intent-authority.md) — ADR-0012, `PlanDefinition`, collapsing the two selection paths.
* [**Phase 3: One ranking path**](./plans/phase-3-single-ranking-path.md) — Lexicographic priorities replacing modality anti-stacking.
* [**Phase 4: Objective credit V2**](./plans/phase-4-objective-credit-v2.md) — One credit model, finished stimulus vocabulary, honest load.
* [**Phase 5: Sequence planning**](./plans/phase-5-sequence-planning.md) — Bounded search, fixed activities, tissue state, evidence hierarchy.
* [**Phase 6: Evidence-driven calibration & operational assurance**](./plans/phase-6-evidence-and-operational-assurance.md) — Scenario telemetry, calibration evidence, and Firestore-rule deployment assurance.
* [**Phase 6.2c: Recommendation quality & weekly coverage**](./plans/phase-6-2c-recommendation-quality-and-weekly-coverage.md) — *Implemented.* Separates adaptation credit from weekly programming-role coverage (ADR-0016).
* [**Phase 7A: Weekly allocation & safe role reservations**](./plans/phase-7-weekly-allocation-and-role-reservations.md) — *Implemented.* The PR #17 follow-up: reserve eligible required roles, protect them from support work, and report safety-forced misses.
* [**Phase 7B: Training intent, capacity & planning modes**](./plans/phase-7-training-intent-and-planning-modes.md) — *Implemented.* Evergreen evidence-to-dose-to-capacity planning proposal.
* [**Phase 8: Externally-planned mode**](./plans/phase-8-externally-planned-mode.md) — *Implemented.* Import an externally-authored plan, adjudicate its sessions against daily readiness, and repoint the weekly machinery to critique.
* [**Phase 9.0: Shadow mode and the decision journal**](./plans/phase-9-0-shadow-mode-and-decision-journal.md) — *In progress.* Journal storage, UI, agreement classification, export and the engine-isolation guard are done; only the operational unattended-ingestion step and running the multi-week block itself remain.
* [**Phase 9: Subjective baselines in readiness mode**](./plans/phase-9-subjective-baselines.md) — *In progress.* ADR-0020 accepted; 9.1–9.7 (baseline computation, `DailyReadiness` carriage, the default-off drift term, the composer's history read, the scenario corpus's real subjective variance, the planner-level comparison harness, and telemetry/audit/rationale) are all done and still bit-identical to production while the selector stays `'off'`. Only 9.8 remains, and shipping stays gated on Phase 9.0's prospective evidence.
* [**AI judge Phase 5–6: calibration controls and reference audit**](./plans/ai-judge-phase-5-6-calibration-and-reference-audit.md) — *In progress.* Adds a frozen evaluator self-test and an opt-in compatible-run reference audit without changing planner behavior or the committed score baseline.
* [**Garmin per-activity telemetry**](./plans/garmin-activity-telemetry-ingestion.md) — *Implemented.* Additive ingestion and the read-only activity view are delivered; ADR-0022's measured zone-credit candidate remains off after the real-history no-ship decision.
* [**Strength session logging**](./plans/strength-session-logging.md) — *In progress (default-off).* The raw logger, 1RM derivation and manual-training measurement path are built; live Strength load remains evidence-gated.
* [**Multidomain session authoring, execution & evidence**](./plans/multidomain-session-authoring-execution-and-evidence.md) — *In progress.* M0–M5.3 are delivered; M6 remains independently usage-triggered; M8.1 is the currently dependency-unblocked M-owned candidate item. Repeated standardized testing/progress is no longer tracked as actionable M7 work: its trigger/history remains here, but implementation/status ownership transferred to OV on 2026-08-21.
* [**Mobile UX/UI redesign**](./plans/mobile_ux_implementation_plan.md) — *Implemented.* Mobile-first redesign of the daily check-in, state-first Home dashboard, unblocked recommendations, and runner execution focus.
* [**Performance outcome validation & goal-progress loop**](./plans/performance-outcome-validation.md) — *In progress and canonical for repeated testing/progress.* Engineering through OV6.1 is merged (#154, #155, #163, #164, #169). Operational OV7 on the real event/block timeline is active; OV4.4 and OV6.2 remain evidence/usage-gated, with production recommendation authority strictly excluded.
* [**Health anomaly and possible-illness alerting**](./plans/health-anomaly-and-illness-risk-alerting.md) — *In progress.* Explainable physiological-anomaly evidence with structured confounders; HA0–HA5 on `main` (HA5 via #171), HA6.1–HA6.3 prospective outcome labels implemented.
* [**Health anomaly causality & canonicalization cleanup**](./plans/health-anomaly-causality-cleanup.md) — *Implemented.* Shared health-context defaults, temporal causality, and adverse physiology persistence under explanatory context.
* [**Multisource Health & Recovery Ingestion**](./plans/multisource-health-and-recovery-ingestion.md) — *Approved (MS0 ready).* Source-aware observation contract, Google Health raw ingestion, Eight Sleep export probing, transport-equivalence testing, and evidence-gated recovery fusion (ADR-0027).

---

### 🏗️ System Architecture
In-depth technical design documents covering system subsystems:

* [**Wearable Ingestion Pipeline & Telemetry Architecture**](./architecture/ingestion-pipeline.md) — Current Garmin provider boundary, recovery/profile/activity ownership, archive/rebuild semantics, auto-sync coordination, and workout publication.
* [**Recommendation Engine**](./architecture/recommendation-engine.md) — The two selection paths, module map, self-normalised strain scoring, `train`/`modify`/`recover` modes, candidate ranking, and the authority ordering.
* [**Performance Outcome Evidence**](./architecture/performance-outcome-evidence.md) — Current OV0–OV2 evidence architecture: bounded metric/protocol contracts, deterministic comparison series, append-only observation corrections, assessment/competition records, manual adapter and Firestore enforcement, with no selection authority.
* [**Health Anomaly Shadow Architecture**](./architecture/health-anomaly-shadow.md) — Evaluator boundary, fail-closed runtime selection, episode continuity, immutable assessment revisions, and prospective outcome capture.
* [**Garmin Gear Mileage Tracking**](./garmin-gear-tracking.md) — Gear inventory import, mileage enrichment, failure semantics, and Firestore layout for `users/{userId}/gear/{gearPk}`.
* [**Workout Library Architecture**](./workout-library.md) — Multi-layered workout definitions, variants, and September race event plan contract.
* [**External Plan Import Schema**](./external-plan-schema.md) — *Implemented.* JSON contract for importing an externally-authored plan, plus the placement/revision scheduling model.
* [**Sustained Multidirectional Field Macrocycle (v5)**](./macrocycle-v5.md) — Target multidirectional speed, strength, and endurance field macrocycle specification.
* [**Visual Review Workflow**](./visual-review.md) — Visual regression and layout review test harness using Playwright.

---

### 🛠️ Operations & Guides
Operational manuals and operational procedures:

* [**Google Health Source-Provenance Probe**](./ops/google-health-source-provenance-probe.md) — Real-account empirical validation procedure for Google Health API data types, source application provenance, Garmin equivalence, and Eight Sleep export presence.
* [**GCP Cloud Run & Cloud Scheduler Deployment**](./ops/cloud-run-deployment.md) — Packaging Docker images, GCS token store management, Cloud Run services and jobs, and Cloud Scheduler setups.
* [**Data Backfill, Audit & Offline Rebuild**](./ops/data-backfill-and-rebuild.md) — Executing historical backfills, data completeness audits, and offline raw payload rebuilds.
* [**Firestore Rules Deployment**](./ops/firestore-rules-deployment.md) — Local repository-owned deployment, deployed-source drift checks, and ruleset rollback.
* [**Frontend, Firestore Rules & Indexes Deployment**](./ops/frontend-deployment.md) — Manual and automated procedures for Firebase Hosting, Security Rules, and Firestore Index deployment.
* [**Self-Service Garmin Accounts & Family Setup**](./ops/multi-user-family-setup.md) — Operational guide for onboarding multiple Garmin users, local token bootstrap, and family member mapping.
* [**End-to-End Production Deployment**](./ops/production-deployment.md) — Full checklist and workflow for deploying backend Cloud Run jobs, Cloud Scheduler triggers, and frontend assets.

---

## ⚡ Quick Links & Root Documents

* [`AGENTS.md`](../AGENTS.md) — AI agent guidance, system constraints, and command cheat sheet.
* [`README.md`](../README.md) — Root project overview, env vars, quick start commands.
