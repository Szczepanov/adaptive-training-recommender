# Ingestion Pipeline & Wearable Telemetry Architecture

The Python backend (`src/garmin_sync/`) implements Garmin read-side ingestion, historical
backfill/rebuild, raw payload archiving, baseline calculation, user-scoped Firestore
persistence, and write-side workout publication. The web app can request a refresh through a
Firestore coordination document; it does not call Garmin Connect directly.

This document describes **current implementation**. Per the documentation precedence rules in
[`docs/README.md`](../README.md), code wins when this document and an ADR disagree.

---

## 🏗️ Core Components

```text
Garmin Connect
  ├── Daily/core: stats, sleep, HRV, activities
  ├── Best-effort daily enrichments:
  │     stress, respiration, Body Battery, Training Readiness,
  │     Training Status, HR zones, daily weigh-ins, SpO2/Pulse Ox,
  │     skin-temperature deviation
  ├── Current profile enrichments:
  │     cycling FTP, running lactate threshold, body composition,
  │     race predictions, gear inventory/mileage
  ├── Activity detail:
  │     strength exercise sets OR power zones + HR zones + splits;
  │     running-dynamics summary fields on eligible run activities
  └── Workout mutation: upload + schedule
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ GarminClientWrapper (`garminconnect.Garmin`)                 │
│ authenticated API wrapper                                    │
└─────────────────────────────┬────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌──────────────────────────┐   ┌────────────────────────────────┐
│ TokenStore               │   │ GarminProviderAdapter          │
│ local or GCS             │   │ WearableProvider boundary      │
└──────────────────────────┘   └───────────────┬────────────────┘
                                               │ canonical models
                                               ▼
                              ┌────────────────────────────────┐
                              │ GarminSyncService              │
                              │ sync / backfill / rebuild      │
                              └───────────────┬────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
                    ▼                                                   ▼
        ┌──────────────────────────┐                    ┌──────────────────────────────┐
        │ RawArchiveStore          │                    │ FirestoreRecoveryRepository  │
        │ GCS / local gzip         │                    │ user-scoped writes           │
        │ ADR-0005                 │                    └──────────────────────────────┘
        └──────────────────────────┘
```

Primary Firestore paths written or coordinated by this subsystem are:

* `users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}` — date-bound recovery snapshots.
* `users/{userId}/activities/{activityId}` — normalized standalone activity records.
* `users/{userId}/preferences/profile` — current athlete preferences and performance profile.
* `users/{userId}/gear/{gearPk}` — one document per Garmin-registered gear item (shoes, bikes).
* `users/{userId}/garmin_sync_requests/latest` — the single shared manual/automatic sync request.
* `users/{userId}/garmin_runtime/execution_lease` — per-user Garmin-operation lease.
* `users/{userId}/garmin_workout_queue/{date}` — outbound workout queue.
* `users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}` — multi-source day-source recovery observation bundles (ADR-0027).

---

## 🌐 Multi-Source Recovery Ingestion Architecture (ADR-0027)

```text
Google Health API (v4) / REST Data Points
  ├── sleep (sleepSession, stage summaries)
  ├── daily-heart-rate-variability (average HRV, deep sleep RMSSD)
  ├── daily-resting-heart-rate (RHR bpm)
  └── daily-respiratory-rate (breaths per minute)
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ GoogleHealthClient (`health.googleapis.com/v4`)              │
│ authenticated OAuth client, pagination, error classification │
└─────────────────────────────┬────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌──────────────────────────┐   ┌────────────────────────────────┐
│ GoogleHealthAuthManager  │   │ GoogleHealthProvider           │
│ token & credentials      │   │ RecoveryObservationProvider    │
└──────────────────────────┘   └───────────────┬────────────────┘
                                               │ raw payload batches
                                               ▼
                              ┌────────────────────────────────┐
                              │ GoogleHealthMapper             │
                              │ package origin attribution:    │
                              │ - com.eightsleep.eight         │
                              │ - com.garmin.android...        │
                              └───────────────┬────────────────┘
                                               │ CanonicalHealthObservation[]
                                               ▼
                              ┌────────────────────────────────┐
                              │ HealthObservationService       │
                              │ sync / repair / backfill-range │
                              └───────────────┬────────────────┘
                                               │
                     ┌─────────────────────────┴─────────────────────────┐
                     │                                                   │
                     ▼                                                   ▼
         ┌──────────────────────────┐                    ┌──────────────────────────────┐
         │ RawArchiveStore          │                    │ FirestoreRecoveryRepository  │
         │ immutable GCS / gzip     │                    │ health_observation_days      │
         └──────────────────────────┘                    └──────────────────────────────┘
```

