# Issue #920 Evidence Audit: Controlled Running Pace–HR Comparison

**Date:** 2026-11-13
**Issue:** #920 (`[Context Brief][Training Response] Gate controlled running pace-HR evidence`)
**Decision:** **No-Go** for live provider-only comparison; **Go** for pure, display-only fail-closed contract (`app/src/derived/training/runningPaceHrEvidence.ts`) for explicitly evidenced sessions.

## 1. Audit of Existing Evidence

### 1.1 Garmin Provider Ingestion & Persistence
- `src/garmin_sync/mapper.py` (`activity_to_firestore_dict`, `serialize_hr_measurement`) maps Garmin summaries and detail payloads to `NormalizedGarminActivity` (`app/src/ledger/models.ts`):
  - Session identity & summary: `activityId`, `date`, `startedAt`, `endedAt`, `type`, `durationMin`, `averageHr`, `maxHr`, `stimulusDomain`, `fitWorkoutFingerprint`, `fitWorkoutFingerprintKind`.
  - Laps (`ActivityLapSummary`): `lapIndex`, `durationSeconds`, `averagePowerWatts`, `averageHrBpm`, `maxHrBpm`, `distanceMeters`, `averageSpeedMps`.
  - Running dynamics (`RunningDynamics`, gated by `_is_running_activity_type`): `groundContactTimeMs`, `groundContactBalanceLeftPct`, `verticalOscillationCm`, `verticalRatioPct`, `strideLengthM`, `avgRunningPowerWatts`, `maxRunningPowerWatts`.
  - HR provenance & quality (`HrMeasurement`, derived by `src/garmin_sync/hr_fidelity.py` and `src/garmin_sync/_hr_fidelity_devices.py` `derive_hr_source_from_devices`): `externalHrSensorPresent`, `sourceForActivity`, `provenanceConfidence`, `sensorTechnology`, `activityMotionRisk`, `coveragePct`, `longestGapSeconds`, `signalQuality`, `measurementConfidence`, `summaryCompatibility`, `artifactFlags`, `reasons`, `diagnosticVersion`.
- `src/garmin_sync/activity_response.py` (`supports_activity_response`) restricts `activityResponse` derivation to `_CYCLING_TYPES`. Running activities do not receive `activityResponse` telemetry.

### 1.2 HR-Fidelity Authority (`app/src/engine/activityHrFidelity.ts`)
- `HrUseCase` (`USE_CASE_POLICY`) defines `DISPLAY_AVERAGE`, `DISPLAY_TRACE`, `ZONE_DISTRIBUTION`, `TRAINING_LOAD`, `TRAINING_EFFECT`, `AEROBIC_DECOUPLING`, `INTERVAL_RESPONSE`, `MAX_HR_UPDATE`, `THRESHOLD_HR_UPDATE`, `WORKOUT_COMPLIANCE`, and `HEALTH_ANOMALY`.
- There is no running pace–HR use case, and `getHrUseAuthority` does not require `sensorTechnology === 'electrode_chest_strap'` for running motion artifacts.

### 1.3 Structured Execution Records (`app/src/sessions/models.ts`)
- `SessionDefinition`, `SessionStep`, `SessionExecution`, and `SessionEntry` (`DurationEntryPayload`, `DistanceEntryPayload`, `SprintEntryPayload`) record authored structure and execution completion, but currently carry no controlled-venue metadata (treadmill calibration, locked incline, track verification) and no pace/distance quality provenance.

## 2. Missing Signals in Provider-Only Records

1. **Controlled venue / environment**: No treadmill calibration flag, incline lock/grade, verified standard track geometry, or outdoor route/wind/surface control. Provider `type` values (`treadmill_running`, `track_running`) are unverified device labels.
2. **Standardized executed protocol**: `fitWorkoutFingerprint` only fingerprints workout name and step indices; `laps` may be auto-laps without step-level adherence.
3. **Pace/distance quality**: `ActivityLapSummary.distanceMeters` and `averageSpeedMps` have no accuracy or calibration provenance.
4. **Running-specific HR-use authority**: No existing `HrUseCase` gates optical wrist HR vs verified chest-strap provenance for running pace–HR.

## 3. Go/No-Go Contract

- **Live provider-only comparison remains unwired**: `decideSessionComparability` (`app/src/engine/contextBriefComparability.ts`) continues to fail closed for `running_steady_pace_hr`, and no Garmin provider request or persisted payload expansion is added.
- **Explicitly evidenced fail-closed contract**: `app/src/derived/training/runningPaceHrEvidence.ts` (`evaluateControlledRunningPaceHrComparison`, `evaluateRunningPaceHrAuthority`) enforces all four gates (controlled venue, completed matching standardized protocol, verified/acceptable non-GPS pace-distance quality, and verified `electrode_chest_strap` HR authority), emits `controlled_pace_hr_response_proxy` with `confidenceCeiling: 'moderate'`, and never claims `"running economy"`.
- **Policy isolation**: The module lives under `app/src/derived/training/`, outside `app/scripts/decision-affecting-files.json`, leaving `POLICY_VERSION` unchanged.
