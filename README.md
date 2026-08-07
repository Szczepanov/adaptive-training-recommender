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
5. **Lookback Resync**: Each daily sync also force-resyncs the preceding `GARMIN_RESYNC_LOOKBACK_DAYS` day(s) (default 1) so late-arriving Garmin data — e.g. a training session logged after that day's own sync already ran — is captured the next time sync runs.
6. **Schema Version 3 & Provenance**: Tracks exact source dates for sleep, HRV, resting HR, waking body battery, steps, and deterministic primary activity.
7. **Raw Archive & Offline Rebuild** (opt-in via `GARMIN_ARCHIVE_ENABLED`): every raw Garmin payload is archived immutably (gzip-compressed, content-addressed/idempotent) so `garmin_sync rebuild` can recompute Firestore snapshots without calling Garmin again, and `garmin_sync audit` reports completeness. Activities also get a standalone normalized record at `users/{firebaseUid}/activities/{activityId}`, decoupled from any single day's 3-day lookback window.
8. **Metric Enrichment & Auxiliary Observability**: Waking Body Battery, HRV deltas, RHR deltas, and Sleep scores are actively wired into the recommendation engine's strain scoring (`rules.ts`). Auxiliary metrics (all-day stress level, Garmin native training readiness score, VO2max) are fetched best-effort, archived, and stored on `raw`/`dataQuality` for data auditing and future engine expansions.
9. **Reconciled Strain Telemetry & Multi-Day Recovery Drift**: Decomposes objective strain into acute metric deviations (`acuteDeviation`), persistent 28d-vs-7d baseline drift (`multiDayDrift`), and contextual penalties (`recentHardSessions`, `bodyBatteryDeficit`, `sleepFloorPenalty`, `conservativeBias`). Reconciled telemetry is attached to returned recommendations, and decision-relevant multi-day baseline trends are automatically annotated in the user-facing rationale.
10. **Adaptive Multi-Sport Engine & Optimization Pipeline**: Integrates multi-layered schedule availability (`schedule.ts`), structured event periodization (`periodization.ts`), weekly microcycle objectives (`microcycle.ts`), 6D fatigue state decay tracking (`fatigue.ts`), and utility optimization (`optimizer.ts`). Solves for optimal workout placement by balancing required weekly stimulus benefit against dimensional fatigue cost.

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
| `GARMIN_RESYNC_LOOKBACK_DAYS` | No | `1` | After syncing the target date, also force-resync this many preceding day(s), to pick up Garmin data that finalized/arrived after that day's own sync ran (e.g. a training session logged later that day). Override per-run with `sync --resync-days N` |
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
uv run python scripts/bootstrap_garmin_tokens.py

# Run daily sync locally (also force-resyncs the preceding GARMIN_RESYNC_LOOKBACK_DAYS
# day(s), default 1, to pick up late-arriving Garmin data such as a training session
# logged after that day's own sync already ran)
uv run python -m garmin_sync sync

# Override the lookback window for one run, e.g. after an extended outage
uv run python -m garmin_sync sync --resync-days 3

# Run historical backfill (56 days)
uv run python -m garmin_sync backfill --days 56

# Report sync completeness over the last 90 days (requires GARMIN_ARCHIVE_ENABLED for
# the archive-related stats; snapshot/availability stats work regardless)
uv run python -m garmin_sync audit --days 90

# Recompute snapshots from the raw archive, offline (no Garmin calls) -- requires
# GARMIN_ARCHIVE_ENABLED history for the requested range
uv run python -m garmin_sync rebuild --start-date 2026-06-01 --end-date 2026-08-06
```

### 2. Frontend App Setup

```bash
cd app
npm ci

# Run pre-flight checks manually (TypeScript typecheck, ESLint, Vitest, workout catalog validation)
npm run check

# Run engine unit tests only
npm test

# Start Vite dev server (automatically runs `npm run check` first via npm `predev` hook)
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