### Key Multi-Source Invariants
1. **Source Attribution**: Every observation preserves exact `provider` (`garmin`, `eight_sleep`), `transport` (`google_health`, `direct`), origin package, and hardware device.
2. **Day-Source Bundles**: Observations are stored under `users/{userId}/health_observation_days/{date}_{provider}_{transport}` with deterministic observation IDs.
3. **Step Count Semantics (`D-MS-STEPS`)**: Aggregator step counts from Google Health are strictly ignored to prevent double-counting structured training fatigue.
4. **Instant Maturity via Backfill**: Historical data is backfilled via `uv run python -m garmin_sync backfill-health --days 60 --token <TOKEN>`, immediately seeding 28-day mature baselines.

### Direct Eight Sleep transport (ADR-0030)

Independent of the Google Health path above, `src/garmin_sync/eight_sleep_*.py`
(`eight_sleep_client.py`, `eight_sleep_config.py`, `eight_sleep_mapper.py`,
`eight_sleep_provider.py`, `eight_sleep_probe.py`) implements an owned, read-only direct
connector to Eight Sleep's private API, producing `provider=eight_sleep`,
`transport=eight_sleep_direct` observations through `EightSleepDirectProvider` (a
`RecoveryObservationProvider`-shaped adapter, ADR-0030). It exists as a **default-off**
alternative to the `com.eightsleep.eight` Google Health package-attribution path. It has its
own CLI entry points, separate from `backfill-health`'s `{"google_health": provider}`
registration: `backfill-eight-sleep-direct` persists to
`health_observation_days/{date}_eight_sleep_eight_sleep_direct`, and
`compare-eight-sleep-transports` (ES9) diffs those bundles against the pre-existing
`eight_sleep`/`google_health` ones via a generalized `TransportEquivalenceAnalyzer`
(`expected_provider` param, `equivalence.py`) shared with MS10's Garmin comparison.
`backfill-eight-sleep-direct` runs daily via a dedicated Cloud Scheduler job once deployed
(a bounded 7-day trailing window per tick); `compare-eight-sleep-transports` is run on demand,
not scheduled. Both still require `EIGHT_SLEEP_DIRECT_ENABLED` and runtime secrets
provisioned before anything real happens (see
[`docs/plans/eight-sleep-direct-recovery-ingestion.md`](../plans/eight-sleep-direct-recovery-ingestion.md)).

### Identity gate location (ADR-0028)

A shared source like Eight Sleep sits between "day-source bundle exists" and "source-specific
baseline accumulation" above. Before any shared-source bundle can enter
`computeSourceMetricBaseline()` (TypeScript) or `run_multisource_audit()`'s baseline path
(Python), it must resolve to an effective `USER` identity decision via
`selectEligibleHealthObservationBundles()` / `src/garmin_sync/identity_eligibility.py` — both
fail closed on a missing or ambiguous decision. See
[**Physiological Identity Passport & Measurement Trust**](./physiological-identity-passport.md)
for the full pipeline (pairing, lineage, the versioned passport, the ternary evaluator, and the
review UI that produces manual corrections); this is currently shadow/engine-layer only — no
recommendation path consumes gated shared-source output yet.

---

## 📁 Source Code Organization

