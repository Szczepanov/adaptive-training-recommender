# Garmin High-Resolution Telemetry & FIT Data Analysis (2026-08-17)

**Question asked.** What detailed metrics, interval splits, and high-frequency data can be extracted from Garmin Connect (including .FIT-equivalent second-by-second/minute-by-minute streams), and how can this data enrich the Adaptive Training Recommender?

**Key finding.** Manual `.fit` export is not required. The backend Garmin client (`garth` / `garminconnect`) can automatically fetch exact 7-zone power distributions, 5-zone HR distributions, lap-by-lap interval splits with pedaling dynamics, and high-frequency time series directly through Garmin Connect APIs on daily ingestion.

---

## 1. Empirical Findings from Live Activity Probe

A live probe was conducted on the athlete's Garmin Connect profile across recent cycling activities (e.g. Activity `23983392104`, road cycling on 2026-08-15).

### 1.1 Exact Time-in-Zones (Power & Heart Rate)
Garmin computes and exposes exact seconds spent across all metabolic power and cardiovascular zones, via `get_activity_power_in_timezones` and `get_activity_hr_in_timezones` respectively (verified present on the pinned `garminconnect` version):

* **Power Zones (7-Zone Coggan Model)**:
  ```json
  [
    {"zoneNumber": 1, "secsInZone": 2267.97, "zoneLowBoundary": 0},
    {"zoneNumber": 2, "secsInZone": 699.30,  "zoneLowBoundary": 141},
    {"zoneNumber": 3, "secsInZone": 1176.00, "zoneLowBoundary": 189},
    {"zoneNumber": 4, "secsInZone": 770.00,  "zoneLowBoundary": 227},
    {"zoneNumber": 5, "secsInZone": 268.93,  "zoneLowBoundary": 265},
    {"zoneNumber": 6, "secsInZone": 158.32,  "zoneLowBoundary": 306},
    {"zoneNumber": 7, "secsInZone": 198.18,  "zoneLowBoundary": 383}
  ]
  ```
* **Heart Rate Zones (5-Zone)**: Exact seconds in Z1 through Z5 with specific BPM cutoffs (e.g. Z5: 2526.5s > 162 bpm).

### 1.2 Lap & Interval Splits (`lapDTOs`)
Retrieved via `get_activity_splits`. For every lap, auto-lap, or interval press on the bike computer:
* **Power metrics**: `averagePower`, `maxPower`, `normalizedPower` (NP), `minPower`, `averageSeatedPower`, `maxSeatedPower`.
* **Physiological response**: `averageHR`, `maxHR`.
* **Timing & Motion**: `duration`, `movingDuration`, `elapsedDuration`, `distance`, `averageSpeed`, `maxSpeed`.
* **Cycling Dynamics**:
  * Left/Right power phase start & end angles (`leftPowerPhaseStart`, `leftPowerPhaseEnd`).
  * Peak power phase arc lengths and centers (`leftPowerPhasePeakArcLength`, `leftPowerPhasePeakArcCenter`).
  * Platform center offsets (mm).

### 1.3 High-Frequency Time Series (`activityDetailMetrics`)
For a 1-hour session, Garmin Connect returns **1,875+ structured time-series samples** covering:
* `directHeartRate` (BPM)
* `directPower` / `sumAccumulatedPower` (Watts)
* `directCadence` (RPM)
* `directAirTemperature` (°C)
* `sumDistance` (meters) & `sumMovingDuration` (seconds)
* Left/Right platform center offsets

### 1.4 Binary FIT Export
The backend client supports downloading the raw, original binary FIT file via `client.download_activity(activity_id, dl_fmt=ORIGINAL)` for archiving or external tool processing.

---

## 2. Architectural Value for Adaptive Training Engine

Integrating high-resolution telemetry transforms several core areas of the recommendation engine:

