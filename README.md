# Adaptive Training Recommender — Garmin Automation & Decision Engine

Production-grade Garmin Connect ingestion pipeline and adaptive training recommendation application.

## Overview & Architecture

```text
Garmin device
    ↓ Garmin Connect sync
Garmin Connect API
    ↓
Cloud Scheduler (06:15 Europe/Warsaw)
    ↓
Cloud Run Job
    ├── TokenStore (Downloads/Uploads encrypted garmin_tokens.json from/to GCS)
    ├── GarminSyncService (Fetches stats, sleep, HRV, activities)
    ├── RawArchiveStore (optional: immutable raw JSON archive in GCS, for audit/rebuild)
    ├── Metrics & Baselines (7-day and 28-day historical averages & deltas)
    └── FirestoreRepository (Writes to users/{firebaseUid}/daily_recovery_snapshots/{YYYY-MM-DD}
                              and users/{firebaseUid}/activities/{activityId})
            ↓
React App (DecisionComposer)
    ↓
Adaptive Training Recommendation
```

---

## Technical Features

1. **User-Scoped Isolation**: All Firestore snapshots are saved strictly under `users/{firebaseUid}/daily_recovery_snapshots/{YYYY-MM-DD}`.
2. **Explicit Warsaw Timezone**: Uses `Europe/Warsaw` calendar dates to prevent UTC boundary shifts around midnight.
3. **Stateless Token Persistence**: Integrates `GcsTokenStore` to restore and persist Garmin OAuth token JSON file across ephemeral Cloud Run executions with strict OS file permissions.
4. **D-1 Step Count & Completed Training**: Uses previous completed day (`D - 1`) for step counts and training history lookback window.
5. **Schema Version 3 & Provenance**: Tracks exact source dates for sleep, HRV, resting HR, waking body battery, steps, and deterministic primary activity.
6. **Graceful Migration Utility**: Includes `scripts/migrate_legacy_snapshots.py` to copy legacy root documents to user-scoped Firestore paths.
7. **Raw Archive & Offline Rebuild** (opt-in via `GARMIN_ARCHIVE_ENABLED`): every raw Garmin payload is archived immutably (gzip-compressed, content-addressed/idempotent) so `garmin_sync rebuild` can recompute Firestore snapshots without calling Garmin again, and `garmin_sync audit` reports completeness. Activities also get a standalone normalized record at `users/{firebaseUid}/activities/{activityId}`, decoupled from any single day's 3-day lookback window.
8. **Metric Enrichment (recorded, not yet acted on)**: stress, Body Battery charge/drain, training readiness, and training status (incl. VO2max) are fetched best-effort, archived, and stored on `raw`/`dataQuality` alongside their own availability flags. Intentionally not wired into the recommendation engine yet — the plan is to observe real availability for a few weeks first.

---

## Configuration Reference

Set the following environment variables (e.g. in `.env` locally or Secret Manager / Cloud Run):

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_USER_ID` | **Yes** | — | Target Firebase Auth UID (Must NOT be `"default_user"`) |
| `APP_TIMEZONE` | No | `Europe/Warsaw` | Application logical timezone |
| `GARMIN_EMAIL` | Optional | — | Garmin Connect login email (used for interactive bootstrap) |
| `GARMIN_PASSWORD` | Optional | — | Garmin Connect login password |
| `GARMIN_TOKEN_PATH` | No | `.garmin_tokens/garmin_tokens.json` | Path to local single token JSON file |
| `GARMIN_TOKEN_STORE` | No | `local` | Token store backend (`local` or `gcs`) |
| `GARMIN_TOKEN_BUCKET` | For GCS | — | Private GCS bucket name storing Garmin token JSON |
| `GARMIN_TOKEN_OBJECT` | For GCS | `garmin/garmin_tokens.json` | GCS token object name |
| `GARMIN_STALENESS_MINUTES` | No | `60` | Skip Garmin API fetch if snapshot updated within N mins |
| `GARMIN_ALLOW_CREDENTIAL_LOGIN` | No | `false` | Cloud/automated runs set `false` (token-only); bootstrap sets `true` |
| `FIREBASE_CREDENTIALS_PATH` | Local only | — | Path to local Firebase service account JSON |
| `GARMIN_ARCHIVE_ENABLED` | No | `false` | Opt-in: archive raw Garmin JSON immutably for audit/rebuild |
| `GARMIN_ARCHIVE_STORE` | No | `gcs` | Archive backend (`local` or `gcs`) |
| `GARMIN_ARCHIVE_BUCKET` | For GCS | — | Private GCS bucket for raw archive; falls back to `GARMIN_TOKEN_BUCKET` |
| `GARMIN_ARCHIVE_PREFIX` | No | `raw/garmin` | GCS/local object prefix for archived payloads |

---

## Local Development & Setup

### 1. Python Backend Setup

```bash
# Sync dependencies
uv sync