* [`src/garmin_sync/config.py`](../../src/garmin_sync/config.py) — typed `Settings`, including staleness and activity-detail configuration.
* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — local-date helpers; production date semantics use `Europe/Warsaw` unless configured otherwise.
* [`src/garmin_sync/garmin_client.py`](../../src/garmin_sync/garmin_client.py) — authenticated `garminconnect.Garmin` wrapper and endpoint calls, including SpO2/gear endpoints.
* [`src/garmin_sync/canonical.py`](../../src/garmin_sync/canonical.py) — provider-neutral models such as `CanonicalDailyMetrics`, `CanonicalSpo2`, `CanonicalActivity`, `CanonicalActivityDetail`, `CanonicalRunningDynamics`, `CanonicalExerciseSet`, `CanonicalGearItem`, `CanonicalRacePredictions`, and `CanonicalPerformanceTargets`.
* [`src/garmin_sync/provider.py`](../../src/garmin_sync/provider.py) — `WearableProvider` protocol plus provider result/capability types.
* [`src/garmin_sync/garmin_provider.py`](../../src/garmin_sync/garmin_provider.py) — Garmin response-shape parsing and conversion into canonical models.
* [`src/garmin_sync/token_store.py`](../../src/garmin_sync/token_store.py) — token persistence abstraction supporting local and GCS stores.
* [`src/garmin_sync/archive.py`](../../src/garmin_sync/archive.py) — immutable raw payload archive used by offline rebuild.
* [`src/garmin_sync/metrics.py`](../../src/garmin_sync/metrics.py) — pure baseline transformations for averages, medians/MADs, deltas, and dispersion fields.
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — provider-neutral mapping into Schema Version 3 recovery snapshots and standalone activity documents.
* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — user-scoped Firestore persistence, Garmin performance-profile merge rules, and gear inventory upserts.
* [`src/garmin_sync/audit.py`](../../src/garmin_sync/audit.py) — `garmin-sync audit` snapshot-completeness reporting, including SpO2/skin-temperature coverage.
* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — daily sync, lookback resync, backfill, rebuild, activity enrichment, and workout orchestration.
* [`src/garmin_sync/account_link.py`](../../src/garmin_sync/account_link.py) / [`account_link_api.py`](../../src/garmin_sync/account_link_api.py) — self-service Garmin account linking and token bootstrap.
* [`src/garmin_sync/coordination.py`](../../src/garmin_sync/coordination.py) — Firestore-backed per-user Garmin execution lease.
* [`src/garmin_sync/workout_export.py`](../../src/garmin_sync/workout_export.py) — canonical workout-to-Garmin JSON transformation.
* [`src/garmin_sync/eight_sleep_client.py`](../../src/garmin_sync/eight_sleep_client.py), [`eight_sleep_config.py`](../../src/garmin_sync/eight_sleep_config.py), [`eight_sleep_mapper.py`](../../src/garmin_sync/eight_sleep_mapper.py), [`eight_sleep_provider.py`](../../src/garmin_sync/eight_sleep_provider.py), [`eight_sleep_probe.py`](../../src/garmin_sync/eight_sleep_probe.py) — owned direct read-only Eight Sleep private-API connector (ADR-0030), default-off, not yet wired into any production CLI command.
* [`app/src/hooks/useAutoGarminSync.ts`](../../app/src/hooks/useAutoGarminSync.ts) — client-side stale/missing snapshot refresh trigger.
* [`app/src/services/garminSyncRequestService.ts`](../../app/src/services/garminSyncRequestService.ts) — transactional fixed-document sync request coordination.

See [`docs/garmin-gear-tracking.md`](../garmin-gear-tracking.md) for the gear-inventory feature in detail.

---

## 📊 Current Ingested Telemetry

### 1. Daily recovery snapshots

`users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}` owns date-bound observations and their
baseline/provenance fields. Current `raw` fields include:

* sleep score and duration;
* sleep-stage scalar durations: `deepSleepSec`, `remSleepSec`, `lightSleepSec`, and `awakeSleepSec`;
* `restlessMomentsCount`;
* resting HR, overnight HRV average/status, and sleep-window respiration average;
* waking Body Battery plus charged/drained/change detail when available;
* completed previous-day (`D-1`) steps;
* stress, Training Readiness, Training Status, configured HR-zone summary, and Garmin recovery time;
* weight/body-fat observations when Garmin supplies a valid weigh-in;
* Garmin Pulse Ox daily average/minimum (`spo2.avgPct`/`minPct`) and sleep-average SpO2 (`spo2.sleepAvgPct`);
* overnight skin-temperature deviation in °C (`skinTempDeviationCelsius`);
* `todayTraining`, `yesterdayTraining`, and recent-hard-session summaries derived from normalized activities;
* real Garmin sleep-session start/end timestamps (`raw.sleepSessionStart`/`raw.sleepSessionEnd`,
  from `dailySleepDTO.sleepStartTimestampGMT`/`sleepEndTimestampGMT`), with `dataQuality.sleepTimingAvailable`
  recording whether both bounds were available for that night — added to feed PI8's identity-attribution
  `SESSION_TIMING` evidence, which previously had zero coverage because these parsed timestamps were
  discarded after computing the respiration-window average and never reached `CanonicalDailyMetrics`.

