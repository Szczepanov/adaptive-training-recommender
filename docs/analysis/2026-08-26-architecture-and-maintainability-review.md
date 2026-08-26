# Architecture and Maintainability Review (2026-08-26)

## Executive Summary

This audit evaluates the architectural integrity, policy boundaries, schema evolution, and maintainability of the `adaptive-training-recommender` system across its Python backend (`src/garmin_sync/`), TypeScript recommendation engine and frontend (`app/src/`), and Firestore security layer (`app/firestore.rules`).

While the core algorithmic foundations (ADR-0010 provenance, ADR-0012 plan intent authority, ADR-0014 honest load credit, ADR-0017 evergreen planning) are sound and mathematically disciplined, the system exhibits notable architectural complexity:

1. **Dual Selection Paths**: Path A (`evaluateTraining`, synchronous) and Path B (`evaluateTrainingWithIntent`, asynchronous) both exist in `rules.ts`. Production (`Home.tsx`, `PlanView.tsx`) uses Path B, but Path A is still actively used in tests and by `evaluateNextDayPlan`, leaving room for behavioral drift between test harnesses and production execution.
2. **Schema & Policy Duplication**: Critical schema definitions and validation logic are triplicated across Python dataclasses (`src/garmin_sync/models.py`), TypeScript interfaces/parsers (`app/src/engine/models.ts`, `app/src/persistence/parsers/`), and Firestore security rules (`app/firestore.rules`, 1,471 lines).
3. **Layer Inversions in Engine**: `app/src/engine/composer.ts` and `app/src/engine/firestoreTrainingHistory.ts` import directly from `app/src/services/`, breaking the pure functional engine boundary.
4. **Lack of Explicit Cross-Boundary Integration Contracts**: Unit test coverage is extensive, but the integration boundaries between Python ingestion, the TS recommendation engine, Firestore persistence, and privileged workout exports relied on implicit structural typing rather than formal contract validation — this review adds that layer (Section 11).

---

## 1. Authoritative Selection Path Analysis

### 1.1 Current Architecture

The engine currently houses two distinct selection paths within `app/src/engine/rules.ts`:

* **Path A — Synchronous / Readiness-Only (`evaluateTraining`)**:
  - Filters raw `TEMPLATES` (lacking newer enriched stimulus profiles).
  - Evaluates mode (`train` | `modify` | `recover`) and safety envelopes via `evaluateReadinessAndSafetyEnvelope`.
  - Filters by category allow-lists and modality preferences (`rankByModalityPreference`).
  - Selects a template via date-hash tie-breaking (`pickTemplate(rankedOptions, date)`).
  - Completely excludes phase-gated templates (`phaseEligibility`) and ignores multi-day fatigue states (`fatigue.ts`), objective credit (`stimulus.ts`), candidate optimization (`optimizer.ts`), evergreen strategies (`evergreenPlanning.ts`), and authored overlays.

* **Path B — Asynchronous / Intent-Aware (`evaluateTrainingWithIntent`)**:
  - The true production selection engine.
  - Consumes `ENRICHED_TEMPLATES` with full multi-dimensional stimulus and cost profiles.
  - Evaluates `evaluateReadinessAndSafetyEnvelope` to share envelope math with Path A.
  - Resolves planning mode (`planningMode.ts`), evergreen plans (`evergreenPlanning.ts`), and fixed activity credits (`fixedActivityIdentity.ts`).
  - Runs candidate optimization (`optimizer.ts:rankCandidates`) via lexicographic utility scoring (stimulus benefit vs. fatigue cost penalty, subject to injury constraints and dose caps).
  - Emits a full `DecisionTrace`, `plannedDose`, and `executionDose`.

* **Adjudication (`externalSession.ts`, ADR-0019)**:
  - Not a third selection path; an adjudication entry point where external sessions are gated through `evaluateTemplateEligibility` and `resolveExecutionDose`.

* **Authored Occurrences (`authoredSessionGates.ts`, ADR-0023)**:
  - Adjudicated occurrences resolved at the `Home.tsx` composition boundary for date-scoped execution.

### 1.2 Identified Risks & Drift

