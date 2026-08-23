# ADR-0026: Comprehensive Wearable Telemetry, Biometric Baselines, and Equipment Mileage Tracking

* **Status:** Accepted
* **Date:** 2026-08-23
* **Deciders:** Core Engineering Team

---

## Context

The system previously ingested core daily recovery metrics (sleep duration, sleep score, resting HR, HRV overnight average, respiration average, waking body battery, completed-day steps) and basic activity records. However, modern wearable ecosystems like Garmin Connect capture richer physiological signals and hardware contexts that are vital for comprehensive athletic monitoring, injury risk prevention, and accurate load prescription:

1. **Biometric Baselines & Body Composition**: Body weight ($kg/lbs$) and body fat percentage are critical for power-to-weight ($W/kg$) normalization, relative strength ratios, and metabolic load adjustments.
2. **Sleep Stage Architecture**: Nocturnal sleep stages (Deep, REM, Light, Awake durations and restlessness counts) provide essential diagnostic granularity when sleep score drops.
3. **Aerobic Benchmarks & Race Predictions**: Wearable race predictions (5k, 10k, Half-Marathon, Marathon finish times and paces) offer rolling aerobic fitness benchmarks without requiring frequent formal time trials.
4. **Running Dynamics & Biomechanical Asymmetry**: Ground Contact Time Balance ($L/R\%$), Vertical Oscillation ($cm$), Vertical Ratio ($\%$), Stride Length ($m$), and Running Power ($W$) reveal gait asymmetries that often precede lower-extremity overuse injuries.
5. **Session Training Effect, EPOC & Recovery Hours**: Aerobic and Anaerobic Training Effect ($0.0–5.0$), Primary Training Benefit descriptors, EPOC ($mL/kg$), and recovery hours quantify delivered physiological impact directly from Firstbeat algorithms.
6. **Garmin Strength Sets & Reps**: Automatic set-level synchronization (exercise categories, repetitions, weight loads, duration, rest intervals) eliminates manual gym-floor logging friction.
7. **Nocturnal SpO2 & Skin Temperature Deviation**: Blood oxygen saturation (Pulse Ox) and baseline skin temperature deviations ($^\circ\text{C}$) serve as valuable indicators for altitude acclimatization, fever detection, and physiological anomaly evaluation (ADR-0025).
8. **Shoe & Gear Mileage Tracking**: Running shoes lose midsole cushioning responsiveness after 500–800 km, leading to increased joint and tendon impact forces. Automated gear synchronization tracks cumulative mileage and enforces retirement thresholds.

---

## Decisions

### 1. Maintain Strict Vendor-Neutral Canonical Boundaries

All wearable payloads pass through the vendor-neutral `WearableProvider` protocol and canonical dataclasses in `canonical.py` before reaching repository or mapper layers:
- `CanonicalBodyComposition`
- `CanonicalSleepStages`
- `CanonicalRacePredictions`
- `CanonicalSpo2`
- `CanonicalExerciseSet`
- `CanonicalGearItem`

Vendor-specific client libraries (`garth` / `garminconnect`) are strictly isolated inside `garmin_client.py` and `garmin_provider.py`.

### 2. Separation of Concerns across Storage Models

To preserve historical snapshot integrity and prevent configuration pollution:
- **Daily Recovery Snapshots** (`users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}`):
  - Store time-bound physiological observations for date $D$: `raw.sleepStages`, `raw.spo2`, `raw.skinTempDeviationCelsius`, and `raw.recoveryHours`.
- **User Preferences & Biometric Profile** (`users/{userId}/preferences/profile`):
  - Store current athlete performance targets, race predictions, body weight/composition, and aggregated `gearTracker`.
- **Normalized Activities & Telemetry** (`users/{userId}/activities/{activityId}`):
  - Store per-session running dynamics, aerobic/anaerobic training effects, EPOC, and detailed strength `exerciseSets`.
- **Equipment Collection** (`users/{userId}/gear/{gearPk}`):
  - Store granular, queryable gear documents for shoe and bike mileage tracking.

### 3. Field-Level Ownership & Manual Protection

Garmin-derived values (e.g. body weight, cycling FTP, running LTHR) are field-level owned:
- An automated sync never overwrites a target explicitly set or edited by the athlete/coach as `manual`.
- Automated sync updates `targetSources.{targetKey} = 'garmin'` and records the measurement timestamp (`weightMeasuredAt`, `ftpMeasuredAt`).

### 4. Non-Blocking Enrichment & Failure Isolation

Ingestion of optional enrichments (gear, race predictions, body composition, activity exercise sets) is strictly non-blocking:
- A failure, timeout, or missing endpoint in an enrichment call is logged as a warning and never causes the core daily recovery snapshot or activity persistence to fail.
- Refreshed authentication tokens are safely persisted after enrichment calls.

---

## Consequences

### Positive
- Rich telemetry (sleep stages, running dynamics, strength sets, SpO2, skin temp, gear mileage) is fully accessible in the UI.
- Athlete biometrics and equipment lifespans are continuously updated without manual data entry.
- Decision reproducibility and audit replay contracts remain preserved (ADR-0010).

### Trade-offs
- Increased surface area of Garmin Connect API endpoints managed in `garmin_client.py` and `garmin_provider.py`.
- Firestore document writes per day increase when activity details and gear items are synchronized.