Sleep stages are stored as individual scalar fields, **not** under a `raw.sleepStages` object —
there is no separate `CanonicalSleepStages` type. The recovery UI currently renders those stage
durations and restlessness as text values in `DataView.tsx`; it does not expose a dedicated
interactive sleep-stage chart.

The dedicated respiration endpoint is a best-effort enrichment. When enough interval samples
cover the sleep window, `garmin_provider.average_sleep_respiration_from_intervals` computes the
nightly average from those readings; otherwise ingestion falls back to the sleep DTO's summary.
See ADR-0024 for why estimator changes remain evidence-gated.

**SpO2 and skin-temperature invariants.** The Pulse Ox summary and the sleep response are
distinct sources and stay distinct in canonical data: `spo2.avgPct`/`minPct` come only from the
date-scoped Pulse Ox summary, and `spo2.sleepAvgPct` comes only from the selected sleep record.
Missing daily and sleep values are not synthesized from one another, and SpO2 percentages are
accepted only as finite values in `(0, 100]`. If the target-date sleep record is unavailable and
the `D-1` record is selected instead, target-date Pulse Ox is deliberately excluded rather than
fused into a mixed-date object; `source.metricDates.spo2` and
`source.metricDates.skinTempDeviation` record whichever logical date was actually used.
`dataQuality.spo2Available` and `dataQuality.skinTempAvailable` record channel availability
independently. Both endpoints are best-effort: a Garmin failure logs a warning rather than
failing the daily sync, and `garmin-sync audit` reports snapshot-level coverage so real-world
availability can be measured before either signal is allowed to influence recommendation policy
(ADR-0026 §7).

### 2. Current performance profile and biometrics

`users/{userId}/preferences/profile.performanceProfile` owns current configuration-like Garmin
values that must not be replayed as historical daily observations:

* cycling FTP;
* running threshold pace and running LTHR;
* current weight and body-fat percentage;
* measurement timestamps when Garmin supplies them;
* Garmin 5K, 10K, half-marathon, and marathon race predictions.

Race predictions are mirrored into `performanceProfile.racePredictions` for UI consumption and
kept under the Garmin profile payload as imported source data. `PerformanceSections.tsx` renders
finish times and equivalent pace using the athlete's preferred distance units.

Field-level ownership prevents an import from overwriting values whose source is `manual` or
`coach`. An existing unowned active value is conservatively adopted as `manual`; Garmin may
update an active field only when that field is absent or already Garmin-owned.

Current profile import is best-effort and runs after a successful live daily sync. Historical
`backfill` and `rebuild` do not rewrite today's performance profile into old dates.

### 3. Gear inventory

`users/{userId}/gear/{gearPk}` owns one document per Garmin-registered gear item (running shoes,
bikes, and similar), imported via `Garmin.get_gear(userProfilePk)` and enriched with
`Garmin.get_gear_stats(uuid)` only when the inventory response omits `totalDistance`.
`preferences/profile.gearTracker` carries a compact list plus a `syncedAt` timestamp for the
preferences UI. `CanonicalGearItem` stores `total_distance_km` and an optional
`maximum_distance_km` — the athlete's own Garmin-configured retirement distance, not a generic
universal mileage threshold (ADR-0026 §7). `PerformanceSections.tsx` renders each item's mileage
and, when a maximum is configured, a usage-percentage bar.

Gear sync is best-effort and current-profile-only, like performance-profile import: a failing
Garmin endpoint does not fail the daily sync, and an empty canonical result is treated as a
no-op so a transient failure cannot erase a previously synchronized snapshot. See
[`docs/garmin-gear-tracking.md`](../garmin-gear-tracking.md) for full failure semantics, request-volume
considerations, and Firestore security rules for this path.

