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

* [`src/garmin_sync/config.py`](../../src/garmin_sync/config.py) — Typed Pydantic configuration (`Settings`) validating environment variables (`APP_USER_ID`, `APP_TIMEZONE`, `GARMIN_STALENESS_MINUTES`).
* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — Date provider strictly bound to `Europe/Warsaw` timezone logic.
* [`src/garmin_sync/garmin_client.py`](../../src/garmin_sync/garmin_client.py) — Low-level Garth client wrapper fetching daily stats, sleep JSON, HRV balance, body battery, and activity histories.
* [`src/garmin_sync/token_store.py`](../../src/garmin_sync/token_store.py) — Token persistence abstraction supporting local file and Google Cloud Storage (GCS) object stores.
* [`src/garmin_sync/metrics.py`](../../src/garmin_sync/metrics.py) — Baseline mathematical transformations computing 7-day and 28-day moving averages, deltas, and standard deviations.
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — Schema Version 3 payload builder attaching field provenance dates (`metricsDates`).
* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — User-scoped Firestore CRUD operations (`users/{userId}/daily_recovery_snapshots/{date}`).
* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — Entry point service orchestrating synchronization workflows.

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
6. **Activity Normalization**: Saves raw activity records to `users/{userId}/activities/{activityId}` for cross-day auditability.