* `evaluateNextDayPlan` (sync) in `rules.ts` calls Path A (`evaluateTraining`), whereas `evaluateNextDayPlanWithIntent` (async) calls Path B (`evaluateTrainingWithIntent`).
* Multiple unit tests (e.g. `rules.test.ts`, `safetyInvariants.test.ts`, `sequenceSearch.test.ts`) still call `evaluateTraining` directly. If an invariant is verified only under Path A, it does not guarantee that Path B — which runs `rankCandidates` and utility optimization — obeys the same invariant under complex multi-day fatigue.
* **Remediation**: Deprecate direct external calls to `evaluateTraining` and unify all recommendation evaluation under `evaluateTrainingWithIntent` (with an in-memory mock history provider for synchronous/isolated testing where appropriate). This review does not perform that migration — it is a larger, riskier change than fits this pass — but flags it as the top follow-up item, and Section 11's Contract 2 (Observations ↔ Engine) is written against the shared envelope function (`evaluateEnvelopes`) so it holds regardless of which path consumes it.

---

## 2. Cross-Language & Cross-Layer Policy Duplication

| Policy Area | Python Backend (`src/garmin_sync/`) | TypeScript Engine (`app/src/`) | Firestore Security Rules (`app/firestore.rules`) |
|---|---|---|---|
| **Activity Intensity Classification** | `metrics.py:classify_activity_intensity` (`te >= 3.0` or `avg_hr >= 145` → hard) | `strengthExposure.ts` (1RM percentage / RIR thresholds), `completedTraining.ts` | Implicitly permitted through string fields |
| **Biometric Baselines & Deltas** | `metrics.py:compute_derived_metrics` (7d/28d mean, median, stdev, scaled MAD) | `subjectiveBaseline.ts` (exponential & rolling drift), `healthAnomalyFeatures.ts` | Validated for nullable number types |
| **Recommendation Audits** | None (pure client write) | `provenance.ts:buildRecommendationAudit`, `replay.ts` | `hasValidRecommendationAudit` (strict key checks, array length <= 64, enum constraints) |
| **Subjective Drift Audits** | None | `subjectiveDriftAudit.ts` | `hasValidSubjectiveDriftAudit` (strict keys, range checks) |
| **External Plan Schemas** | None | `sessions/externalPlanV2.ts`, `validationCore.ts` | `hasValidExternalPlanHeader`, `hasValidExternalPlanRevision` |
| **Session Definitions & Prescriptions** | `workout_export.py` (DTO subset) | `sessions/models.ts`, `sessions/validation.ts` | `hasValidSessionDefinitionHeader`, `hasValidExecutionPrescription` |

### 2.1 Drift Hazards

1. **Firestore Rules Desynchronization**: Whenever a field is added to `RecommendationAudit` or `SubjectiveDriftAudit` in TypeScript, omitting the field in `app/firestore.rules` causes silent permission-denied write failures in production, not a compile-time error.
2. **Intensity Heuristics**: Python classifies Garmin activities into `hard`, `moderate`, and `easy` using training effect and HR, while strength workouts use set-level RPE/RIR in TypeScript. Downstream engine consumers in `fatigue.ts` must reconcile both signal families without conflating cardiovascular and neuromuscular strain.

---

## 3. Firestore Security Rules Size and Testability

### 3.1 Metrics

* **File**: `app/firestore.rules` — **Size**: 1,471 lines, ~93 KB.
* **Scope**: 34+ collection/subcollection match blocks, 60+ custom validation functions.
* **Test Suite**: `app/src/emulator/firestoreRules.emulator.test.ts` (1,580 lines, ~89 test cases) plus several other emulator test suites.

### 3.2 Testability Assessment

* **Strengths**: The rules are extraordinarily thorough, validating not just ownership (`isOwner(userId)`), but deep document structure, map keys (`hasOnly`, `hasAll`), number ranges, and string formats (e.g. SHA-256 hashes, ISO-8601 dates).
* **Weaknesses**: The emulator test suites require a live Firebase emulator (Java runtime). As a result, plain `npm test` skips the security rule tests by default. A developer working without Java can introduce a rule drift that passes `npm test` but breaks writes in staging/production.
* **Tooling**: `app/scripts/check-firestore-rules-drift.mjs` provides static git-drift verification, mitigating (but not eliminating) that risk in CI.

---

## 4. Client-Computed versus Server-Authoritative Fields

