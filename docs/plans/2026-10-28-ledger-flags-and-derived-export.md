# Recorded flags and derived ledger export (#1165, #1153)

- **Status:** In progress
- **Blocked by:** None (`#1158`, `#1160`–`#1164`, and `#1172` gap 1 have landed on `main`; owner reviewed and revised the implementation contract on 2026-10-28).
- **Unlocks:** `#1167` (`[ADR-0052][D-ENGINE Phase 2] Switch off daily recommendation engine after D-EVAL pass`) and the qualifying 28-day `D-EVAL` block (`C3` flag auditability)
- **Decision source:** [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md) (`D-EXPORT`, `D-FLAGS`, `D-ENGINE Phase 1`, `D-EVAL`), [ledger-export-contract.md](../architecture/ledger-export-contract.md), [2026-10-25-adr-0052-d-eval-criteria.md](../analysis/2026-10-25-adr-0052-d-eval-criteria.md) (`OD8`)

## Outcome
The existing **Export ledger (JSON)** action includes extracted Layer 2 baseline values (`derived`) and dated, immutable Layer 3 advisory flag evaluations (`flags`). The export remains read-only and deterministic. Engine recommendations, session doses, and launch decisions in `app/src/engine/` are untouched (`D-ENGINE` freeze).

## Implementation rulings against the landed APIs

- Preserve the existing `FlagEvaluation.threshold: string | null` as the human-readable
  rule. Persist that field directly rather than adding a duplicate `rule` field and
  changing `threshold` into an incompatible object. Keep the actual evaluator version
  constants (including `illness_anomaly-v1`) and recovery baseline-window description.
- Keep `DerivedMetric.value` for compatibility; add an optional `metrics` map of
  independently state-bearing numeric leaves and add the `subjective_baselines` id.
  A readable structured container has no scalar aggregate, so its scalar leaf is
  `not_applicable`; its named metrics carry the actual measured/missing values.
- The extracted subjective estimator uses `readiness`, `sleepQuality`, `fatigue`,
  `soreness`, `mentalStress`, and `motivation`, all on the recorded 1–10 scale.
  Export `recentAvg`, `longAvg`, `variability`, `recentRecordedDays` and
  `longRecordedDays`; do not invent mood, a 1–5 conversion, or a deviation the
  estimator does not return. Insufficient coverage leaves averages missing and
  retains complete distinct-day counts.
- Use state-aware `getCheckinState` and `getOccurrencesInRangeState`; the latter
  avoids the convenience reader that silently drops malformed occurrences. Resolve
  occurrence definitions from their actual `occurrenceId`/source bindings.
- Full-window fallback is uniformly `not_recorded` on uncaptured dates. Recorded
  illness/anomaly evaluations are always clamped to the unreleased HA7 representation
  at export, including caller-supplied results.
- Capture reads fixed activities before resolving external placements, so occupied
  dates are handled by the existing placement authority. Mutation notifications contain
  only the account id and trigger an independent capture in the authenticated app.

## Approaches
1. **Recommended:** Capture the current `Europe/Warsaw` date's flags in the authenticated app's lifecycle and persist immutable revisions under `users/{uid}/flag_evaluations/{revisionId}`; export reads that history and fills uncaptured `(date, flagId)` pairs in the requested window with `state: 'not_recorded'`. Reuses the landed TypeScript evaluators in `app/src/derived/flags/`. No evaluations are fabricated for dates the app was not opened.
2. **Capture in Python daily sync:** Runs without the browser app open, but requires either a second flag-evaluator implementation in Python or a new cross-runtime TypeScript execution boundary in Cloud Run/scheduled sync; neither exists today, and duplicating threshold logic violates single-source provenance.
3. **Compute on export only:** Smaller diff, but fails `#1153` and `D-EVAL` (`C3`) because mutable training-settings injuries (`TrainingSettings.injuries`) and post-hoc plan edits cannot reconstruct what constraints or placements were active on a past date `D`.

Combining `#1165` and `#1153` avoids building an export-only synthesis path that `#1153` immediately replaces with persisted `flag_evaluations` reads.

## Task board

| Work item | Status |
|---|---|
| WI-1 — Flag capture and persistence | [x] Finished |
| WI-2 — Flag export | [x] Finished |
| WI-3 — Derived baselines | [x] Finished |
| WI-4 — Contract and verification | [x] Finished |

## Work items and dependencies