| Engine Component | Current Behavior | With High-Resolution Telemetry |
| :--- | :--- | :--- |
| **`completedTraining.ts`** | Scales stimulus by gross session duration and average intensity. | Computes exact fractional stimulus credit from **realized minutes in Z4 (Threshold) / Z5 (VO2 Max)**. |
| **`fatigue.ts`** | Deducts estimated activity steps; calculates systemic load from gross Training Effect. | Incorporates Normalized Power (NP), Variability Index (VI = NP / Avg Power), and anaerobic work ($W'$ expenditure). |
| **Interval Quality & Fade** | No visibility into in-session performance degradation. | Compares interval set power (e.g. Lap 3 vs Lap 1 in `3x15`) to detect acute muscular fatigue or pacing failure. |
| **Tissue & Asymmetry Tracking** *(deferred — see §4)* | Relies solely on subjective check-ins for Achilles/knee restrictions. | Tracks Left/Right power phase and platform center offset drift as early mechanical warning signs. |

---

## 3. Storage & Schema Considerations

To keep Firestore queries fast and avoid document bloat:

1. **Activity Summary Document (`users/{userId}/activities/{activityId}`)**:
   - Store lightweight aggregates: `powerInZones`, `hrInZones`, `normalizedPower`, `variabilityIndex`, and summarized `laps` array (e.g. interval power and HR averages).
   - Document size remains small (< 5 KB per activity).
2. **Raw High-Frequency Series (deferred — see §4)**:
   - Second-by-second metric points (1,875+ records) or raw `.fit` files could eventually be stored in Cloud Storage (GCS) under the existing immutable archive (`ADR-0005`), keeping Firestore documents ultra-fast for UI and engine evaluation. Not part of the current implementation scope; revisit only if lap-summary-based fade detection proves insufficient.

---

## 4. Proposed Implementation Stages

> **Naming note.** This project uses a top-level `Phase 0`–`Phase 9` sequence for major roadmap initiatives, each with its own `docs/plans/phase-N-*.md` design doc, ADR(s), and completion review (see `docs/plans/`, ADR-0007 onward). The scope below is a single bounded engineering task, not a new top-level phase, so its steps are labeled **Stage** to avoid colliding with that sequence. If this work later grows into its own initiative (e.g. the deferred dashboard/raw-series work below), promote it to a real `phase-10-*` plan doc at that point rather than reusing these stage numbers.

### Stage 1: Summary Ingestion, Trimmed Scope
Deliberately narrower than the full empirical findings in §1 — see §5 for why (client layer doesn't exist yet, N+1 rate-limit exposure, archive-keying gap).

* Add the missing per-activity endpoint methods to `GarminDataClient` (Protocol) and `GarminClientWrapper` in `garmin_client.py`.
* Extend `canonical.py` with new dataclasses (not raw dicts — see §5.4) and `garmin_provider.py` to ingest:
  - `power_in_zones` (seconds in Z1–Z7)
  - `hr_in_zones` (seconds in Z1–Z5)
  - `normalized_power`, `intensity_factor`, `variability_index`
  - `lap_summaries` — **averages only** (power, HR, duration per lap)
* **Gate the extra per-activity call**: only fetch detail for qualifying activities (e.g. structured/hard `intensity_tag`, or cycling activities with power data), and only within the live daily-sync window — **not** `backfill`. Revisit backfill coverage only after the rate-limit budget in §5.2 is confirmed safe.
* Persist as an additive merge to the existing `users/{userId}/activities/{activityId}` document (`upsert_activity` already does `set(..., merge=True)`; no Firestore rules change needed).
* **Explicitly out of scope for this stage**: pedaling dynamics / L-R asymmetry (§1.2's "Cycling Dynamics"), `activityDetailMetrics` high-frequency series (§1.3), binary FIT download/archival (§1.4). These remain valid findings but add the most complexity for the least-proven payoff — defer until Stage 1's zone/NP data has been in production long enough to show whether the cheaper signal is already sufficient.
* **Prerequisite, before writing code**: resolve the archive-keying question (§5.3) via an ADR-0005 amendment, and set an explicit rate-limit budget (§5.2).

### Stage 2: Engine Integration — *measured before shipped*
* Update `completedTraining.ts` to use actual time-in-zones when computing stimulus and `deliveredDose`.
* Compute interval fade metrics (Lap 3 vs Lap 1, etc.) from `lap_summaries` when an authored workout is matched against completed lap splits — no raw series required.
* `fatigue.ts`/`completedTraining.ts` must degrade to the current TE-based path when no power data exists (e.g. a run), rather than propagating nulls into dose/cost — see §5.6.
* **This stage changes recommendations and is therefore a policy change** (`POLICY_VERSION`, scenario baseline, ADR-0010 replay). Per the **D-FUSE** / **D-SUBJCAL** precedent it must be built default-off and compared against the current TE-based path on real data before any ship decision — see §5.8. Do not prescribe the zone→stimulus coefficients in advance.

### Stage 3: Athlete Dashboard Visualization
* Display power/HR zone bar charts and interval split breakdowns on the activity view, sourced entirely from Stage 1's Firestore summary fields.
* Does **not** require the deferred raw-series/FIT work — zone bars and lap-average breakdowns are enough for a first version.
* Independent of Stage 2: visualising ingested telemetry does not require the engine to consume it, so Stage 3 can ship while Stage 2 is still being measured.

> **Execution detail lives in the plan, not here.** Per `docs/plans/README.md`'s taxonomy (`analysis` = "what is true today", `plans` = "how we get there"), the work items, tests, acceptance criteria and rollback for the stages above are in [`docs/plans/garmin-activity-telemetry-ingestion.md`](../plans/garmin-activity-telemetry-ingestion.md). This section states scope and boundaries only.

---

## 5. Implementation Risks & Recommendations (codebase cross-check, 2026-08-17)

The findings above were validated against the current state of `src/garmin_sync/` and `app/src/engine/`. All proposed fields (`power_in_zones`, `hr_in_zones`, `normalized_power`, `lap_summaries`) are confirmed absent from `CanonicalActivity` and unused in `completedTraining.ts`/`fatigue.ts` today, so Stage 1–2 is real, additive work. Eight gaps needed closing before implementation starts (§4 above already reflects the trimmed scope these findings drove); findings 7 and 8 are the two that most change the shape of the work:

1. **The client layer doesn't exist yet.** `GarminDataClient` (Protocol) and `GarminClientWrapper` in [`garmin_client.py`](../../src/garmin_sync/garmin_client.py) expose no methods for per-activity endpoints — no `get_activity_splits`, no zone/typed-splits calls, no `download_activity`. Stage 1 must add these to *both* the Protocol and the concrete wrapper, following the existing `if not self.api: raise RuntimeError(...)` / `or {}` defensive pattern used by every other method there.

2. **N+1 rate-limit exposure.** Zones, laps, and `activityDetailMetrics` are separate Garmin endpoints from `get_activities()`, so Stage 1 implies one or more extra authenticated calls **per activity**, not per day. `backfill --days N` would multiply call volume by average activities/day and risks tripping `GarminConnectTooManyRequestsError`. Resolved in §4 by gating detail fetch to qualifying activities within the live daily-sync window only, excluding bulk backfill — confirm `GarminClientWrapper`'s existing `retry_attempts`/`retry_min_wait`/`retry_max_wait` are sufficient headroom for that reduced volume before shipping.

3. **The raw archive can't key by activity ID today.** ADR-0005 states payloads key by "`{endpoint}/{date_iso}.json.gz` (or activity ID)", but [`archive.py`](../../src/garmin_sync/archive.py)'s `_validate_logical_date` hard-requires a `YYYY-MM-DD` string and rejects anything else. This blocks the deferred raw-series storage in §3/§4, not Stage 1 (which only writes structured summary fields to Firestore, no GCS archive involved). If that work is ever un-deferred: either key by the activity's own date (and disambiguate same-day activities via a per-activity `endpoint` name, since the store dedupes on `(endpoint, logical_date)`), or extend the archive store to accept an activity-ID identifier — via an ADR-0005 amendment, not a silent reuse of `_archive_raw`.

   > **Resolved 2026-08-17 (ADR-0005 amendment), and the finding understated the problem.** Beyond the rejected identifier, the documented key also omits the real `{year}/{month}` shard, and the per-activity `endpoint`-name workaround suggested above **would have silently lost data**: within a single sync run the object path is `{sync_run_id}.json.gz` inside the date directory, so two differing payloads under the same `(endpoint, logical_date)` collide and the second overwrites the first. The amendment records the archive as date-keyed only; per-activity payloads are not archived, and reviving them needs a new ADR.

4. **New fields need canonical dataclasses, not raw dicts.** `canonical.py` documents its own rule: field names/units must be provider-agnostic and nothing gets added that no provider actually supplies. Stage 1's `power_in_zones`/`hr_in_zones`/`lap_summaries` should follow the existing pattern (e.g. `CanonicalPowerZoneEntry`, `CanonicalLapSummary`, mirroring how `CanonicalHeartRateZones` and `CanonicalTrainingStatus` were added) so `mapper.py` and the engine never touch Garmin's raw key names (`secsInZone`, `zoneLowBoundary`, `leftPowerPhaseStart`, etc.) directly.

5. **Firestore schema migration is a non-issue — with one hard condition.** The `users/{userId}/activities/{activityId}` match block in [`firestore.rules`](../../app/firestore.rules) is `allow write: if false` (server-only via Admin SDK), and [`firestore_repository.py`](../../src/garmin_sync/firestore_repository.py)'s `upsert_activity` already does `set(payload, merge=True)`. Adding fields to the per-activity document is therefore a safe additive merge with zero rules migration — the actual reason Stage 1 is low-friction. The condition is finding 7 below.

6. **Timezone/date attribution and sport-scoping for Stage 2.** Per `CLAUDE.md`, all calendar-date logic must go through `local_today()`/`getLocalDateString()` in `Europe/Warsaw`, never a UTC split. Lap and `activityDetailMetrics` timestamps from Garmin are epoch-ms; any interval-fade logic that buckets a lap by calendar date (e.g. a session crossing midnight) must reuse `dates.py`'s existing conversion. Separately, NP/VI/W′ are power-based (cycling-only in practice); `fatigue.ts` and `completedTraining.ts`'s `evidenceTier` should degrade to the current TE-based path when no power data exists (e.g. a run) rather than propagating nulls into the dose/cost calculation — now called out explicitly in Stage 2.

7. **The read-side parser tolerates new fields but not a new `schemaVersion` — this is a live trap.** `parseNormalizedGarminActivity` in [`app/src/persistence/parsers/trainingHistory.ts`](../../app/src/persistence/parsers/trainingHistory.ts) validates a fixed allowlist of known keys and **ignores unrecognised ones**, which is precisely why finding 5's additive merge is safe. But it rejects any document whose `schemaVersion` is present and `!== 1`, and `ActivityService.getActivitiesInRange` collapses the *entire* window to `INVALID` if even one document fails to parse. So the instinctive "bump `schemaVersion` to 2 because we added fields" would not degrade gracefully — it would zero out the engine's whole completed-training history. `normalize_activity` in [`mapper.py`](../../src/garmin_sync/mapper.py) currently writes no `schemaVersion` at all, and Stage 1 **must keep it that way** unless the parser is widened in the same change. Detail fields should also be written in the *same* `upsert_activity` call as the base record rather than a second merge, since `syncedAt` doubles as the read-side `revision` and a second write would churn it.

8. **Stage 2 is a policy change, not just a code change — and this repo has a precedent for how those are handled.** Changing how `estimatedStimulus`/`estimatedCost` are derived alters real recommendations, so it forces a `POLICY_VERSION` bump in [`policy.ts`](../../app/src/engine/policy.ts) (guarded in CI by `check-policy-drift.mjs`), moves the committed scenario baseline that `simulate:diff` compares against, and interacts with ADR-0010 replay — a decision audited under the old policy must stay reproducible. More importantly, the project has twice refused to prescribe a formula in advance and instead required measurement first (**D-FUSE**, ADR-0014; **D-SUBJCAL**, ADR-0020). Asserting up front that "Z4/Z5 seconds should scale stimulus by *X*" would be exactly the uncited-constant practice finding F11 of the 2026-08-08 architecture review criticised. **Stage 2 should therefore be built as a measured, default-off candidate and compared against the current TE-based path before any ship decision** — the same shape as D-FUSE. Stage 1 (pure ingestion, no decision impact) carries none of this weight and can proceed independently.
