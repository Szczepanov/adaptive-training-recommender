# Ingestion Pipeline & Wearable Telemetry Architecture

The Python backend (`src/garmin_sync/`) and frontend coordination services handle automated daily ingestion, historical backfilling, raw data archiving, baseline metric calculation, Firestore persistence, and bi-directional Garmin Connect synchronization.

---

## 🏗️ Core Components

```text
Garmin Connect API (Cloud Endpoints)
  ├── Health Stats & Sleep (get_user_summary, get_sleep_data)
  ├── Biometrics & SpO2 (get_body_composition, get_spo2_data, get_skin_temp_data)
  ├── Performance & Races (get_training_status, get_race_predictions)
  ├── Activities & Telemetry (get_activities, get_activity_details, get_activity_exercise_sets)
  └── Equipment / Gear (get_gear)
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  GarminConnectClient / GarminClientWrapper                  │ (Authenticated Garth wrapper with backoff)
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  GarminProviderAdapter (WearableProvider Protocol)          │ (Vendor-neutral extraction & canonicalization)
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  GarminSyncService (Sync & Backfill Orchestrator)           │
└──────┬───────────────────────┬──────────────────────────────┘
       │                       │
       ▼                       ▼
┌──────────────────────────┐  ┌───────────────────────────────────────────────────────────┐
│  RawArchiveStore         │  │  FirestoreRepository (User-Scoped Firestore Documents)    │
│  (GCS / Local gzip)      │  │                                                           │
│  Immutable ADR-0005      │  │  ├── users/{uid}/daily_recovery_snapshots/{YYYY-MM-DD}    │
└──────────────────────────┘  │  ├── users/{uid}/activities/{activityId}                  │
                              │  ├── users/{uid}/preferences/profile                      │
                              │  ├── users/{uid}/gear/{gearPk}                            │
                              │  └── users/{uid}/garmin_workout_queue/{date}              │
                              └───────────────────────────────────────────────────────────┘
```

---

## 📁 Source Code Organization

* [`src/garmin_sync/config.py`](../../src/garmin_sync/config.py) — Typed configuration dataclass (`Settings`) validating environment variables (`APP_USER_ID`, `APP_TIMEZONE`, `GARMIN_STALENESS_MINUTES`).
* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — Date provider strictly bound to `Europe/Warsaw` timezone logic (`local_today`, `get_date_string`).
* [`src/garmin_sync/garmin_client.py`](../../src/garmin_sync/garmin_client.py) — Garmin API wrapper fetching daily stats, sleep stages, HRV balance, body battery, body composition, SpO2, skin temp, race predictions, activity details, exercise sets, and gear.
* [`src/garmin_sync/canonical.py`](../../src/garmin_sync/canonical.py) — Vendor-neutral domain models (`CanonicalDailyMetrics`, `CanonicalSleepStages`, `CanonicalSpo2`, `CanonicalActivity`, `CanonicalExerciseSet`, `CanonicalPerformanceTargets`, `CanonicalGearItem`).
* [`src/garmin_sync/provider.py`](../../src/garmin_sync/provider.py) — `WearableProvider` protocol declaring capabilities and fetch contracts.
* [`src/garmin_sync/garmin_provider.py`](../../src/garmin_sync/garmin_provider.py) — Garmin adapter converting raw API payloads into canonical models.
* [`src/garmin_sync/metrics.py`](../../src/garmin_sync/metrics.py) — Pure baseline mathematical transformations computing 7-day and 28-day moving averages, medians, MADs, deltas, and standard deviations.
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — Schema Version 3 payload builder mapping canonical data into Firestore recovery snapshots and activities.
* [`src/garmin_sync/firestore_repository.py`](../../src/garmin_sync/firestore_repository.py) — User-scoped Firestore CRUD operations (`users/{userId}/...`).
* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — Synchronization and historical backfill orchestrator.
* [`src/garmin_sync/workout_export.py`](../../src/garmin_sync/workout_export.py) — Structured FIT/JSON workout transformation and Garmin Connect upload/scheduling.

---

## 📊 Ingested Telemetry Subsystems

