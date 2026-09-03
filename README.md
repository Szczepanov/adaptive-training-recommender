# Adaptive Training Recommender — Garmin Automation & Decision Engine

Production-grade Garmin Connect ingestion pipeline and adaptive training recommendation application.

## Overview & Architecture

```text
Garmin device / Wearables
    ↓ Garmin Connect sync
Garmin Connect API ──┐
    ↓                │ (Account link & Token exchange)
Cloud Scheduler      ▼
    ↓           garmin-account-link API (FastAPI)
Cloud Run Jobs
    ├── TokenStore (Encrypted garmin_tokens.json per UID in GCS)
    ├── GarminSyncService (Multi-user sync, sleep, HRV, RHR, respiration, activities)
    ├── RawArchiveStore (optional: immutable raw JSON archive in GCS, for audit/rebuild)
    ├── WorkoutExportService (Pushes pending structured workouts to Garmin Connect)
    ├── Metrics & Baselines (7d and 28d historical averages, MAD/stdev deltas)
    └── FirestoreRepository (Writes to users/{firebaseUid}/daily_recovery_snapshots/{date},
                              activities/{id}, garmin_workout_queue/{date})
            ↓
React App (DecisionComposer, SessionRunner, HealthAnomalyService)
    ↓
Adaptive Training Recommendations & Native Session Execution
```

---

## Mobile Application Showcase

<div align="center">

| Adaptive Daily Decision | 7-Day Rolling Forecast & Adaptations |
|:---:|:---:|
| <img src="docs/screenshots/mobile-daily-recommendation.png" width="360" alt="Adaptive Daily Recommendation" /> | <img src="docs/screenshots/mobile-adaptive-reduction.png" width="360" alt="Reduced Load & Adaptive Rationale" /> |
| *Direct biomarker status, load mode badge & workout recommendation* | *Auto-regulated adaptation, progressive disclosure & rationale* |

| Daily Subjective Check-in | Garmin Recovery & Biomarkers |
|:---:|:---:|
| <img src="docs/screenshots/mobile-daily-checkin.png" width="360" alt="Daily Subjective Check-in" /> | <img src="docs/screenshots/mobile-garmin-recovery.png" width="360" alt="Garmin Recovery & Biomarkers" /> |
| *Neutral defaults, typical quick-fill preset & availability settings* | *Overnight HRV, resting HR, sleep score & 7d/28d baselines* |

| Guided Session Runner | Week Architecture & Training Plan |
|:---:|:---:|
| <img src="docs/screenshots/mobile-session-runner.png" width="360" alt="Guided Session Runner" /> | <img src="docs/screenshots/mobile-plan-architecture.png" width="360" alt="Week Architecture & Training Plan" /> |
| *Real-time set logging & structured circuit execution* | *Week-level architecture, weekly critique & session rescheduling* |

| Telemetry & Power Distribution | |
|:---:|:---:|
| <img src="docs/screenshots/mobile-activity-telemetry.png" width="360" alt="Activity Telemetry & Power Distribution" /> | |
| *Power/HR zones, lap splits, and training load tracking* | |

</div>

---

## Technical Features