# Run pytest test suite
uv run pytest

# Authenticate Garmin account locally
uv run python garmin_login.py

# Run daily sync locally
uv run python -m garmin_sync sync

# Run historical backfill (56 days)
uv run python -m garmin_sync backfill --days 56

# Report sync completeness over the last 90 days (requires GARMIN_ARCHIVE_ENABLED for
# the archive-related stats; snapshot/availability stats work regardless)
uv run python -m garmin_sync audit --days 90

# Recompute snapshots from the raw archive, offline (no Garmin calls) -- requires
# GARMIN_ARCHIVE_ENABLED history for the requested range
uv run python -m garmin_sync rebuild --start-date 2026-06-01 --end-date 2026-08-06
```

### 2. Migration Tool Usage

To migrate existing legacy records from `daily_recovery_snapshot/{date}` to `users/{UID}/daily_recovery_snapshots/{date}`:

```bash
# Dry run check (safe)
uv run python scripts/migrate_legacy_snapshots.py --user-id YOUR_FIREBASE_UID --dry-run

# Perform actual migration
uv run python scripts/migrate_legacy_snapshots.py --user-id YOUR_FIREBASE_UID --no-dry-run
```

### 3. Frontend App Setup

```bash
cd app
npm ci
npm run dev
```

---

## Cloud Deployment Guide

### 1. Build & Push Docker Image

```bash
docker build -t gcr.io/YOUR_GCP_PROJECT/garmin-sync:latest .
docker push gcr.io/YOUR_GCP_PROJECT/garmin-sync:latest
```

### 2. Cloud Run Job Configuration

Create a Cloud Run Job executing `python -m garmin_sync sync`:
* Tasks: 1
* Service Account: Minimum Firestore Write + GCS Token/Archive Object Read/Write permissions
* Environment variables:
  * `APP_USER_ID`: `<YOUR_FIREBASE_UID>`
  * `APP_TIMEZONE`: `Europe/Warsaw`
  * `GARMIN_TOKEN_STORE`: `gcs`
  * `GARMIN_TOKEN_BUCKET`: `<YOUR_PRIVATE_TOKEN_BUCKET>`
  * `GARMIN_TOKEN_OBJECT`: `garmin/garmin_tokens.json`
  * `GARMIN_ALLOW_CREDENTIAL_LOGIN`: `false` (token-only; Cloud Run can't complete interactive MFA)
  * Optional: `GARMIN_ARCHIVE_ENABLED`: `true`, `GARMIN_ARCHIVE_STORE`: `gcs` (reuses `GARMIN_TOKEN_BUCKET` unless `GARMIN_ARCHIVE_BUCKET` is set)
* Secret Manager injections for `GARMIN_EMAIL` and `GARMIN_PASSWORD` (used only for the local/interactive bootstrap flow, not required by the Cloud Run job itself when token-only).

### 3. Cloud Scheduler Setup

Create a Cloud Scheduler job triggering the Cloud Run Job:
* Schedule: `06:15`
* Timezone: `Europe/Warsaw`