### 4. Activity telemetry

`users/{userId}/activities/{activityId}` stores normalized cross-day activity records. Base
activity data includes aerobic/anaerobic Training Effect, average HR, activity training load,
intensity tag, primary-benefit/training-effect descriptors, EPOC when present, and recovery
hours when present.

Additional activity detail has separate paths:

* **Strength / fitness-equipment activities** — target-date live sync fetches Garmin exercise
  sets. REST rows are folded into the preceding work set; work rows can carry set order, type,
  reps, weight in kg, exercise category/name, duration, and rest duration. `ActivityTelemetry`
  renders the resulting `exerciseSets` table.
* **Power-bearing cycling activities** — only when `GARMIN_ACTIVITY_DETAIL_ENABLED=true`,
  target-date live sync can add power zones, HR zones, lap summaries, normalized power,
  intensity factor, and derived variability index. `ActivityTelemetry` renders these read-only
  details.
* **Running-dynamics summary fields** — `extract_running_dynamics` treats running dynamics as
  running-only activity-summary telemetry (`run`/`running` types and Garmin type keys ending in
  `_run`/`_running`); generic cycling `avgPower`/`maxPower` values are never re-labelled as
  running power. `mapper.py` repeats the same running-only predicate as a write-side defence
  before emitting `runningDynamics` under the activity document:

  | Persisted field | Canonical unit | Garmin activity-summary source |
  |---|---:|---|
  | `groundContactTimeMs` | ms | ground-contact time in ms |
  | `groundContactBalanceLeftPct` | % left | ground-contact balance |
  | `verticalOscillationCm` | cm | vertical oscillation converted from mm |
  | `verticalRatioPct` | % | vertical ratio |
  | `strideLengthM` | m | stride length converted from cm |
  | `avgRunningPowerWatts` | W | average running power |
  | `maxRunningPowerWatts` | W | maximum running power |

  Missing, malformed, or zero-sentinel strictly-positive metrics are omitted rather than
  invented. Ground-contact balance is accepted only from 35–65%, and vertical ratio only from
  1–25%; `trainingHistory.ts` mirrors these running-only, range, and strictly-positive checks so
  legacy schema-less records cannot reintroduce invalid telemetry into the UI. **No
  gait-asymmetry alert or threshold is implemented** — ground-contact balance is surfaced as a
  raw read-only value, not as a flagged condition.

A historical `backfill` fetches detail only when explicitly run with `--include-details`.
`rebuild` reconstructs recovery snapshots from the date-keyed raw archive and leaves existing
standalone activity telemetry untouched. Running-dynamics fields, like other activity-detail
data, are not part of the date-keyed raw archive (see §6 below).

### 5. Deliberately unsupported/deferred telemetry

SpO2, skin-temperature deviation, running-dynamics summary fields, and gear mileage are all
implemented as of this revision (§1–§4). What remains explicitly unimplemented:

* a gait-asymmetry alert or threshold derived from ground-contact balance;
* an interactive sleep-stage chart (stage durations are rendered as text values only);
* an automatic, generic shoe/bike retirement rule — only the athlete's own Garmin-configured
  `maximumMeters` is surfaced, never a universal mileage default.

Those capabilities require explicit endpoint-shape evidence, canonical fields, storage
ownership, tests, and UI/engine semantics before architecture documentation can describe them
as current behavior. ADR-0026 records this boundary and the process for adding a new signal.

---

## 🔄 Data Flow & Metric Provenance