1. **User-Scoped Isolation**: All Firestore snapshots are saved strictly under `users/{firebaseUid}/daily_recovery_snapshots/{YYYY-MM-DD}`.
2. **Explicit Warsaw Timezone**: Uses `Europe/Warsaw` calendar dates to prevent UTC boundary shifts around midnight.
3. **Stateless Token Persistence**: Integrates `GcsTokenStore` to restore and persist Garmin OAuth token JSON files across ephemeral Cloud Run executions with strict OS file permissions.
4. **D-1 Step Count & Completed Training**: Uses previous completed day (`D - 1`) for step counts and training history lookback window.
5. **Lookback Resync**: Each daily sync also force-resyncs the preceding `GARMIN_RESYNC_LOOKBACK_DAYS` day(s) (default 1) so late-arriving Garmin data — e.g. a training session logged after that day's own sync already ran — is captured the next time sync runs.
6. **Schema Version 3 & Provenance**: Tracks exact source dates for sleep, HRV, resting HR, waking body battery, steps, respiration rate, and deterministic primary activity.
7. **Raw Archive & Offline Rebuild** (opt-in via `GARMIN_ARCHIVE_ENABLED`): every raw Garmin payload is archived immutably (gzip-compressed, content-addressed/idempotent) so `garmin_sync rebuild` can recompute Firestore snapshots without calling Garmin again, and `garmin_sync audit` reports completeness. Activities also get a standalone normalized record at `users/{firebaseUid}/activities/{activityId}`, decoupled from any single day's 3-day lookback window.
8. **Metric Enrichment & Auxiliary Observability**: Waking Body Battery, HRV deltas, RHR deltas, Sleep scores, and Respiration rate deltas/MAD are actively wired into the recommendation engine's strain scoring (`rules.ts`). Auxiliary metrics (all-day stress level, Garmin native training readiness score, VO2max) are fetched best-effort, archived, and stored on `raw`/`dataQuality` for data auditing and future engine expansions.
9. **Reconciled Strain Telemetry & Multi-Day Recovery Drift**: Decomposes objective strain into acute metric deviations (`acuteDeviation`), persistent 28d-vs-7d baseline drift (`multiDayDrift`), and contextual penalties (`recentHardSessions`, `bodyBatteryDeficit`, `sleepFloorPenalty`, `conservativeBias`). Reconciled telemetry is attached to returned recommendations, and decision-relevant multi-day baseline trends are automatically annotated in the user-facing rationale.
10. **Adaptive Multi-Sport Engine & Optimization Pipeline**: Integrates multi-layered schedule availability (`schedule.ts`), structured event periodization (`periodization.ts`), weekly microcycle objectives (`microcycle.ts`), 6D fatigue state decay tracking (`fatigue.ts`), and utility optimization (`optimizer.ts`). Solves for optimal workout placement by balancing required weekly stimulus benefit against dimensional fatigue cost.
11. **Structured Technical Workout Library**: Couples engine templates to detailed prescriptions and validates sprint mechanics, acceleration/braking, cycling pedalling economy, and manual-only outdoor handling work with explicit quality criteria and safety stop conditions.
12. **Decision Provenance, Audit Records & Replay**: Adopts explicit read semantics (`DataState`), immutable history revisions, and persisted audits. Incorporates a `POLICY_VERSION` identifier enabling a persisted decision to be replayed against its own audit payload for reproducibility.
13. **Rolling 7-Day Week-Ahead Planning**: Implements a multi-day forecast with confidence tiers and a rolling microcycle window through never-persisted recomputation, collapsing selection paths to a single training authority.
14. **Multidomain Session Authoring & Native Execution (ADR-0023)**: Source-neutral session definitions and occurrence authority (`replace_recommendation`, `additional_session`), guided gym runner with multi-scale intensity gauges (RIR, RPE, velocity loss %, technical breakdown), and automatic 1RM derivation writeback.
15. **Performance Outcome Evidence & Goal-Progress Loop (ADR-0023 D-MOBS)**: Standardized protocol-locked metric testing, noise-bounded series comparisons, and block outcome progress reports.
16. **Physiological Anomaly & Pre-Symptomatic Illness Alerting (ADR-0025)**: Evaluates unusual multi-night deviations across respiration rate, RHR, and HRV, explicitly accounting for training, sleep, stress, alcohol, and travel confounders in a fail-closed shadow mode.
17. **Multi-User Family Accounts & Self-Service Linking**: Single-project multi-tenant architecture supporting family members via self-service Garmin login with MFA, server-side identity hashing, and automated multi-user batch sync without hardcoded deployment lists.
18. **Automated Garmin Workout Push & Calendar Scheduling**: Direct structured workout export queueing from the web app (`garmin_workout_queue`) to Garmin Connect with power zone and interval repeat resolution (`workout_export.py`).
19. **First-Class Email Authentication & Wearable-Free Operation**: Native email/password sign-in, verified account creation, and enumeration-resistant password reset alongside Garmin linking. Athletes whose provider status is confirmed as disconnected can generate daily recommendations and 7-day plans from the safety check-in, revisioned training history, availability, and injury/equipment gates; missing data on a connected or unknown account still fails closed.

