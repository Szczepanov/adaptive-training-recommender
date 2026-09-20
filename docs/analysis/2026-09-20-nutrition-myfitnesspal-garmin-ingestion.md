# Nutrition and Energy Ingestion Analysis: MyFitnessPal and Garmin Connect — 2026-09-20

## Status and Scope

This analysis investigates the ingestion of dietary nutrition and daily energy expenditure telemetry into the adaptive training recommender. It evaluates the empirical capabilities of Garmin Connect APIs, the MyFitnessPal-to-Garmin integration, direct API pathways, and Android Health Connect.

The proposed architectural decisions are recorded in [ADR-0042](../adr/0042-nutrition-ingestion-provenance-and-decision-authority.md), with phased delivery tracked in [the nutrition ingestion plan](../plans/nutrition-ingestion.md).

---

## Executive Summary

1. **The User Problem**:
   Athletes log daily food intake in MyFitnessPal (MFP). MFP syncs consumed calories into Garmin Connect. Previously, this repository fetched and archived Garmin daily stats but dropped calorie data during canonical mapping, leaving athletes with no visible nutrition history and no automated way to view intake alongside training.

2. **Empirical Findings (Live Account Probe)**:
   - **Garmin Daily Stats (`/usersummary-service/usersummary/daily/...`)**:
     - `consumedKilocalories` (float): contains consumed kcal mirrored into Garmin Connect. In the probed account this corresponded to MyFitnessPal logging, but the payload itself does not certify the upstream origin.
     - `includesCalorieConsumedData` (bool): `True` when food was logged, `False` when no intake was logged.
     - `bmrKilocalories` (float): resting metabolic expenditure (BMR).
     - `activeKilocalories` (float): active energy burned from activity/movement.
     - `totalKilocalories` (float): total daily energy expenditure (`bmr + active`).
   - **Garmin Nutrition Service (`/nutrition-service/food/logs/...`)**:
     - `dailyNutritionContent.calories`: concordant with `consumedKilocalories` in the probe, with at most a 1-kcal rounding difference observed.
     - `mealDetails`: `[]` (empty list). MyFitnessPal does **not** sync individual meal breakdowns or timestamps to Garmin Connect.
     - `loggedFoodsWithServingSizes`: `[]` (empty list). MyFitnessPal does **not** sync individual food items, descriptions, or macronutrient/micronutrient values to Garmin Connect.
   - **Macronutrients & Micronutrients**:
     - Protein, carbohydrate, fat, fiber, sugar, sodium, and vitamins/minerals are **absent** from the Garmin-MFP bridge.
     - Crucial design requirement: Missing macros must remain `null` (unavailable) and never be faked or defaulted to `0g`.

3. **Alternative Pathways Evaluated**:
   - **Direct MyFitnessPal API**: Not used by this implementation; access is partner-controlled rather than a dependable public integration path. Unofficial private scraping is rejected because it is fragile and would expand credential/privacy risk.
   - **Android Health Connect**: Supports `NutritionRecord` with energy and nutrient fields on Android. Server-side ingestion would require an authorized on-device bridge/companion rather than treating Health Connect as a direct cloud API.

4. **Architectural Decisions**:
   - **Domain Separation**: Retain strict separation between *energy expenditure* (watch-measured physical telemetry) and *energy intake* (dietary nutrition logging).
   - **Expenditure**: Add `activeEnergyKcal`, `restingEnergyKcal`, and `totalEnergyExpenditureKcal` to `CanonicalDailyMetrics` and `RawMetrics` in `daily_recovery_snapshots/{date}`.
   - **Intake**: Model nutrition via a dedicated, provider-neutral `NutritionProvider` boundary and persist source-aware bundles in `users/{userId}/nutrition_days/{YYYY-MM-DD}_{provider}_{transport}`.
   - **Provenance & Deduplication**: Distinguish `provider`, `transport`, and `origin`. Prevent double-counting across concurrent bridges (e.g., MFP via Garmin vs MFP via Health Connect) by reconciling on origin identity.
   - **Decision Authority**: Nutrition and energy expenditure remain strictly **retrospective and observational** in v1. They do not alter readiness scores, fatigue modeling, volume targets, or session selection.