```text
[ Garmin Connect API ]
         │ (Garmin client with backoff)
         ▼
[ Python Ingestion Service ]
   ├── Writes Immutable Raw Archive: users/{userId}/raw_archive/{date}
   ├── Computes Derived Baselines (7d/28d avg, median, stdev, MAD)
   ├── Normalizes Activities: users/{userId}/activities/{activityId}
   └── Writes Snapshot: users/{userId}/daily_recovery_snapshots/{date}
         │
         ▼ (Firestore Read)
[ TypeScript React Client ]
   ├── Reads Recovery Snapshot + Activities
   ├── Captures Athlete Subjective Check-in: users/{userId}/daily_subjective_checkins/{date}
   ├── Computes Health Anomaly Telemetry (ADR-0025)
   ├── Computes Multi-day Fatigue State & Training Intent
   ├── Executes Recommendation Engine (evaluateTrainingWithIntent)
   ├── Writes Persisted Recommendation & Audit: users/{userId}/daily_recommendations/{date}
   ├── Executes Session Runner & Computes 1RM Updates: users/{userId}/session_executions/{id}
   └── Queues Workout Exports: users/{userId}/garmin_workout_queue/{date}
         │
         ▼ (Firestore Read / CLI Worker)
[ Python Workout Export Worker ]
   └── Transforms Canonical Workouts -> Garmin Workout DTOs -> Garmin API
```

### 4.1 Boundary Evaluation

* **Server-Authoritative**: Wearable biometrics, raw archive payloads, device sync metadata. The client never modifies raw recovery snapshots or historical synced activities.
* **Client-Authoritative**: Subjective check-ins, user preferences, training intent profiles, authored workouts, daily recommendations, session execution logs, and health anomaly assessments.
* **Integrity Guard**: Because recommendations and anomaly evaluations are computed client-side, Firestore security rules are the only server-side boundary — they must enforce that clients only write valid, revisioned documents, since there is no server-side recomputation to catch a malformed or forged write.

---

## 5. Schema-Version Migration Strategy

### 5.1 Python Ingestion Snapshots

* `SCHEMA_VERSION = 3` and `BASELINE_COMPUTATION_VERSION = 5` (`src/garmin_sync/models.py`).
* **Rebuild Pipeline** (ADR-0005): `src/garmin_sync/service.py:rebuild_snapshots` can regenerate all historical daily recovery snapshots offline from the immutable `raw_archive` when baseline estimators or schemas change.
* **User Data Migration**: `src/garmin_sync/migrate_user_data.py` supports migrating documents across user IDs during account consolidation.

### 5.2 TypeScript Domain Models & Persisted State

* `POLICY_VERSION`: a monotonically versioned date string (e.g. `2026.08.26.1`), tracked in every recommendation audit.
* **Content Hashing**: Authored sessions and execution prescriptions use canonical SHA-256 content addressing (`sessionDefinitionHash.ts`), making revisions immutable and tamper-evident.
* **Tolerant Parsers**: Parsers in `app/src/persistence/parsers/` safely parse legacy documents (e.g. handling a missing 28d MAD, or a legacy `strength_sessions` structure) by supplying clean defaults or flagging an explicit `DataState.INVALID`.

---

## 6. Backward Compatibility of Stored Recommendation Audits & Replay

### 6.1 Audit Contract (ADR-0010, ADR-0014)

`RecommendationAudit` captures:
  - `policyVersion`, `evaluatedAt`, `decisionContextRevision`, `safetyStatus`
  - `history` (with `sourceStatuses`)
  - `envelope`, `plannedDose` / `executionDose`
  - `candidateScores` (all evaluated candidates, utility scores, penalties, and exclusion reasons)
  - `droppedContributorObjectives`, `externalPlan` / `authoredOccurrence` provenance
  - `subjectiveDrift`

### 6.2 Replay Integrity (`replay.ts`)

* `replayRecommendation(audit, currentEngine)` takes a persisted audit, re-runs the recommendation pipeline against the snapshot state, and verifies that the output matches the original decision.
* `isHistoricalPolicyVersion` detects when an audit was generated under an earlier policy version, letting replay tools distinguish intended algorithmic evolution from a regression defect.
* **Validation**: fixture test `tests/fixtures/pre_zone_credit_recommendation_audit.json` verifies backward compatibility against a historical audit revision predating zone-derived credit (ADR-0022).

---

## 7. Engine Module Dependency Direction & Layer Inversions

### 7.1 Coupling & Inversion Findings