---

## Training Settings and Recommendation Safety

The app stores athlete-controlled training settings in the user-scoped Firestore document
`users/{firebaseUid}/trainingSettings/profile` (schema version 3). The settings model is
intentionally divided into concepts so the recommendation engine never mistakes an
available resource for a safety restriction:

| Group | Examples | Engine behavior |
|---|---|---|
| Equipment | Pull-up bar, treadmill, free weights | A capability gate: a session requiring unavailable equipment is excluded. |
| Safety limits | Block high impact, heavy lower-body work, overhead pressing, spinal loading | A hard gate: matching templates are excluded from every recommendation and dose adjustment. |
| Injuries | Knee, achilles, ankle, hamstring, back, shoulder | A structured safety gate deriving guardrails, restricted modalities, and categories via `injuryPolicy.ts`. |
| Time and location | Weekday/weekend duration limit, indoor-only/outdoor-only | A hard feasibility gate evaluated together with today's check-in availability. |
| Preferences | Prefer active recovery | A soft ranking signal only; it cannot bypass a hard gate. |

The engine uses a single eligibility resolver before it ranks templates. If no training
template remains feasible, it returns the safe rest fallback with an explicit rationale.
The same resolver is applied to the initial recommendation and the `Harder`/`Easier`
adjustment flow.

### Settings data migration

Older data in `users/{firebaseUid}/constraints/*` is read only once, when a v2 training
settings profile does not exist. The migration is conservative: it copies unambiguous time
and recovery-preference settings, but does **not** infer equipment access or injury limits
from old boolean records because the prior UI and engine read different fields. Migrated
profiles therefore require an athlete review before those settings are relied upon. Legacy
constraint records are not modified or deleted by the client.

### Adding a setting

Do not add a UI control until all of the following exist in the same change:

1. A typed field in `TrainingSettings`.
2. A documented policy effect: capability gate, hard guardrail, or soft preference.
3. Template/exercise metadata that lets the engine enforce the effect.
4. Resolver and adjustment-path coverage.
5. Unit tests proving the setting cannot be silently ignored.

Training settings are general wellness controls, not medical diagnosis or treatment.
Athletes reporting current pain or illness should use the daily check-in and seek appropriate
professional advice when symptoms persist.

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
| `GARMIN_TOKEN_OBJECT` | No | `garmin/garmin_tokens.json` | GCS token object name |
| `GARMIN_STALENESS_MINUTES` | No | `60` | Skip Garmin API fetch if snapshot updated within N mins |
| `GARMIN_INCOMPLETE_STALENESS_MINUTES` | No | `5` | Retry window for incomplete daily snapshots |
| `GARMIN_RESYNC_LOOKBACK_DAYS` | No | `1` | After syncing the target date, also force-resync this many preceding day(s), to pick up Garmin data that finalized/arrived after that day's own sync ran (e.g. a training session logged later that day). Override per-run with `sync --resync-days N` |
| `GARMIN_ALLOW_CREDENTIAL_LOGIN` | No | `false` | Cloud/automated runs set `false` (token-only); bootstrap sets `true` |
| `FIREBASE_CREDENTIALS_PATH` | Local only | — | Path to local Firebase service account JSON |
| `GARMIN_ARCHIVE_ENABLED` | No | `false` | Opt-in: archive raw Garmin JSON immutably for audit/rebuild |
| `GARMIN_ARCHIVE_STORE` | No | `gcs` | Archive backend (`local` or `gcs`) |
| `GARMIN_ARCHIVE_BUCKET` | For GCS | — | Private GCS bucket for raw archive; falls back to `GARMIN_TOKEN_BUCKET` |
| `GARMIN_ARCHIVE_PREFIX` | No | `raw/garmin` | GCS/local object prefix for archived payloads |
| `GARMIN_ACTIVITY_DETAIL_ENABLED` | No | `false` | Opt-in live ingestion of power/HR zones and lap summaries for non-easy power-bearing activities, target-date `sync_daily` pass only; never used by lookback resync, backfill, or rebuild |