---

## 1. Problem Statement & Context

ADR-0039 addressed longitudinal body composition (scale weight, scale body fat percentage, protocol tape measurements, and subjective hunger). It explicitly listed calorie and macronutrient tracking as a non-goal to protect that design from unbounded scope creep and to prevent pseudoscientific energy availability calculations from incomplete data.

However, athletes who already track their food in MyFitnessPal expect the application to surface their logged intake without requiring manual duplicate transcription. We must establish a clean, provider-neutral architecture for nutrition that preserves source provenance, handles missing data honestly, safeguards personal privacy, and maintains the strict observation-only boundary.

---

## 2. Current Codebase Behavior & Tracing

### 2.1 Trace of Candidate Fields Through Pipeline

| Field | Garmin API Response | Canonical Model (`canonical.py`) | Mapper (`mapper.py`) | Persisted Snapshot (`models.py`) | Firestore (`daily_recovery_snapshots`) | Engine / Context Brief |
|---|---|---|---|---|---|---|
| `consumedKilocalories` | Fetched in `stats_today` | **Dropped** | Not mapped | Not present | Not stored | Not read |
| `includesCalorieConsumedData` | Fetched in `stats_today` | **Dropped** | Not mapped | Not present | Not stored | Not read |
| `bmrKilocalories` | Fetched in `stats_today` | **Dropped** | Not mapped | Not present | Not stored | Not read |
| `activeKilocalories` | Fetched in `stats_today` | **Dropped** | Not mapped | Not present | Not stored | Not read |
| `totalKilocalories` | Fetched in `stats_today` | **Dropped** | Not mapped | Not present | Not stored | Not read |
| `protein` | Not returned by Garmin | N/A | N/A | N/A | N/A | N/A |
| `carbohydrate` | Not returned by Garmin | N/A | N/A | N/A | N/A | N/A |
| `fat` | Not returned by Garmin | N/A | N/A | N/A | N/A | N/A |
| `fiber`, `micronutrients` | Not returned by Garmin | N/A | N/A | N/A | N/A | N/A |
| `mealDetails` | `[]` in `food_log` | N/A | N/A | N/A | N/A | N/A |
| `loggedFoods` | `[]` in `food_log` | N/A | N/A | N/A | N/A | N/A |

### 2.2 Finding
The raw stats payload has always contained total, active, BMR, and consumed kilocalories, and has been saved to the immutable raw archive when archiving is enabled (`raw/garmin/stats/...`). However, `canonicalize_from_raw()` in `garmin_provider.py` extracted only RHR, steps, and waking Body Battery, dropping all calorie fields.

---

## 3. Investigation of Garmin Calorie & Nutrition APIs

The repository pins `garminconnect==0.3.15`. Upstream exposes five candidate methods:

1. `get_stats(cdate: str) -> dict[str, Any]` (wrapper around `get_user_summary(cdate)`):
   - Endpoint: `/usersummary-service/usersummary/daily/<displayName>?calendarDate=YYYY-MM-DD`
   - Returns daily summary metrics including steps, RHR, stress, and calories.
   - Units: Kilocalories (kcal).
   - Rate limit: Zero additional requests because this endpoint is already fetched for daily sync.

2. `get_calories_daily(start: str, end: str) -> list[dict[str, Any]]`:
   - Endpoint: `/userstats-service/wellness/daily/<displayName>?fromDate=...&untilDate=...&metricId=[22, 23]`
   - Returns active (metric 22) and resting (metric 23) calories over a date range.
   - Note: Only provides expenditure, not intake.

3. `get_nutrition_daily_food_log(cdate: str) -> dict[str, Any]`:
   - Endpoint: `/nutrition-service/food/logs/YYYY-MM-DD`
   - Returns timeline view, daily goals, and daily content summary.
   - When food is logged: `dailyNutritionContent.calories` matches `consumedKilocalories`.
   - When no food is logged: `dailyNutritionContent` is omitted entirely.

