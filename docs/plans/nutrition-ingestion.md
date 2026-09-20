# Nutrition Ingestion — Implementation Plan

**Status:** Completed
**Blocked by:** none — [ADR-0042](../adr/0042-nutrition-ingestion-provenance-and-decision-authority.md) is Accepted
**Unlocks:** Ingestion of MyFitnessPal consumed calories via Garmin Connect, watch-based energy expenditure metrics (BMR, active, total kcal), provider-neutral nutrition persistence, multi-source deduplication, and retrospective nutrition visualization in the Data view.
**Source analysis:** [2026-09-20 nutrition analysis](../analysis/2026-09-20-nutrition-myfitnesspal-garmin-ingestion.md)

---

## Stages Overview

- **N0: Contracts, Domain Models, and ADR** — Canonical representations, provider capabilities, and architecture decision records.
- **N1: Garmin Energy Expenditure Ingestion** — Extract BMR, active, and total calories from Garmin daily stats into `CanonicalDailyMetrics` and `RawMetrics`.
- **N2: Garmin Nutrition Ingestion** — Implement `fetch_daily_nutrition` from the already-cached Garmin daily-stats payload, extracting consumed kcal, goal kcal, and intake status without an extra per-day nutrition request.
- **N3: Persistence, Provenance, and Security Rules** — User-scoped Firestore collection `nutrition_days` with `{date}_{provider}_{transport}` keys and security rules.
- **N4: Multi-Source Deduplication & Frontend Models** — TypeScript domain models, reconciliation logic preventing double counting, and Firestore nutrition service.
- **N5: Frontend Nutrition Surface** — Retrospective Nutrition panel in the Data view with energy intake, expenditure, provenance, and missing-macro indicators.
- **N6: Safe Diagnostic CLI & Archival Privacy** — `probe-nutrition` CLI command plus aggregate-only routine archival; food-item/meal-detail payloads are never archived by normal sync.
- **N7: Verification, Isolation Tests, and Review** — Engine isolation tests, recommendation invariance tests, full test suites, subagent review, and PR creation.

---

## Detailed Stages & Acceptance Criteria

### N0: Contracts, Domain Models, and ADR
- [x] Create analysis document `docs/analysis/2026-09-20-nutrition-myfitnesspal-garmin-ingestion.md`.
- [x] Create ADR `docs/adr/0042-nutrition-ingestion-provenance-and-decision-authority.md`.
- [x] Define `NutritionSource` and `CanonicalNutritionDay` in `src/garmin_sync/canonical.py`.
- [x] Define `ProviderCapabilities.nutrition` and `NutritionProvider` protocol in `src/garmin_sync/provider.py`.

### N1: Garmin Energy Expenditure Ingestion
- [x] Add `active_energy_kcal`, `resting_energy_kcal`, and `total_energy_expenditure_kcal` to `CanonicalDailyMetrics` in `src/garmin_sync/canonical.py`.
- [x] Update `canonicalize_from_raw()` in `src/garmin_sync/garmin_provider.py` to extract `bmrKilocalories`, `activeKilocalories`, and `totalKilocalories`.
- [x] Add `activeEnergyKcal`, `restingEnergyKcal`, and `totalEnergyExpenditureKcal` to `RawMetrics` in `src/garmin_sync/models.py`.
- [x] Add `energyExpenditure` to `MetricDates` in `src/garmin_sync/models.py`.
- [x] Update `mapper.py` to forward energy expenditure fields into `DailyRecoverySnapshot.raw`.
- [x] Add unit tests for expenditure extraction and mapping.

### N2: Garmin Nutrition Ingestion
- [x] Add `get_nutrition_daily_food_log(cdate)` and `get_nutrition_daily_meals(cdate)` to `GarminDataClient` Protocol and `GarminClientWrapper` in `src/garmin_sync/garmin_client.py`.
- [x] Implement `fetch_daily_nutrition(target_date_iso)` in `GarminProviderAdapter` from the cached daily-stats payload; dedicated nutrition-service endpoints remain diagnostic-only so sync/backfill adds no per-day API request.
- [x] Ensure missing macros remain `None` (never 0).
- [x] Mark `has_intake_data = True` when `includesCalorieConsumedData == True`, and `False` otherwise.
- [x] Mark `is_partial = True` for `local_today()` and `False` for completed historical dates.
- [x] Add unit tests for `fetch_daily_nutrition` with valid, empty, and unlogged responses.

### N3: Persistence, Provenance, and Security Rules
- [x] Define `NutritionDayDTO` in `src/garmin_sync/models.py`.
- [x] Add `save_nutrition_day()`, `get_nutrition_day()`, and `get_nutrition_days_in_range()` to `FirestoreRecoveryRepository` in `src/garmin_sync/firestore_repository.py`.
- [x] Integrate nutrition syncing and backfill into `GarminSyncService` in `src/garmin_sync/service.py`.
- [x] Add Firestore security rules in `app/firestore.rules` for `/users/{userId}/nutrition_days/{daySourceId}`: owner read-only, server-managed writes.
- [x] Add tests verifying true no-op replay idempotency (no revision/`ingestedAt` churn), changed-payload revision increments, range queries, and repository error handling.

### N4: Multi-Source Deduplication & Frontend Models
- [x] Create `app/src/nutrition/models.ts` defining `NutritionDay`, `NutritionSource`, and `ReconciledNutritionDay`.
- [x] Create `app/src/nutrition/reconciliation.ts` with macro-completeness-first deduplication for certified origins; unknown origins remain distinct by provider+transport and no intake sources are summed.
- [x] Create `app/src/nutrition/nutritionService.ts` for reading `nutrition_days` from Firestore.
- [x] Add unit tests in `app/src/nutrition/__tests__/reconciliation.test.ts`.