---

## Local Development & Setup

### Quickstart (Makefile)

```bash
# Run all code checks, test suites, simulations, and build
make all

# Run validation checks across Python and TypeScript codebases
make check

# Run all unit tests
make test

# Format code automatically
make format

# Build and deploy frontend to Firebase production
make deploy

# View all available targets
make help
```

### 1. Python Backend Setup

```bash
# Sync dependencies
uv sync

# Run pytest test suite
uv run pytest

# Generate backend coverage (terminal summary + XML artifact)
uv run pytest --cov=garmin_sync --cov-report=term-missing --cov-report=xml:artifacts/coverage/python/coverage.xml

# Authenticate Garmin account locally
uv run python scripts/bootstrap_garmin_tokens.py

# Run daily sync locally (also force-resyncs the preceding GARMIN_RESYNC_LOOKBACK_DAYS
# day(s), default 1, to pick up late-arriving Garmin data such as a training session
# logged after that day's own sync already ran)
uv run python -m garmin_sync sync

# Run daily sync for all linked active users in Firestore
uv run python -m garmin_sync sync-all

# Push queued structured workouts to Garmin Connect
uv run python -m garmin_sync push-pending-workouts

# Poll and process manual Sync Now requests
uv run python -m garmin_sync poll-manual-sync

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

# Run multi-week engine simulation suite (outputs reports to app/artifacts/simulation-reports/latest/)
npm run simulate:scenarios

# Run health anomaly replay evidence report
npm run evidence:health-anomaly -- --input path/to/replay.json

# Replay and audit historical recommendation reproducibility
npm run replay:recommendation -- <path-to-recommendation-audit.json>

# Generate visual review screenshot bundle (requires npm run visual:install once)
npm run visual:refresh

# Run Firestore security rules unit tests in local Firebase emulator
npm run test:rules
```

---

## Cloud Deployment Guide

### 1. Build & Push Docker Image

```bash
docker build -t gcr.io/YOUR_GCP_PROJECT/garmin-sync:latest .
docker push gcr.io/YOUR_GCP_PROJECT/garmin-sync:latest
```

### 2. Cloud Run Configuration

Create a Cloud Run Job executing `python -m garmin_sync sync-all` (and refer to `docs/ops/cloud-run-deployment.md` for deploying the multi-user linking API and the other scheduled jobs):
* Tasks: 1
* Service Account: Minimum Firestore Write + GCS Token/Archive Object Read/Write permissions
* Environment variables:
  * `APP_TIMEZONE`: `Europe/Warsaw`
  * `GARMIN_TOKEN_STORE`: `gcs`
  * `GARMIN_TOKEN_BUCKET`: `<YOUR_PRIVATE_TOKEN_BUCKET>`
  * `GARMIN_ALLOW_CREDENTIAL_LOGIN`: `false` (token-only; Cloud Run can't complete interactive MFA)
  * Optional: `GARMIN_ARCHIVE_ENABLED`: `true`, `GARMIN_ARCHIVE_STORE`: `gcs` (reuses `GARMIN_TOKEN_BUCKET` unless `GARMIN_ARCHIVE_BUCKET` is set)
* Secret Manager injections for `GARMIN_EMAIL` and `GARMIN_PASSWORD` (used only for the local/interactive bootstrap flow, not required by the Cloud Run job itself when token-only).

### 3. Cloud Scheduler Setup

Use the repository-owned runbook in `docs/ops/cloud-run-deployment.md` for the scheduler and IAM commands. The recovery sync uses a morning polling window rather than a single fixed run:
* Schedule: `*/15 5-9 * * *`
* Timezone: `Europe/Warsaw`
* Do **not** pass `--force`; `GARMIN_STALENESS_MINUTES` lets most ticks stop after the Firestore freshness check without calling Garmin.