4. `get_nutrition_daily_meals(cdate: str) -> dict[str, Any]`:
   - Endpoint: `/nutrition-service/meals/YYYY-MM-DD`
   - Returns `{"meals": [], "dailyViewType": "MEALS_VIEW"}` for MFP-connected accounts.

5. `get_nutrition_daily_settings(cdate: str) -> dict[str, Any]`:
   - Endpoint: `/nutrition-service/settings/YYYY-MM-DD`
   - Returns `{}` for MFP-connected accounts.

---

## 4. Empirical Capability Probe Evidence

A live capability probe was run against a linked Garmin account. Because this repository is public, exact dates and personal intake/expenditure values are intentionally **not** retained in source control.

The probe established the following schema-level facts:

- On logged-food days, daily stats exposed a numeric `consumedKilocalories` value with `includesCalorieConsumedData = True`.
- On an unlogged historical day, `consumedKilocalories` was absent/`None` and `includesCalorieConsumedData = False`.
- `bmrKilocalories`, `activeKilocalories`, and `totalKilocalories` were present as expenditure estimates, with total equal to resting plus active in the sampled responses.
- The dedicated food-log endpoint's calorie total was concordant with daily stats; one sampled response differed by 1 kcal due to provider-side rounding.
- For the observed MyFitnessPal-to-Garmin bridge, `mealDetails` and `loggedFoodsWithServingSizes` were empty and no macro/micronutrient values were exposed.
- Garmin's payload did not identify MyFitnessPal (or another upstream application) by name, so `origin` must remain `null` unless a future provider supplies certified provenance.

### Empirical Conclusions
1. Daily stats are sufficient for v1 intake calories, logging status, goal calories, and expenditure, so normal sync/backfill can reuse the already-cached stats payload with **zero additional nutrition-service requests**.
2. Missingness must use the explicit provider flag rather than inferring from a numeric fallback; a true logged zero remains distinct from an unlogged day.
3. Macronutrients remain unavailable for the **observed MFP-via-Garmin bridge** and must be represented as `null`, not zero.
4. Exact live-account nutrition values belong in transient diagnostics, not public docs, production-derived test fixtures, logs, or PR descriptions.

---

## 5. MyFitnessPal Integration Pathways

### Pathway A: MyFitnessPal → Garmin Connect → Recommender (Current)
- **Feasibility**: High (already functioning).
- **Available Data**: Consumed energy intake (kcal), calorie goal, adjusted goal.
- **Missing Data**: Protein, carbohydrate, fat, fiber, micronutrients, meal timestamps.
- **Reliability**: Automatic mirroring was observed in the capability probe; long-term reliability was not independently quantified.

### Pathway B: Direct MyFitnessPal API
- **Feasibility**: Infeasible. The MyFitnessPal API is strictly partner-only and closed to new developers.
- **Scraping / Reverse Engineering**: Rejected. Storing user credentials in plaintext or using reverse-engineered tokens violates repository security principles, breaks easily, and poses privacy risks.

### Pathway C: MyFitnessPal → Android Health Connect → Recommender
- **Feasibility**: Medium (future work).
- **Available Data**: MyFitnessPal on Android writes calories, protein, carbs, and fat to Android Health Connect.
- **Constraint**: Android Health Connect is an on-device Android API. Google Health API v4 (server-to-server) does not currently syndicate third-party Health Connect nutrition records to cloud endpoints without an authorized on-device companion app.
- **Architectural Implication**: Our canonical nutrition schema and deduplication model must be designed so that when an Android Health Connect transport is introduced, it plugs in seamlessly alongside the Garmin transport.

---

## 6. Architecture & Data Model