1. **Layer Inversion in Engine**:
   - `app/src/engine/composer.ts` imports directly from `../services/` (`checkinService`, `goalService`, `preferencesService`, `recoverySnapshotService`, `trainingIntentProfileService`, `trainingSettingsService`).
   - `app/src/engine/firestoreTrainingHistory.ts` imports directly from `../services/` (`activityService`, `recommendationService`, `strengthHistoryReadService`).
   - *Architectural principle*: `app/src/engine/` should be a pure, functional domain layer. Services should orchestrate I/O and pass plain data into engine functions, rather than engine modules reaching back into stateful services.
2. **Workouts / Catalog Coupling**:
   - `engine/coverage.ts`, `engine/planningCandidate.ts`, `engine/weeklyDosePacking.ts`, and `engine/fixedActivityIdentity.ts` import directly from `app/src/workouts/catalog` and `app/src/workouts/event-plan`.
   - The engine is tightly coupled to the static workout catalog definitions rather than operating against an abstract `WorkoutCatalogProvider` interface, which would make the engine testable against synthetic catalogs and would decouple catalog content changes from engine logic changes.

---

## 8. Dead and Experimental Code Reachability Audit

1. **`sequenceSearch.ts`** (beam-search prototype referenced by ADR-0015, 410 lines):
   - **Reachability**: verified safe. It is imported only by `goldenWeek.test.ts`, `sequenceSearch.test.ts`, and the architectural boundary tests `src/observations/architecture.test.ts` and `src/sessions/architecture.test.ts`.
   - **Production isolation**: not imported by `rules.ts`, `planner.ts`, `composer.ts`, or any UI component. ADR-0015's "beam search deferred, greedy reservation used" status is accurate.
2. **`shadowAgreement.ts` & `shadowLog.ts`**:
   - **Reachability**: active in production. Used by `Home.tsx` and `recommendationService.ts` to compute `engineVerdict` (`proceed` | `scale` | `defer`) and to render CSV shadow-agreement telemetry — not dead code, but worth naming explicitly since "shadow" naming reads as experimental at a glance.
3. **AI-judge tooling** (`app/scripts/ai-judge/`):
   - **Reachability**: isolated to offline simulation scripts (`.mjs`, not `.ts`). Not imported by any `src/` module and not bundled into the Vite production application.

---

## 9. ADR Alignment Matrix (ADR-0001–ADR-0026)

| ADR | Title | Status in Reality | Alignment Assessment |
|---|---|---|---|
| 0001 | Record Architecture Decisions | Active | Fully followed; ADRs are recorded and referenced. |
| 0002 | User-Scoped Firestore Isolation | Active | Fully enforced in Python (`firestore_repository.py`) and in Firestore rules. |
| 0003 | Timezone Semantics & D-1 Steps | Active | `Europe/Warsaw` strictly enforced (`dates.py`, `localDate.ts`). |
| 0004 | Decoupled Workout Library | Active | `WorkoutDefinition` vs. `Prescription` separation active. |
| 0005 | Raw Ingestion Archive & Rebuild | Active | GCS/Firestore raw archive and rebuild orchestrator operational. |
| 0006 | Reconciled Strain Telemetry | Active (heuristic) | Telemetry active; "chronic overtraining" wording is a product heuristic label, not a clinical claim. |
| 0007 | Adaptive Multi-Sport Engine | Active | Utility optimization pipeline active in `optimizer.ts`. |
| 0008 | Rolling 7-Day Planning | Active | Rolling projection with confidence tiers active in `planner.ts`. |
| 0009 | Training Intent History-Seeded | Active | Dynamic intent evaluation active in `trainingIntent.ts`. |
| 0010 | Provenance, Audits & Replay | Active | Persisted audits and deterministic replay fully active. |
| 0011 | Weekly Anchors & Ranking Modifiers | Partially displaced | Anchor utility tie-breaking remains in `optimizer.ts`; primary safety enforcement moved to lexicographic rules (ADR-0012/0018). The ADR text should be updated to note this displacement. |
| 0012 | Plan Intent Authority | Active | Strict priority ordering and envelope constraints enforced. |
| 0013 | Structured Injury Constraints | Active | Canonical `InjuryConstraint[]` mapping enforced in `injuryPolicy.ts`. |
| 0014 | Objective Credit V2 & Honest Load | Active | Single credit ledger and delivered-dose scaling active. |
| 0015 | Sequence Planning (Beam Search Deferred) | Active | Beam search kept in prototype (Section 8); greedy reservation used in production. |
| 0016 | Adaptation Credit vs. Weekly Coverage | Active | Coverage registry and adaptation credit cleanly separated. |
| 0017 | Training Intent Profiles & Modes | Active | `planningMode.ts` is the single authority for planning mode. |
| 0018 | Weekly Allocation & Role Reservations | Active | Bounded deterministic reservation search active in `weeklyAllocation.ts`. |
| 0019 | External Plans & Adjudication | Active | `externalSession.ts` adjudicates imported plans through the standard eligibility/dose gates. |
| 0020 | Subjective Baselines in Readiness | Active | Recent-vs-long subjective baseline drift active in `subjectiveBaseline.ts`. |
| 0021 | Strength Session Logging | Active | Exercise set tracking, RPE/RIR, and intensity gauges active. |
| 0022 | Zone-Derived Training Credit | Active | Heart-rate/power zone time-allocation credit active. |
| 0023 | Multidomain Session Authoring | Active | Pinned SHA-256 definitions, occurrences, and executions active. |
| 0024 | Biometric Baseline Estimator Policy | Active | Metric-specific estimators (median/MAD for respiration, mean/stdev for HRV/RHR). |
| 0025 | Physiological Anomaly Signals | Active | Illness-risk detection and anomaly classification active in `healthAnomaly.ts`. |
| 0026 | Wearable Telemetry Boundaries | Active | High-resolution telemetry ingestion boundaries active. |