### N5: Frontend Nutrition Surface
- [x] Add `activeEnergyKcal`, `restingEnergyKcal`, and `totalEnergyExpenditureKcal` to `RawMetrics` in `app/src/engine/models.ts`.
- [x] Create `app/src/components/nutrition/NutritionPanel.tsx` and `.css` rendering:
  - Consumed energy intake (kcal) with partial-day badges.
  - Active and resting energy expenditure.
  - Source provenance (provider, transport, sync status).
  - Explicit visual indicator for unavailable macros ("Not provided by this sync source").
- [x] Add `'nutrition'` tab to `DataView.tsx` in `app/src/components/DataView.tsx`.
- [x] Add component tests for `NutritionPanel` with complete intake, unlogged days, and partial days.

### N6: Safe Diagnostic CLI & Archival Privacy
- [x] Implement `probe_nutrition` CLI command in `src/garmin_sync/cli.py` to inspect nutrition and expenditure capabilities safely without leaking tokens or personal food text.
- [x] Keep routine nutrition archival aggregate-only (daily-stats intake flag/value/goal); do not fetch or archive food names, meal descriptions, or serving details.
- [x] Add tests for probe output formatting and archival sanitization.

### N7: Verification, Isolation Tests, and Review
- [x] Add architecture test `app/src/nutrition/__tests__/engineIsolation.test.ts` proving zero engine imports of nutrition.
- [x] Add recommendation invariance test proving identical outputs regardless of nutrition data.
- [x] Run full backend checks: `ruff check`, `ruff format --check`, `mypy src/garmin_sync`, `pytest`.
- [x] Run full frontend checks: `tsc -b`, `eslint`, `vitest run`, `validate:knowledge`, `validate:workouts`.
- [x] Run `make simulate`, `npm run simulate:plan-judge`, `node scripts/check-policy-drift.mjs`, `npm run test:rules`, `npm audit`, `uv lock --check`, `uvx pip-audit`, `npm run build:bundle` — all clean.
- [x] Invoke dedicated code-reviewer subagent and address all material findings.
- [x] Check git diff, push branch, and create GitHub PR.

#### Code review findings (2026-09-20) and disposition
| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | `engineIsolation.test.ts` used a non-recursive `readdirSync`, silently skipping `engine/analytics/`, `engine/simulation/`, `engine/testing/`, `engine/tests/` — the isolation guarantee wasn't actually enforced for those subdirectories. | Fixed: walk recursive. |
| 2 | HIGH | `nutritionRecommendationInvariance.test.ts` computed `reconcileDailyNutrition` but never threaded the result into `evaluateTraining`'s input — the test passed even if the engine *did* consume nutrition, because it was never given any. | Fixed: rewrote against the real `mapSnapshotToEngineInput` boundary (the actual `DailyRecoverySnapshot` → `EngineObjectiveInput` translation), asserting byte-identical objective input and identical end-to-end recommendations across null/typical/extreme energy-expenditure values. |
| 3 | MEDIUM | `origin` is always `null` from the real Garmin adapter (Garmin never attributes calories to MyFitnessPal by name), so the MFP-branded UI label and origin-keyed dedup path are untested by real data. | Documented as a known limitation in ADR-0042; not a correctness bug (D-NUT-PROV requires not inventing unverified provenance). |
| 4 | MEDIUM | D-NUT-DEDUP point 4 (distinct non-overlapping origins displayed separately) isn't implemented — the reconciler always collapses to one winner-take-all record. | Documented as a known limitation in ADR-0042 with an explicit trigger (implement before/when a second real provider exists). No double-counting risk today — verified nothing is summed. |
| 5 | MEDIUM | No test distinguished a real "0 kcal logged" day from an "unlogged" day, the single most safety-critical missingness case per D-NUT-MISSING. | Fixed: added `test_garmin_provider_adapter_fetch_daily_nutrition_zero_kcal_logged` asserting `energy_intake_kcal == 0.0` and `has_intake_data is True`, distinct from the unlogged case. |
| 6 | LOW | `hasIntakeData`/`has_intake_data` defaulted to `True` on both DTOs — an inverted, unsafe default for a future caller that forgets to pass it explicitly. | Fixed: flipped default to `False` in `models.py` and `canonical.py`. |
| 7 | LOW | `probe_nutrition` reaches into `GarminProviderAdapter._get_stats` (a private method) from `cli.py`. | Left as-is: diagnostic-only CLI code, not a correctness/security issue, and the adapter's public surface intentionally stays narrow; a public accessor purely for a probe command isn't worth the API surface increase. |

### Additional deep-review fixes (2026-09-20)

- **Privacy:** removed exact live-account intake/expenditure examples from public documentation and production-derived fixtures; capability evidence is schema-level/redacted.
- **Provenance:** preserve `origin = null` end-to-end when Garmin does not certify the upstream logging app; never substitute the provider name for unknown origin.
- **Idempotency:** identical nutrition replays are no-ops and do not churn revision/ingestion timestamps; changed content increments revision transactionally.
- **API pressure:** routine sync/backfill reuses cached daily stats and does not call the nutrition food-log endpoint per day.
- **Dedup fidelity:** macro-complete mirrors outrank calories-only records before transport/confidence tie-breakers; unknown origins are not cross-transport deduplicated.
- **UI date semantics:** historical `asOfDate` values are no longer mislabeled as Today/partial.
- **CI regression:** NutritionPanel formatting assertion follows the rendered localized `2,150 kcal` output.