1. **Date resolution** — resolve target date `D` using the configured local timezone.
2. **Core daily fetch** — fetch `D` stats/sleep/HRV plus `D-1` stats; completed steps use `D-1` when available, per ADR-0003.
3. **Best-effort daily enrichment** — stress, respiration, Body Battery, Training Readiness, Training Status, HR zones, daily weigh-in, SpO2, and skin-temperature failures are warning-only and do not replace the core fetch contract.
4. **Activity window** — fetch activities from `D-3` through `D`, normalize them, and persist stable-ID activity records.
5. **Target-date activity detail** — always attempt strength-set enrichment for eligible strength activities and running-dynamics extraction for eligible run activities; optionally fetch cycling power/HR zones and splits when `GARMIN_ACTIVITY_DETAIL_ENABLED=true`.
6. **Raw archive** — archive date-keyed provider payloads used by the snapshot path, including the optional `spo2` endpoint key; skin-temperature deviation is read from the already-archived `sleep` payload rather than a separate archive key. Activity-detail payloads (including running dynamics) are intentionally not archived because ADR-0005's current archive key is logical-date based rather than activity-ID based.
7. **Baseline seed and calculation** — seed up to 28 days of Firestore prehistory and compute the current derived baseline fields.
8. **Snapshot upsert** — merge Schema Version 3 output into `users/{userId}/daily_recovery_snapshots/{D}`.
9. **Late-data lookback** — `sync_daily` revisits configured prior days oldest-first, then builds `D` last so corrected history can feed today's baseline.
10. **Current-profile import** — after a successful live daily sync, best-effort Garmin performance targets/body composition/race predictions/gear inventory merge into `preferences/profile` (and `users/{userId}/gear/{gearPk}`) under field-ownership rules.
11. **Token persistence** — refreshed authentication tokens are persisted after authenticated API work.

Core daily/activities failures still fail their relevant sync path; only explicitly optional
enrichments are failure-isolated. An exhausted activity-detail 429 abandons remaining detail
work for that run without preventing base activity/snapshot persistence. Older archives without
SpO2 remain rebuildable and simply produce missing optional SpO2 fields.

---

## 🔄 Client-Side Auto-Sync & Staleness Coordination

The web app never performs Garmin API calls itself.

`useAutoGarminSync` evaluates the loaded recovery snapshot for the current user/date. If its
client-side staleness predicate considers the snapshot missing, incomplete, or old, it calls
`garminSyncRequestService.requestSync(userId)`. The service transaction writes or joins the
single fixed document:

`users/{userId}/garmin_sync_requests/latest`

The browser is allowed to request `status: 'pending'`; backend/Admin code owns processing and
terminal status transitions. Transactional reuse of an already-live request prevents browser
tabs/devices from blindly overwriting one another.

Current client thresholds are 60 minutes for a complete snapshot and 5 minutes for a snapshot
that is incomplete by the client's predicate. The backend repository has its own, stricter
snapshot-completeness check for server-side staleness decisions (it also expects respiration,
Body Battery, and completed steps). These predicates are intentionally documented separately;
they are not currently identical.

The hook reacts to the data/user/date lifecycle. It does **not** install a browser visibility
change listener to trigger sync requests.

Backend `poll-manual-sync` / `poll-manual-sync-all` commands claim pending work and run Garmin
operations. `GarminExecutionLease` serializes Garmin work per user at
`users/{userId}/garmin_runtime/execution_lease` so overlapping Cloud Run executions do not
perform concurrent Garmin operations for the same account.

---

## 🚴 Workout Export & Garmin Connect Scheduling

The system also supports the opposite direction: publishing structured workouts to Garmin
Connect.

1. **Queueing** — the frontend writes a canonical workout export document to `users/{userId}/garmin_workout_queue/{date}`.
2. **Payload transformation** (`src/garmin_sync/workout_export.py`):
   - **Target resolution hierarchy**:
     - *Exact watts*: `230–240 W` → `power.zone` with `targetValueOne: 230`, `targetValueTwo: 240`.
     - *% FTP + athlete FTP*: `90–95% FTP` with 260 W FTP → absolute watt targets.
     - *Named zone or % FTP fallback*: `Zone 2`, `Tempo`, `65–75% FTP` → native Garmin zone number.
     - *Other*: `no.target` with descriptive cues.
   - **Repeat grouping (`RepeatGroupDTO`)** supports repeated steps and repeated multi-step blocks.
3. **Synchronization** (`src/garmin_sync/service.py`) — pending queue items are uploaded and scheduled through `client.upload_workout` + `client.schedule_workout`, then marked `synced` with Garmin ID/timestamp metadata.

Outbound workout publication and inbound recovery/activity ingestion share the per-user Garmin
execution lease so they do not race each other.