**Action item**: ADR-0011 is the one entry that no longer describes reality precisely — it should get a short "Superseded in part by ADR-0012/0018" amendment rather than being silently reinterpreted by readers.

---

## 10. Complexity Hotspots and Change Coupling

### 10.1 Top Complexity Modules (by line count)

1. **`app/src/engine/validationCore.ts`** (1,690 lines) and **`app/src/engine/models.ts`** (1,653 lines): domain interfaces, JSON schemas, and validators for the entire engine. High churn and tight coupling to every subsystem — almost any new field touches both files.
2. **`app/src/engine/planner.ts`** (1,497 lines): combines week-ahead generation, greedy slot filling, multi-day load projection, and fallback strategies in a single module.
3. **`app/firestore.rules`** (1,471 lines): high cognitive complexity, and a manual, hand-maintained duplicate of the TypeScript model schemas (Section 2).
4. **`app/src/engine/rules.ts`** (1,104 lines): envelope resolution, Path A selection, Path B selection, next-day scenario generation, and adjustment logic all in one file (Section 1).
5. **`app/src/engine/optimizer.ts`** (921 lines): utility scoring, recovery-style resolution, history feature summaries, and candidate ranking.

These five files are the natural starting point for any future decomposition effort — they concentrate both size and blast radius.

---

## 11. Explicit Contracts Between Subsystems