### 1. Daily Recovery Snapshots (`daily_recovery_snapshots/{YYYY-MM-DD}`)
* **Core Baselines**: Resting HR (bpm), HRV overnight avg (ms), HRV status, Sleep score, Sleep duration (min), Respiration avg (br/min), Waking Body Battery (0–100), Completed previous-day ($D-1$) step total.
* **Sleep Stage Architecture** (`raw.sleepStages`):
  * Deep sleep duration, REM sleep duration, Light sleep duration, Awake duration (seconds).
  * Restless moments count.
  * Rendered as an interactive visual breakdown bar in `DataView.tsx`.
* **Overnight SpO2 & Skin Temperature Deviation** (`raw.spo2`, `raw.skinTempDeviationCelsius`):
  * Nocturnal blood oxygen saturation (Pulse Ox daily average %, minimum %, sleep average %).
  * Nocturnal skin temperature baseline deviation ($^\circ\text{C}$).
  * Rendered in `DataView.tsx` and as comparative context pills in `DailyCheckin.tsx`.
* **Daily Recovery Time** (`raw.recoveryHours`):
  * Remaining Garmin Firstbeat recovery hours at morning wake.

### 2. Biometric Baselines & Performance Profile (`preferences/profile`)
* **Body Composition**: Athlete weight ($kg/lbs$), body fat percentage, and weigh-in timestamp (`weightMeasuredAt`). Used for power-to-weight ($W/kg$) and relative strength ratios.
* **Sport Performance Targets**: Cycling FTP (W), Running Lactate Threshold Heart Rate (bpm), and Running Threshold Pace ($sec/km$).
* **Race Predictions** (`garmin.racePredictions`):
  * Predicted finish times and equivalent paces for 5k, 10k, Half-Marathon, and Marathon distances.
  * Formatted in athlete's preferred units ($min/km$ or $min/mi$) in `Preferences.tsx`.
* **Field-Level Ownership Guard**: Automated sync updates targets only with `targetSources.{key} = 'garmin'`. Manual coach/athlete inputs (`manual`) are never overwritten.

### 3. Activity Telemetry & Biomechanics (`activities/{activityId}`)
* **Training Effect & EPOC**:
  * Aerobic Training Effect ($0.0–5.0$) & Anaerobic Training Effect ($0.0–5.0$).
  * Primary Training Benefit descriptor (e.g. *VO2 Max*, *Threshold*, *Tempo*, *Base*, *Recovery*).
  * EPOC ($mL/kg$) and post-session recovery hours.
* **Running Dynamics & Gait Asymmetry**:
  * Ground Contact Time Balance (Left % vs Right %). Asymmetry alerts triggered when $|L - R| > 1.5\%$.
  * Vertical Oscillation ($cm$) and Vertical Ratio ($\%$).
  * Stride Length ($m$) and Average Running Power ($W$).
* **Garmin Strength Sets & Reps Auto-Sync** (`exerciseSets`):
  * Automatic ingestion of individual strength sets via `get_activity_exercise_sets`.
  * Parsed into structured set records: exercise name, exercise category, set type (*active*, *warmup*, *rest*), repetitions count, weight load ($kg/lbs$), set duration, and rest duration.
  * Rendered in a formatted exercise table in `ActivityTelemetry.tsx`.

### 4. Shoe & Equipment Mileage Tracking (`gear/{gearPk}`)
* Ingests athlete shoes, bikes, and hardware components via `get_gear`.
* Persisted to individual Firestore documents `users/{userId}/gear/{gearPk}` and summarized in `preferences/profile.gearTracker`.
* Tracks total logged distance against manufacturer maximum thresholds ($km/mi$).
* Visual wear percentage progress bars and status badges (*active*, *retired*) displayed in `Preferences.tsx`.

---

## 🔄 Client-Side Auto-Sync & Staleness Orchestration

To maintain fresh data without manual user intervention:
* [`app/src/hooks/useAutoGarminSync.ts`](../../app/src/hooks/useAutoGarminSync.ts) monitors client-side visibility changes and snapshot timestamps.
* When a snapshot is stale ($>60$ minutes old) or missing, it automatically creates a sync request in `users/{userId}/garmin_sync_requests/{reqId}`.
* Cloud functions or backend daemons poll and fulfill sync requests, updating the user's Firestore collections with fresh Garmin data.

---

## 🚴 Workout Export & Garmin Connect Scheduling

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
