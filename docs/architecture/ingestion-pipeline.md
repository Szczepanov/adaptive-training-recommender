# Ingestion Pipeline Architecture

The Python backend (`src/garmin_sync/`) handles automated daily ingestion, historical backfilling, raw data archiving, baseline metric calculation, and Firestore snapshot persistence.

---

## 🏗️ Core Components

```text
Garmin Connect API
       │
       ▼
┌──────────────────────────┐
│  GarminConnectClient     │ (garth wrapper with exponential backoff)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  TokenStore              │ (LocalTokenStore or GcsTokenStore)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  GarminSyncService       │ (Orchestrator: fetch, baseline math, mapping)
└────────────┬─────────────┘
             ├──────────────────────────┐
             ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  RawArchiveStore         │  │  FirestoreRepository     │
│  (GCS / Local gzip)      │  │  (Schema Version 3)      │
└──────────────────────────┘  └──────────────────────────┘
```

---

## 📁 Source Code Organization

* [`src/garmin_sync/config.py`](../../src/garmin_sync/config.py) — Typed dataclass configuration (`Settings`) validating environment variables (`APP_USER_ID`, `APP_TIMEZONE`, `GARMIN_STALENESS_MINUTES`).
* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — Date provider strictly bound to `Europe/Warsaw` timezone logic.
* [`src/garmin_sync/garmin_client.py`](../../src/garmin_sync/garmin_client.py) — Low-level Garth client wrapper fetching daily stats, sleep JSON, HRV balance, body battery, and activity histories.
* [`src/garmin_sync/token_store.py`](../../src/garmin_sync/token_store.py) — Token persistence abstraction supporting local file and Google Cloud Storage (GCS) object stores.
* [`src/garmin_sync/metrics.py`](../../src/garmin_sync/metrics.py) — Baseline mathematical transformations computing 7-day and 28-day moving averages, deltas, and standard deviations.
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — Schema Version 3 payload builder attaching field provenance dates (`metricsDates`).
* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — User-scoped Firestore CRUD operations (`users/{userId}/daily_recovery_snapshots/{date}`).
* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — Entry point service orchestrating synchronization workflows.
* [`src/garmin_sync/account_link.py`](../../src/garmin_sync/account_link.py) — Self-service Garmin account linking and user token management.
* [`src/garmin_sync/account_link_api.py`](../../src/garmin_sync/account_link_api.py) — HTTP API for family/multi-user account linking flows.
* [`src/garmin_sync/coordination.py`](../../src/garmin_sync/coordination.py) — Multi-user ingestion coordination and batch runs.
* [`src/garmin_sync/workout_export.py`](../../src/garmin_sync/workout_export.py) — FIT/TCX payload transformation and Garmin Connect workout export.

---

## 📊 Data Flow & Metric Provenance

1. **Date Resolution**: Determines target date $D$ in `Europe/Warsaw`.
2. **Fetch Window**: Retrieves biometric stats for date $D$ and step count from completed previous day ($D - 1$).
3. **Historical Lookback**: Fetches historical data points ($D-1 \dots D-28$) to compute baseline averages.
4. **Metric Enrichment**: Computes:
   * 7-day & 28-day moving average HRV (ms) and 28-day population standard deviation
   * 7-day & 28-day moving average Resting Heart Rate (bpm) and 28-day population standard deviation
   * 7-day & 28-day moving average Sleep Score and 28-day population standard deviation
   * 7-day & 28-day moving average step counts and 28-day population standard deviation
   * Waking Body Battery & signed deltas (vs 7d and vs 28d)
   * Completed previous-day ($D - 1$) total steps
5. **Upsert**: Writes Schema v3 snapshot payload to Firestore under `users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}`.
6. **Activity Normalization**: Saves canonical activity records to `users/{userId}/activities/{activityId}` for cross-day auditability.
7. **Optional Activity Detail**: When `GARMIN_ACTIVITY_DETAIL_ENABLED=true`, the target-date
   `sync_daily` pass fetches power zones, HR zones, and lap summaries for non-easy,
   power-bearing activities with IDs. Normalized power, intensity factor, and average power
   are taken from the already-fetched activity-list payload; variability index is derived
   only when average power is positive. Detail is merged into the same activity write.
   Failures are isolated from snapshot ingestion, and an exhausted 429 stops the remaining
   detail work for that run.

The detail path is never used by lookback resync, `backfill`, or `rebuild`, and its raw
payloads are not stored in the date-keyed archive. Rebuild writes snapshots only, leaving
existing standalone activity telemetry untouched.

### Running dynamics activity contract

`garmin_provider.py` `extract_running_dynamics` treats running dynamics as **running-only**
activity-summary telemetry. `run`, `running`, and Garmin type keys ending in `_run` or
`_running` are eligible; generic `avgPower`/`maxPower` values on cycling records must not
be re-labelled as running power. `mapper.py` keeps the same running-only predicate as a
write-side defence before emitting `runningDynamics` under
`users/{userId}/activities/{activityId}`.

Canonical units are explicit and do not depend on value magnitude:

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
invented. Ground-contact balance is accepted only from 35–65%, and vertical ratio only
from 1–25%. The Firestore read parser in `trainingHistory.ts` mirrors the running-only,
range, and strictly-positive checks so schema-less legacy records cannot reintroduce
invalid telemetry into the UI.

---

## 🚴 Workout Export & Garmin Connect Integration

The system supports automated workout export and calendar synchronization to Garmin Connect:

1. **Queueing**: The frontend writes a canonical workout export document to `users/{userId}/garmin_workout_queue/{date}`.
2. **Payload Transformation** (`src/garmin_sync/workout_export.py`):
   - **Target Resolution Hierarchy**:
     - *Exact Watts*: `230–240 W` $\rightarrow$ `power.zone` with `targetValueOne: 230`, `targetValueTwo: 240`.
     - *% FTP + Athlete FTP*: `90–95% FTP` with 260 W FTP $\rightarrow$ `targetValueOne: 234`, `targetValueTwo: 247`.
     - *Named Zone or % FTP fallback*: `Zone 2`, `Tempo`, `65–75% FTP` $\rightarrow$ native Garmin `zoneNumber: 1–7`.
     - *Other*: `no.target` with descriptive cues.
   - **Repeat Grouping (`RepeatGroupDTO`)**:
     - *Step-level repeats*: Single step repeated $N$ times with recovery.
     - *Block-level multi-step repeats* (e.g. Over-Under blocks): A block with $N$ iterations containing alternating Under (4 min) and Over (1 min) sub-intervals plus between-block recovery.
3. **Synchronization** (`src/garmin_sync/service.py`):
   - `push-pending-workouts` polls `status == 'pending'` items and pushes each to Garmin Connect via `client.upload_workout` + `client.schedule_workout`.
   - Flips Firestore document to `status: 'synced'` with `garminWorkoutId` and `syncedAt`.