To prevent cross-boundary integration regressions, this review introduces four formal contracts, each backed by a contract test suite that exercises the *real* production functions on both sides of the boundary rather than re-deriving expectations from documentation alone:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Ingestion <───> Canonical Observations / Snapshots        │
│    (src/garmin_sync/models.py <──> DailyRecoverySnapshot)    │
└──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Observations <───> Recommendation Engine                  │
│    (DailyReadiness, EngineObjectiveInput <──> rules.ts)       │
└──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Recommendation Engine <───> Persistence & Firestore Rules  │
│    (Recommendation, RecommendationAudit <──> firestore.rules) │
└──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Persistence <───> Privileged Workout-Export Jobs           │
│    (garmin_workout_queue <──> workout_export.py)              │
└─────────────────────────────────────────────────────────────┘
```

1. **Contract 1 — Ingestion & Canonical Observations** (`app/src/contracts/ingestionSnapshotContract.ts`, `tests/test_contracts_ingestion.py`):
   Formalizes payload shape, required vs. nullable biometric fields, version flags (`sourceSchemaVersion`, `baselineComputationVersion`), and Europe/Warsaw date invariants. The Python test round-trips a real `DailyRecoverySnapshot.to_dict()` and `normalize_activity()` payload; the TypeScript test feeds an equivalent literal payload through the real `parseRecoverySnapshot` parser.
2. **Contract 2 — Observations & Recommendation Engine** (`app/src/contracts/observationEngineContract.ts`):
   Formalizes subjective input bounds and the safety-envelope invariants (pain → `Mobility`/`Rest` only and `Running` restricted; already-trained-today → `Rest`; depressed sleep/body-battery → capped at `Easy`). The test calls the real `evaluateEnvelopes` from `rules.ts`, so it is exercised regardless of whether a future change routes through Path A or Path B.
3. **Contract 3 — Engine & Persistence** (`app/src/contracts/enginePersistenceContract.ts`):
   Formalizes the persisted `DailyRecommendation` document shape and the `RecommendationAudit` schema (history/envelope/candidateScores blocks, `safetyStatus`, `candidateScores.length <= 64`, matching the Firestore rule's own cap). The test runs a real `evaluateTrainingWithIntent` → `buildRecommendationAudit` → `parseDailyRecommendation` round trip.
4. **Contract 4 — Persistence & Workout Export** (`app/src/contracts/workoutExportContract.ts`, `tests/test_contracts_workout_export.py`):
   Formalizes the queued `GarminQueuedWorkout` document and its nested `CanonicalWorkoutExport` payload — the shape that actually crosses into `workout_export.py` (non-empty blocks/steps, a real `durationSeconds`/`repetitions` dose signal, `targets` as a string array). The Python test exercises the real `canonical_workout_to_garmin_payload`/`summarize_garmin_payload` and asserts the transformed duration/target/rest *values* survive, not just that a payload came back. A separate `validateCatalogWorkoutStructure` check still validates every entry of the app's authoring-time `WORKOUTS` catalog, but that catalog shape is explicitly *not* claimed to be the export wire contract (see 11.1).

### 11.1 A Contract Test Catching a Real Boundary Bug

While implementing Contract 4, comparing the TypeScript validator against the actual Python reader (`workout_export.py`'s `step.get("durationSeconds")`, `step.get("targets")`) surfaced two real defects in the first draft of this contract, both now fixed and covered by regression tests:

1. **Wrong artifact validated.** The TypeScript side validated the app's authoring-time `WorkoutDefinition` catalog shape (`blocks[].steps[].duration.type`) as if it were the export wire contract. The shape that actually crosses to Python is `CanonicalWorkoutExport` (`app/src/utils/workoutJsonExport.ts`): `title`/`workoutId`, `blocks[].role`, `steps[].durationSeconds`, `steps[].targets: string[]`. These are different types with different field names — validating the catalog shape would never have caught a regression in the real export path. Fixed by adding `validateCanonicalWorkoutExportContract`, which checks the real `CanonicalWorkoutExport`/`GarminQueuedWorkout` shapes, and keeping the catalog check under its own, clearly-labeled name.
2. **Silent fallback masked a wrong fixture.** The first draft's Python test built a step with `durationSec` (singular) and a `target: {...}` object — neither of which `workout_export.py` reads. Because `_build_step_dto` defaults to `step.get("durationSeconds") or 300` and `_compile_target_sources` falls back to `no.target` when it finds nothing, the test still passed: every step silently became a generic 300-second no-target block, and the assertions were loose enough not to notice. Fixed by renaming the fixture fields to match production and adding assertions on the actual transformed duration/target/rest values (`tests/test_contracts_workout_export.py`), so a future regression to the wrong field names fails loudly instead of silently degrading.

This is the concrete case for contract tests the original prompt anticipated: a validator or fixture written by inference from documentation, rather than checked against the real reader on the other side of the boundary, can pass indefinitely while testing nothing real.

### 11.2 Shared Cross-Language Fixtures

Contract 1 and Contract 4 each span the Python/TypeScript boundary. Both now load one shared JSON fixture from `tests/fixtures/contracts/` (`ingestion_snapshot.json`, `normalized_activity.json`, `workout_export.json`) from both the `pytest` and the `vitest` suite, rather than each language hand-authoring its own literal. The Python tests assert their real serialization/transform functions reproduce the fixture's declared fields exactly (not just "some output came back"); the TypeScript tests run the same literal through the real parser/validator. A field renamed or removed on either side without updating the shared fixture now fails both suites, not neither.

### 11.3 Scope Not Covered

These contracts validate structure and range invariants; they do not (and cannot, from TypeScript alone) validate that `app/firestore.rules` accepts every document the contracts consider valid, or rejects every one they consider invalid — that still requires the emulator-backed rules tests (Section 3). Closing that last gap would mean generating rules-test fixtures from the same contract validators, which is a reasonable next step but out of scope for this pass.