### [x] WI-1 (`#1153`): Persist per-date `D-FLAGS` revisions (`flagEvaluationPersistence`, `flagCaptureService`, Firestore rules)
  - **Depends on:** Landed evaluators in `app/src/derived/flags/` (`evaluateRecoveryBeyondBaseline`, `evaluateIllnessRiskSymptom`, `evaluateIllnessAnomalyFlag`, `evaluateInjuryConstraintTouchesSession`)
### [x] WI-2 (`#1165` part A): Wire `flag_evaluations` into `SOURCE_KEYS`, `LedgerExportService`, and windowed `buildFlags`
  - **Depends on:** WI-1 persistence parser and query contract
### [x] WI-3 (`#1165` part B): Populate extracted Layer 2 `derived` baselines and extend `LedgerExportService` check-in history read
  - **Depends on:** Landed `computeSubjectiveBaseline` (`app/src/derived/baselines/subjectiveBaseline.ts`) and `DailyRecoverySnapshot.derived` (`app/src/types/recovery.type.ts`)
### [x] WI-4 (`#1153`, `#1165`): Contract schema regeneration, renderer/golden updates, rules emulator tests, and browser export verification
  - **Depends on:** WI-1, WI-2, WI-3

## Capture and persistence (`#1153`)

### 1. Stored document contract and deterministic identity
- Define `PersistedFlagEvaluation` (extending `FlagEvaluation` from `app/src/derived/flags/flagEvaluation.ts` and aligning with `LedgerFlag` in `app/src/ledger/export/schema.ts`) under `users/{userId}/flag_evaluations/{revisionId}`:
  - `schemaVersion: 1`
  - `userId: string`
  - `revisionId: string` and `idempotencyKey: string`
  - `id: LedgerFlagId`
  - `observedOn: string` (`Europe/Warsaw` calendar date `YYYY-MM-DD`)
  - `evaluatedAt: string` (ISO-8601 UTC timestamp with `Z` or explicit offset)
  - `sessionRef?: string` (present when scoped to a specific planned/scheduled session; omitted for date-scoped evaluations)
  - `active: boolean | null`
  - `state: LedgerState`
  - `reasonCode?: string`
  - `definitionVersion: string`
  - `baselineWindow?: string` (`'7-day delta vs 28-day variability; excludes the 28-day chronic-drift term'` for `recovery_beyond_baseline`; omitted when a flag does not use a baseline window)
  - `inputs: FlagEvaluationInput[]`
  - `threshold: string | null`
- Compute `idempotencyKey` and `revisionId` deterministically from a canonical JSON digest of `(userId, observedOn, id, sessionRef ?? null, active, state, reasonCode ?? null, definitionVersion, baselineWindow ?? null, inputs, threshold)` — intentionally **excluding** `evaluatedAt`.
  - Repeated captures on the same day with unchanged source revisions, inputs, sessions, injuries, and evaluator `definitionVersion` resolve to the same `revisionId`; the transaction (`runTransaction` with `tx.get(docRef)` before `tx.set(docRef, payload)`) treats an existing identical revision as an idempotent no-op without mutating `evaluatedAt`.
  - When any input value/state, planned session set, injury constraint, or evaluator `definitionVersion` changes later on the same date, the digest produces a new `revisionId` and writes a new immutable revision alongside earlier revisions for that date.

### 2. Backing-source failure semantics during capture
- Capture reads each backing source through state-aware service methods rather than collapsing read errors into `null`:
  - `recoverySnapshotService.getRecoverySnapshotState(userId, observedOn)`
  - `checkinService.getCheckinForDateState(userId, observedOn)`
  - `trainingSettingsService.peekTrainingSettingsState(userId)` (after settings load, or state-aware read without fabricating default empty injuries on read failure)
  - `externalPlanService` active plan / placement state for `observedOn`
  - `sessionOccurrenceService.getOccurrencesForDate(userId, observedOn)` and `resolveSessionDefinition` (`app/src/sessions/sessionDefinitionResolver.ts`)
- **Critical distinction (`missing` vs `unavailable` / `invalid`):**
  - The pure evaluators (`evaluateRecoveryBeyondBaseline`, `evaluateIllnessRiskSymptom`, `evaluateInjuryConstraintTouchesSession`) assume a `null` snapshot/check-in means the user did not record one (`state: 'missing'`, `reasonCode: 'no_snapshot'` / `'no_checkin'`).
  - If the underlying Firestore read for a flag's backing source failed (`UNAVAILABLE`) or failed validation (`INVALID`), the capture service must **not** call the pure evaluator with `null` and persist `state: 'missing'`. Instead, it records `active: null`, `state: 'unavailable'` (or `'invalid'`), `reasonCode: 'source_unavailable'` (or `'source_invalid'`), and marks the affected `inputs` entry with `state: 'unavailable'` / `'invalid'`.