### 6.1 Energy Expenditure vs Energy Intake Separation
We strictly avoid a generic `calories` field.
- **Energy Expenditure**:
  - `restingEnergyKcal`: Basal Metabolic Rate estimated by Garmin.
  - `activeEnergyKcal`: Energy expended through movement and workouts.
  - `totalEnergyExpenditureKcal`: Combined total daily expenditure.
  - Represented in `CanonicalDailyMetrics` and `RawMetrics` in `daily_recovery_snapshots/{date}`.
- **Energy Intake**:
  - `energyIntakeKcal`: Total consumed dietary energy.
  - `proteinG`, `carbohydrateG`, `fatG`, `fiberG`, `sugarG`: Dietary macronutrients (typed as `float | null`).
  - Represented in `CanonicalNutritionDay` and persisted in `users/{userId}/nutrition_days/{date}_{provider}_{transport}`.

### 6.2 Provenance & Deduplication Model
Each nutrition observation day document carries an explicit source descriptor:
```python
@dataclass(frozen=True)
class NutritionSource:
    provider: str  # e.g., "garmin"
    transport: str  # e.g., "garmin_connect"
    origin: str | None  # e.g., "myfitnesspal", or None when unconfirmed by provider payload
    source_record_id: str | None
```

**Deduplication Policy**:
If multiple nutrition records exist for the same date (e.g., `2026-09-19_garmin_garmin_connect` and `2026-09-19_health_connect_health_connect`):
1. Records are grouped by `origin` (e.g., `myfitnesspal`).
2. If two records represent the same origin, they **must never be summed**.
3. The reconciliation layer selects the highest-fidelity record (e.g., the record containing macronutrient values over a calorie-only record).
4. If fidelity is equal, the most recently updated record is selected.

### 6.3 Data Quality & Completeness
- `hasIntakeData: boolean`: True only when calories or food were explicitly logged.
- `isPartial: boolean`: True for the current calendar day (`today`), indicating logging may be incomplete. False for past completed days.
- `Missing != 0`: When protein is absent, `proteinG` is `null`. The UI renders `N/A`, never `0g`.

---

## 7. Privacy & Security Review

Dietary data is sensitive personal health information.
1. **Firestore Isolation**: Stored exclusively under `users/{userId}/nutrition_days/{daySourceId}` with security rules granting read access solely to the authenticated owner. Writes are server-only.
2. **Telemetry Sanitization**: No calorie or macro values may be emitted into Sentry, error logs, or general analytics. Error messages refer only to dates and provider codes.
3. **Payload Archiving**: While the current MFP payload contains no food descriptions, future food logs might. The archiver strips or redacts raw meal descriptions before persistence to ensure no sensitive food choices are stored in permanent cold archives.

---

## 8. Recommendation Authority: Observation First

ADR-0039 established that body composition and fueling signals must not have recommendation authority without explicit, prospective clinical and algorithmic evidence.

In this initial release (ADR-0042):
- Nutrition is strictly **retrospective and observational**.
- No energy availability or RED-S diagnosis is computed.
- The engine does not subtract Garmin burned calories from consumed calories to calculate an energy deficit.
- Low intake does not automatically downgrade or cancel training recommendations.
- Engine isolation tests verify that zero engine files import nutrition models.
- Replay tests verify that recommendation outputs remain bitwise identical regardless of nutrition inputs.

---

## 9. Concrete Recommendations

1. Implement `active_energy_kcal`, `resting_energy_kcal`, and `total_energy_expenditure_kcal` in `CanonicalDailyMetrics` and `RawMetrics`.
2. Define `NutritionProvider` protocol and `CanonicalNutritionDay` in backend.
3. Implement `fetch_daily_nutrition` in `GarminProviderAdapter`, extracting consumed calories from cached daily stats and enriching with food log data.
4. Persist nutrition day bundles to Firestore collection `nutrition_days` using `{date}_{provider}_{transport}` keys.
5. Create a dedicated Nutrition panel in the frontend Data screen showing intake, expenditure, source provenance, and clear indicators for missing macros.
6. Provide a safe CLI capability probe (`probe-nutrition`) to verify account status without printing secrets or personal food text.
