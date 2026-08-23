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
  │     Training Status, HR zones, daily weigh-ins
  ├── Current profile enrichments:
  │     cycling FTP, running lactate threshold, body composition,
  │     race predictions
  ├── Activity detail:
  │     strength exercise sets OR power zones + HR zones + splits
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
* `users/{userId}/garmin_sync_requests/latest` — the single shared manual/automatic sync request.
* `users/{userId}/garmin_runtime/execution_lease` — per-user Garmin-operation lease.
* `users/{userId}/garmin_workout_queue/{date}` — outbound workout queue.

There is currently **no** `users/{userId}/gear/...` collection in the Garmin ingestion path.

---

## 📁 Source Code Organization

* [`src/garmin_sync/config.py`](../../src/garmin_sync/config.py) — typed `Settings`, including staleness and activity-detail configuration.
* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — local-date helpers; production date semantics use `Europe/Warsaw` unless configured otherwise.
* [`src/garmin_sync/garmin_client.py`](../../src/garmin_sync/garmin_client.py) — authenticated `garminconnect.Garmin` wrapper and endpoint calls.
* [`src/garmin_sync/canonical.py`](../../src/garmin_sync/canonical.py) — provider-neutral models such as `CanonicalDailyMetrics`, `CanonicalActivity`, `CanonicalActivityDetail`, `CanonicalExerciseSet`, `CanonicalRacePredictions`, and `CanonicalPerformanceTargets`.
* [`src/garmin_sync/provider.py`](../../src/garmin_sync/provider.py) — `WearableProvider` protocol plus provider result/capability types.
* [`src/garmin_sync/garmin_provider.py`](../../src/garmin_sync/garmin_provider.py) — Garmin response-shape parsing and conversion into canonical models.
* [`src/garmin_sync/token_store.py`](../../src/garmin_sync/token_store.py) — token persistence abstraction supporting local and GCS stores.
* [`src/garmin_sync/archive.py`](../../src/garmin_sync/archive.py) — immutable raw payload archive used by offline rebuild.
* [`src/garmin_sync/metrics.py`](../../src/garmin_sync/metrics.py) — pure baseline transformations for averages, medians/MADs, deltas, and dispersion fields.
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — provider-neutral mapping into Schema Version 3 recovery snapshots and standalone activity documents.
* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — user-scoped Firestore persistence and Garmin performance-profile merge rules.
* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — daily sync, lookback resync, backfill, rebuild, activity enrichment, and workout orchestration.
* [`src/garmin_sync/account_link.py`](../../src/garmin_sync/account_link.py) / [`account_link_api.py`](../../src/garmin_sync/account_link_api.py) — self-service Garmin account linking and token bootstrap.
* [`src/garmin_sync/coordination.py`](../../src/garmin_sync/coordination.py) — Firestore-backed per-user Garmin execution lease.
* [`src/garmin_sync/workout_export.py`](../../src/garmin_sync/workout_export.py) — canonical workout-to-Garmin JSON transformation.
* [`app/src/hooks/useAutoGarminSync.ts`](../../app/src/hooks/useAutoGarminSync.ts) — client-side stale/missing snapshot refresh trigger.
* [`app/src/services/garminSyncRequestService.ts`](../../app/src/services/garminSyncRequestService.ts) — transactional fixed-document sync request coordination.

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
* `todayTraining`, `yesterdayTraining`, and recent-hard-session summaries derived from normalized activities.

Sleep stages are stored as individual scalar fields, **not** under a `raw.sleepStages` object.
The recovery UI currently renders those stage durations and restlessness as text values in
`DataView.tsx`; it does not expose a dedicated interactive sleep-stage chart.

The dedicated respiration endpoint is a best-effort enrichment. When enough interval samples
cover the sleep window, `garmin_provider.average_sleep_respiration_from_intervals` computes the
nightly average from those readings; otherwise ingestion falls back to the sleep DTO's summary.
See ADR-0024 for why estimator changes remain evidence-gated.

The current ingestion code does **not** fetch or persist SpO2 or skin-temperature deviation.

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

### 3. Activity telemetry

`users/{userId}/activities/{activityId}` stores normalized cross-day activity records. Base
activity data includes aerobic/anaerobic Training Effect, average HR, activity training load,
intensity tag, primary-benefit/training-effect descriptors, EPOC when present, and recovery
hours when present.

Additional activity detail has two deliberately separate paths:

* **Strength / fitness-equipment activities** — target-date live sync fetches Garmin exercise
  sets. REST rows are folded into the preceding work set; work rows can carry set order, type,
  reps, weight in kg, exercise category/name, duration, and rest duration. `ActivityTelemetry`
  renders the resulting `exerciseSets` table.
* **Power-bearing cycling activities** — only when `GARMIN_ACTIVITY_DETAIL_ENABLED=true`,
  target-date live sync can add power zones, HR zones, lap summaries, normalized power,
  intensity factor, and derived variability index. `ActivityTelemetry` renders these read-only
  details.

A historical `backfill` fetches detail only when explicitly run with `--include-details`.
`rebuild` reconstructs recovery snapshots from the date-keyed raw archive and leaves existing
standalone activity telemetry untouched.

The current canonical activity model does **not** contain ground-contact balance, vertical
oscillation/ratio, stride length, or running-power fields, and no gait-asymmetry threshold is
implemented by this ingestion path.

### 4. Deliberately unsupported/deferred telemetry

The current Garmin ingestion boundary has no implementation for:

* SpO2/Pulse Ox;
* skin-temperature deviation;
* running-dynamics/gait-asymmetry metrics;
* Garmin gear/shoe/bike synchronization or retirement thresholds.

Those capabilities require explicit endpoint-shape evidence, canonical fields, storage
ownership, tests, and UI/engine semantics before architecture documentation can describe them
as current behavior. ADR-0026 records this boundary.

---

## 🔄 Data Flow & Metric Provenance

1. **Date resolution** — resolve target date `D` using the configured local timezone.
2. **Core daily fetch** — fetch `D` stats/sleep/HRV plus `D-1` stats; completed steps use `D-1` when available, per ADR-0003.
3. **Best-effort daily enrichment** — stress, respiration, Body Battery, Training Readiness, Training Status, HR zones, and daily weigh-in failures are warning-only and do not replace the core fetch contract.
4. **Activity window** — fetch activities from `D-3` through `D`, normalize them, and persist stable-ID activity records.
5. **Target-date activity detail** — always attempt strength-set enrichment for eligible strength activities; optionally fetch cycling power/HR zones and splits when `GARMIN_ACTIVITY_DETAIL_ENABLED=true`.
6. **Raw archive** — archive date-keyed provider payloads used by the snapshot path. Activity-detail payloads are intentionally not archived because ADR-0005's current archive key is logical-date based rather than activity-ID based.
7. **Baseline seed and calculation** — seed up to 28 days of Firestore prehistory and compute the current derived baseline fields.
8. **Snapshot upsert** — merge Schema Version 3 output into `users/{userId}/daily_recovery_snapshots/{D}`.
9. **Late-data lookback** — `sync_daily` revisits configured prior days oldest-first, then builds `D` last so corrected history can feed today's baseline.
10. **Current-profile import** — after a successful live daily sync, best-effort Garmin performance targets/body composition/race predictions merge into `preferences/profile` under field-ownership rules.
11. **Token persistence** — refreshed authentication tokens are persisted after authenticated API work.

Core daily/activities failures still fail their relevant sync path; only explicitly optional
enrichments are failure-isolated. An exhausted activity-detail 429 abandons remaining detail
work for that run without preventing base activity/snapshot persistence.

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
change listener.

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