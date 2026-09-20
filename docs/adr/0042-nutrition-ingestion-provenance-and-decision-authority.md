# ADR-0042: Nutrition Ingestion, Provenance, and Decision Authority

* **Status:** Accepted
* **Date:** 2026-09-20
* **Deciders:** Repository owner
* **Source analysis:** [Nutrition and Energy Ingestion Analysis: MyFitnessPal and Garmin Connect](../analysis/2026-09-20-nutrition-myfitnesspal-garmin-ingestion.md)
* **Implementation plan:** [Nutrition Ingestion](../plans/nutrition-ingestion.md)

---

## Context and Problem Statement

Athletes logging meals in MyFitnessPal currently sync consumed calories into Garmin Connect. Previously, the application fetched and archived Garmin daily stats but dropped all calorie and nutrition telemetry during canonical mapping.

ADR-0039 explicitly excluded calorie and macronutrient tracking to prevent scope creep during the longitudinal body composition rollout. This ADR supersedes that non-goal by introducing a provider-neutral nutrition ingestion and persistence architecture, while strictly preserving ADR-0039's principle that unverified or incomplete dietary logs must not exert automated training recommendation authority.

---

## Decision

### D-NUT-SCOPE — Clear Separation of Energy Intake vs Energy Expenditure

The system defines two distinct, non-fungible energy domains:
1. **Energy Expenditure** (`restingEnergyKcal`, `activeEnergyKcal`, `totalEnergyExpenditureKcal`):
   - Wearable telemetry estimated by device sensors and algorithms.
   - Preserved in `CanonicalDailyMetrics` and persisted in `daily_recovery_snapshots/{date}` under `raw`.
2. **Energy Intake** (`energyIntakeKcal`, `proteinG`, `carbohydrateG`, `fatG`, `fiberG`, `sugarG`):
   - Dietary nutrition logged by the athlete.
   - Ingested via a provider-neutral boundary and persisted in a dedicated user-scoped collection.

A generic, unqualified `calories` field is strictly prohibited.

### D-NUT-PROV — Tripartite Provenance Identity

Every nutrition observation day must record:
- **`provider`**: The immediate system providing the data to our application (e.g., `"garmin"`).
- **`transport`**: The communication channel used (e.g., `"garmin_connect"`).
- **`origin`**: The authoritative upstream recording application where the athlete actually logged the food (e.g., `"myfitnesspal"`), or `null` / `"unknown"` if unconfirmed by provider metadata.

We do not invent or hardcode provenance where the upstream provider payload does not explicitly supply or certify it.

### D-NUT-PERSIST — Source-Aware Day Bundles

Nutrition days are persisted at:
```text
users/{userId}/nutrition_days/{YYYY-MM-DD}_{provider}_{transport}
```

This deterministic key structure guarantees:
- Full idempotency on sync and backfill operations.
- Non-destructive coexistence of multiple providers for the same calendar date.
- Safe historical backfill without risking data corruption.

Firestore security rules enforce owner-scoped read-only access for clients; writes are server-only.

### D-NUT-DEDUP — Reconciled Daily View Without Double-Counting

When the frontend or read model queries nutrition for a date range:
1. Records are grouped by `logicalDate`.
2. Where multiple source bundles exist for the same date sharing the same upstream `origin` (e.g., MyFitnessPal data arriving via Garmin Connect and later via Android Health Connect), they **must never be summed**.
3. The reconciliation layer selects the highest-fidelity record: macro completeness first, then transport fidelity and confidence, with the latest update timestamp as a deterministic tie-breaker.
4. If sources have distinct, non-overlapping origins, they must never be blindly summed. The v1 reconciled model still exposes one primary intake per day; displaying multiple distinct origins side-by-side remains a documented follow-up before a second real intake provider is enabled.

### D-NUT-MISSING — Strict Missingness Semantics

Nutrition data is subject to reporting gaps and partial logging.
- When an upstream provider does not provide macronutrients (as with the current Garmin-MFP bridge), the canonical fields (`proteinG`, `carbohydrateG`, etc.) must be `null`, **never `0`**.
- The UI must render `N/A` or "Not provided by sync" rather than displaying `0g`.
- `hasIntakeData: boolean` is `true` only when intake was affirmatively logged (`includesCalorieConsumedData == true`).
- `isPartial: boolean` is `true` for `today` (in Europe/Warsaw timezone), recognizing that the athlete is still consuming food. Completed historical days are marked `isPartial: false`.

### D-NUT-PRIVACY — Sensitive Personal Data Safeguards

- Nutrition day documents store daily aggregates only (`energyIntakeKcal`, macros, goals).
- Individual food descriptions, recipe names, or personal meal notes are omitted from persistent documents and never added to the nutrition raw sidecar.
- Normal ingestion archives only aggregate daily-stats fields already needed for the feature; the dedicated food-log endpoint is not called during routine sync/backfill.
- No dietary or calorie values may appear in Sentry, error telemetry, generic application logs, public documentation, or production-derived test fixtures.

### D-NUT-AUTH — Zero Recommendation Authority (Observation Only)

In v1, nutrition and energy expenditure are **retrospective and observational only**:
- Nutrition does not affect readiness scores, fatigue modeling, volume caps, or session ranking.
- The engine does not compute energy deficits or diagnose Low Energy Availability (LEA) or RED-S.
- Recommendation output must remain identical whether nutrition is missing, low, or high.
- Engine source files must maintain zero imports of the nutrition subsystem, enforced by automated architecture tests.

Any future promotion of nutrition signals to recommendation authority will require:
1. A separate accepted architectural decision.
2. Direct, verified macronutrient and timing ingestion.
3. Registration of formal claims under ADR-0033 with alignment tests.
4. A bump of `POLICY_VERSION`.

### D-NUT-UI — Retrospective Data Screen Integration

Nutrition data is presented within the existing **Data** view:
- Displays consumed energy intake alongside active and resting expenditure.
- Clear visual indicators distinguishing missing data from zero.
- Full provenance transparency (source provider and sync status).
- No new top-level navigation is introduced.

---

## Consequences

### Positive
- Athletes immediately see their MyFitnessPal consumed calories in the app without double logging.
- Garmin energy expenditure (BMR, active, total) is surfaced for rich physiological context.
- Clean provider-neutral foundation allows seamless future addition of direct MyFitnessPal or Health Connect providers.
- Architecture guarantees zero double-counting across concurrent bridges.
- Strict observation-only boundary protects recommendation integrity.

### Negative
- Protein and other macronutrients remain unavailable until an intake source exposing macronutrients (e.g., Health Connect) is connected.
- Adds one user-scoped Firestore collection (`nutrition_days`) and associated server sync logic.

### Known limitations (v1, code-reviewed 2026-09-20)
- **The real Garmin adapter cannot certify the upstream food-logging application.** Its `origin` therefore remains `null` end-to-end. Persistence and the frontend preserve that null rather than replacing it with `"garmin"`, and the UI labels the source as Garmin Connect with an unverified upstream origin. Synthetic tests still exercise known origins (for example, a future Health Connect mirror) so deduplication behavior is ready without claiming provenance the current payload does not contain.
- **Distinct, non-overlapping known origins are not yet displayed side-by-side.** `reconcileDailyNutrition` selects one fidelity-ranked primary intake per date and never sums distinct origins. This is safe against double-counting but can hide a secondary independently logged source. Implement a multi-origin presentation/read model before enabling a second real intake provider.