### 3. Session discovery and rest-day semantics for `injury_constraint_touches_session`
- Discover today's (`observedOn`) planned sessions without invoking `composeDailyDecisionInput` or any engine recommender:
  1. **Active external plan placements:** Read active external plan state and extract sessions placed on `observedOn` via `placedSessionsForDate(activePlan, observedOn)` (`status === 'planned' || status === 'moved'`). Use canonical `sessionRef = external_plan:${planId}@${revision}:${sessionId}` and the placed session's authored `SessionDefinition`.
  2. **Scheduled/authored occurrences:** Read `SessionOccurrence` documents for `observedOn` (`status` in `'scheduled' | 'active' | 'completed'`, excluding `'cancelled'` and `'skipped'`).
     - If `isExternalPlanOccurrence(occurrence)` matches an already-discovered external-plan placement for `(planId, revision, externalSessionId)` on `observedOn`, deduplicate in favor of the canonical `external_plan:${planId}@${revision}:${sessionId}` reference (using the occurrence's resolved `SessionDefinition` if an execution dose choice is already recorded).
     - Otherwise (manual/pinned authored session), resolve its `SessionDefinition` via `resolveSessionDefinition` and assign `sessionRef = occurrence:${occurrence.id}`.
- **Zero-session (rest day) handling and `D-EVAL` `OD8` alignment:**
  - Under `D-EVAL` criterion `C3` (`OD8`), a flag-input source that is `missing`, `unavailable`, or `invalid` on ≥ 3 block dates makes `C3` *inconclusive*.
  - Calling `evaluateInjuryConstraintTouchesSession(constraints, observedOn, null)` directly when no session is planned returns `state: 'missing', reasonCode: 'no_session'`, which would misclassify every rest day as a missing-input blind date and make any normal training block with ≥ 3 rest days fail `OD8`.
  - Therefore, when plan and occurrence sources are readable and confirm **zero** planned/scheduled sessions on `observedOn`, capture persists a single date-level evaluation for `injury_constraint_touches_session` (`sessionRef` omitted) with `active: false`, `state: 'not_applicable'`, `reasonCode: 'no_planned_session'`, and structured `inputs` recording `planned_sessions_count: 0` (`state: 'measured'`) plus `injury_constraints_count` from `TrainingSettings.injuries`.
  - When one or more sessions are planned on `observedOn`, capture persists one evaluation per discovered `sessionRef` using `evaluateInjuryConstraintTouchesSession(constraints, observedOn, { sessionRef, session: definition })`.

### 4. App lifecycle trigger points
- Invoke `flagCaptureService.captureForDate(userId, getCurrentActivityDate())` from:
  - Authenticated initialization and `loadDecisionInput` in `app/src/App.tsx`, executed in an independent path (`try / finally` alongside `composeDailyDecisionInput`) so a recommendation-composition failure never skips flag capture.
  - User-initiated mutations that alter same-day flag inputs: check-in save (`DailyCheckinForm`), active external plan import/activation or placement save (`PlanView`), manual session scheduling/cancellation, and `TrainingSettings` save (`TrainingSettings` component, which currently persists settings without triggering `loadDecisionInput`).
- Capture errors are caught, logged with sanitized error codes, and surfaced only as non-blocking telemetry/state; they never break app rendering.

### 5. Firestore security rules and expression budget
- Add `match /users/{userId}/flag_evaluations/{revisionId}` in modular rules under `app/rules/` (and regenerate `app/firestore.rules` via `npm run rules:build`, verified by `app/scripts/check-firestore-rules-drift.mjs`):
  - `allow read: if isOwner(userId);`
  - `allow create: if isOwner(userId) && hasValidFlagEvaluationRevision(userId, revisionId);`
  - `allow update, delete: if false;`
- Keep `hasValidFlagEvaluationRevision` within Firestore's 1,000-expression budget by validating top-level key whitelist (`hasOnly`), `schemaVersion == 1`, `userId == request.auth.uid`, `revisionId == request.resource.data.revisionId`, `isValidActivityDate(data.observedOn)`, `isValidIsoTimestamp(data.evaluatedAt)`, `data.id in ['recovery_beyond_baseline', 'illness_risk_symptom', 'illness_anomaly', 'injury_constraint_touches_session']`, `data.state` in `LEDGER_STATES`, `data.active == null || data.active is bool`, bounded strings (`definitionVersion`, optional `sessionRef`, `reasonCode`, `baselineWindow`), and shallow `data.inputs is list && data.inputs.size() <= 16`. Deep per-input `LedgerValue` validation is enforced at the TypeScript persistence parser boundary (matching `hasValidExternalPlanRevision` and `hasValidHealthAnomalyRevision`).

## Release boundary (`illness_anomaly` / HA7 `#641`)
- `#641` (`HA7`) is not released (`DEFAULT_HEALTH_ANOMALY_RUNTIME_MODE` remains `'shadow'`).
- Do **not** read `users/{uid}/health_anomaly_assessments` shadow records into the user-facing export or enable `'visible'` / `'tighten'` runtime modes.
- During both capture and export, `illness_anomaly` is emitted as withheld by release gate:
  - `active: null`
  - `state: 'not_yet_supported'` (not `'missing'` or `'unavailable'`, so unreleased HA7 does not trigger `OD8` blind-date counts against `C3`)
  - `reasonCode: 'ha7_release_gate_unmet'`
  - `definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION` (`'illness_anomaly-v1'`)
  - `threshold: 'Withheld until the HA7 release gate is met'`
  - `inputs: [{ name: 'ha7_release_gate', value: { value: 'unmet', unit: 'gate', observedAt: null, source: 'health_anomaly_assessment', state: 'not_yet_supported' } }]`
- The remaining three flags (`recovery_beyond_baseline`, `illness_risk_symptom`, `injury_constraint_touches_session`) run their landed pure evaluators directly.

## Export and derivations (`#1165`)

### 1. `SOURCE_KEYS` inventory and bounded `flag_evaluations` read
- Add `'flag_evaluations'` to `SOURCE_KEYS` in `app/src/ledger/export/inputs.ts` (updating the closed source inventory from 21 to 22 entries) and `LedgerExportRecords.flagEvaluations`.
- In `LedgerExportService.build` (`app/src/services/ledgerExportService.ts`), read `users/{userId}/flag_evaluations` where `observedOn >= window.startDate && observedOn <= window.endDate`, ordered deterministically by `observedOn asc, __name__ asc`, using bounded pagination (`PAGE_SIZE = 200`, `MAX_SCANNED_FLAG_EVALUATIONS = 2000` with a `+ 1` truncation sentinel, mirroring `PLACEMENT_HISTORY_MAX_SCANNED_EVENTS` in `app/src/ledger/placementHistory.ts`).
  - If the query fails or exceeds `MAX_SCANNED_FLAG_EVALUATIONS`, mark `sources.flag_evaluations` as `state: 'unavailable'` (with `reason: 'read_failed'` or `'scan_limit_exceeded'`) and discard partial results so truncated history is never silently exported as complete.
  - If any stored document fails `parsePersistedFlagEvaluation`, mark `sources.flag_evaluations` as `state: 'invalid'` (`reason: 'corrupt_record'`).

### 2. Windowed per-date `buildFlags` semantics
- Replace the placeholder single-date fallback in `buildFlags` (`app/src/ledger/export/buildLedgerExport.ts`) with full window coverage across every calendar date `d` in `[context.window.startDate, context.window.endDate]` (generated via `addDaysToLocalDateString`) and every `id` in `LEDGER_FLAG_IDS`:
  - **When `sources.flag_evaluations` is `'unavailable'` or `'invalid'`:** Emit one date-scoped entry per `(d, id)` with `observedOn: d`, `evaluatedAt: null`, `active: null`, `state: sourceState` (`'unavailable'` or `'invalid'`), `reasonCode: 'flag_evaluations_source_' + sourceState`, preserving explicit source failure across the window.
  - **When `sources.flag_evaluations` is `'measured'`:**
    - If one or more persisted revisions exist for `(d, id)`:
      - Group by `sessionRef ?? ''`. Within each `(d, id, sessionRef ?? '')` group, export all persisted revisions in deterministic order (`observedOn`, `id`, `sessionRef ?? ''`, `evaluatedAt`, `revisionId`) so same-day input transitions remain auditable, or if identical `idempotencyKey` duplicates exist, deduplicate by `revisionId`.
    - If **zero** persisted revisions exist for `(d, id)`:
      - For `illness_anomaly` while HA7 is unreleased, emit the deterministic HA7-withheld record (`state: 'not_yet_supported'`, `reasonCode: 'ha7_release_gate_unmet'`) if capture did not run on date `d`, or `state: 'not_recorded'` (`reasonCode: 'flag_not_recorded'`) with `inputs` naming the HA7 gate. To keep `not_recorded` semantics uniform across all flags on uncaptured dates, any `(d, id)` with zero persisted revisions emits `observedOn: d`, `evaluatedAt: null`, `active: null`, `state: 'not_recorded'`, `reasonCode: 'flag_not_recorded'`, `definitionVersion` from the corresponding evaluator constant, and `inputs: []`.
- Never retroactively evaluate past dates `d < today` using today's `TrainingSettings.injuries`, check-in, or plan state at export time.

### 3. Layer 2 (`derived`) baselines and 28-day history window
- **Extend `LedgerExportService` check-in read window for baseline computation:**
  - `computeSubjectiveBaseline` (`app/src/derived/baselines/subjectiveBaseline.ts`, `REFERENCE_SUBJECTIVE_BASELINE_POLICY`) requires up to 28 prior days `[asOfDate - 28, asOfDate)` with `minLongRecordedDays: 10` and `minRecentRecordedDays: 4`.
  - Because `morning` exports have a 2-day `context.window` and `planning` exports have a 14-day `context.window`, reading check-ins only for `window.startDate..through` starves `computeSubjectiveBaseline` on every `morning` and `planning` export.
  - Update `LedgerExportService.build` to read `daily_subjective_checkins` over `min(window.startDate, addDaysToLocalDateString(request.asOfDate, -28))` through `through`. `buildFacts` (`app/src/ledger/export/buildFacts.ts`) already filters `facts.checkins` to `inBounds(row.date, bounds)` (`context.window`), so `facts.checkins` stays strictly windowed while `buildDerived` receives the full 28-day prior check-in slice.
- **Concrete Layer 2 (`derived`) schema and metric representation:**
  - Expand `DERIVED_METRIC_IDS` and `DerivedMetric` in `app/src/ledger/export/schema.ts` (and regenerate `app/src/ledger/export/ledgerExport.schema.json` via `UPDATE_LEDGER_SCHEMA=1` + update `renderLedgerExport.ts` / `renderLedgerExport.golden.md`):
    - Add `'subjective_baselines'` to `DERIVED_METRIC_IDS` alongside `'biometric_baselines'`, `'d_minus_1_step_normalization'`, and `'rolling_performed_training_load'`, **or** widen `DerivedMetric` to carry a structured `metrics?: Record<string, LedgerValue<number>>` map alongside top-level `value: LedgerValue<number>` so each sub-metric has its own explicit `unit`, `state`, `observedAt`, and `source`:
      - **`biometric_baselines`:** Populated from the `asOfDate` validated `DailyRecoverySnapshot.derived` (`sleepScore7dAvg`, `sleepScore28dAvg`, `sleepScore28dStdev`, `restingHr7dAvg`, `restingHr28dAvg`, `restingHr28dStdev`, `hrv7dAvg`, `hrv28dAvg`, `hrv28dStdev`, `respiration7dAvg`, `respiration28dAvg`, `respiration28dMad`, gated by `dataQuality.baseline7dReady` / `baseline28dReady`). When `daily_recovery_snapshots` source state is `'unavailable'` or `'invalid'`, propagate that state; when no `asOfDate` snapshot exists, emit `state: 'missing'`; when a snapshot exists but `baseline7dReady` / `baseline28dReady` is `false` or a sub-metric is absent, mark that metric `'missing'` (insufficient baseline readiness) rather than `0`.
      - **`subjective_baselines`:** Computed via `computeSubjectiveBaseline(checkins, context.asOfDate, REFERENCE_SUBJECTIVE_BASELINE_POLICY)` over `[asOfDate - 28d, asOfDate)`. Exports `recentAvg`, `longAvg`, `variability`, `recentRecordedDays`, and `longRecordedDays` for each of the six subjective metrics (`readiness`, `sleepQuality`, `fatigue`, `soreness`, `mentalStress`, `motivation` on the recorded 1–10 scale). When `daily_subjective_checkins` source state is `'unavailable'` or `'invalid'`, propagate that state; when `metric.state === 'insufficient_history'`, map to `LedgerState` `'missing'` with explicit window counts in `metrics`.
      - **`d_minus_1_step_normalization` and `rolling_performed_training_load`:** Remain `state: 'not_yet_supported'` (`value: null`) until `#1166` extracts their pure derivations into `app/src/derived/`.
  - Note on `multisourceBaselines.ts`: `computeSourceMetricBaseline` in `app/src/derived/baselines/multisourceBaselines.ts` operates on `HealthObservationDayBundle` + `EffectiveBundleIdentityProjection` (`ADR-0028` / `PI5`), which are default-off and not part of `SOURCE_KEYS`. Layer 2 biometric baselines therefore use the validated `DailyRecoverySnapshot.derived` series already read by `LedgerExportService`, without activating multisource bundle pipelines.

### 4. Architectural boundary
- `app/src/ledger/` imports only pure types/evaluators from `app/src/derived/` (`computeSubjectiveBaseline`, `REFERENCE_SUBJECTIVE_BASELINE_POLICY`, flag `DEFINITION_VERSION` / `RULE` constants) and never imports from `app/src/engine/` or `app/src/services/` (enforced by `app/src/ledger/models.architecture.test.ts` and `app/src/derived/derived.architecture.test.ts`).
- `app/src/services/flagCaptureService.ts` and `app/src/services/ledgerExportService.ts` own all Firestore reads/writes and orchestrate the pure evaluators and export builders.

## Verification and delivery
- **Unit & contract tests (`vitest`):**
  - `flagEvaluationPersistence.test.ts` and `flagCaptureService.test.ts`: prove deterministic `revisionId` / `idempotencyKey` generation, idempotent retries on unchanged inputs, new revision creation when check-in / injuries / sessions / `definitionVersion` change, backing-source `'unavailable'` / `'invalid'` propagation (never conflated with `'missing'`), external-plan + manual-occurrence session discovery and deduplication, rest-day `injury_constraint_touches_session` (`state: 'not_applicable', reasonCode: 'no_planned_session'`), and HA7 withholding (`state: 'not_yet_supported', reasonCode: 'ha7_release_gate_unmet'`).
  - `buildLedgerExport.test.ts`, `ledgerExportContract.test.ts`, `ledgerExportBounds.test.ts`, `ledgerExportHardening.test.ts`, and `ledgerExportService.test.ts`: prove full-window per-date flag emission, `not_recorded` vs `unavailable` / `invalid` source state propagation, bounded `flag_evaluations` pagination and truncation handling, 28-day prior check-in query for `subjective_baselines` on `morning`/`planning` exports while keeping `facts.checkins` windowed, `biometric_baselines` readiness mapping, and schema/golden parity (`UPDATE_LEDGER_SCHEMA=1`).
- **Firestore rules emulator tests (`npm run test:rules`):**
  - Prove owner-only `read` and `create` on `users/{uid}/flag_evaluations/{revisionId}`, cross-account read/write rejection, `update` and `delete` denial (`if false`), and rejection of malformed dates, unknown flag IDs, invalid states, or oversized `inputs`.
- **Browser export E2E (`playwright`):**
  - Prove the user-facing **Export ledger (JSON)** download includes captured `flags` and computed `derived` baselines, preserves `not_recorded` / `not_yet_supported` missingness honestly, and strips account identity (`userId`, `email`, raw document paths) on desktop and mobile viewports.
- **Repository gates:**
  - Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run rules:check`, `python scripts/repository_hygiene.py`, `make verify`, and simulation baseline equality (`D-ENGINE` freeze proof).
  - Run diff-first correctness and scoped security review before opening a single PR linking `#1165` and `#1153`. Do not switch off the engine (`#1167`) or waive device acceptance.

## Implementation record (2026-10-28)

All four work items are implemented on `codex/1165-1153-ledger-flags`; merge and deployment
remain pending. `make verify` passed in 309 seconds: 9,935 frontend unit tests, both
Firestore-rule shards, both browser E2E shards, Python checks, builds, registry validators,
simulations and latency gates. The committed simulation baseline is unchanged. Independent
correctness findings were repaired with regressions; the scoped security review found no blocker.

The browser tests exercise actual app-side capture followed by the exported JSON at desktop
and mobile widths. Additional regressions cover legacy imported definitions, strict invalid
header propagation for capture only, abandonment and pinned execution refresh, and chronological
ordering of evaluation instants with explicit UTC offsets. Recovery records retain compared
deltas and bands as well as the source digest. No engine threshold or recommendation changed.
