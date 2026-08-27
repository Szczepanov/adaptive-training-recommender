# Google Health Source-Provenance Probe Results (MS0 Analysis)

**Date**: 2026-08-27
**Timezone**: `Europe/Warsaw`
**Governing ADR**: [`ADR-0027`](../adr/0027-source-aware-multisource-health-observations.md)
**Plan Reference**: [`multisource-health-and-recovery-ingestion.md`](../plans/multisource-health-and-recovery-ingestion.md)
**Runbook**: [`docs/ops/google-health-source-provenance-probe.md`](../ops/google-health-source-provenance-probe.md)

---

## 1. Executive Summary & Core Findings

Empirical inspection against the real Google Health account (`mdszczepanski@gmail.com`) using the `probe-health` runner produced the following conclusive findings:

```text
===========================================================================
  GOOGLE HEALTH SOURCE-PROVENANCE PROBE RESULTS (2026-08-27)
===========================================================================
  Garmin Status:       PRESENT
  Eight Sleep Status:  FULL_PASS
---------------------------------------------------------------------------
Data Type                    Points   Garmin?    EightSleep?  Other Packages
---------------------------------------------------------------------------
sleep                        633      YES        YES          none
daily-heart-rate-variability 320      NO         YES          none
daily-resting-heart-rate     631      YES        YES          none
daily-respiratory-rate       287      NO         YES          none
===========================================================================
```

### Key Architectural Answers:
1. **Eight Sleep Status (`FULL_PASS`)**: Eight Sleep Android app actively exports all 4 key physiological recovery metrics to Google Health under package identity `com.eightsleep.eight`.
2. **Eight Sleep Path Decision (MS11)**: **Resolved in favor of Google Health path**. There is no need for a reverse-engineered direct API scraper for Eight Sleep (`MS18` unnecessary). Google Health provides official, structured, high-fidelity Eight Sleep recovery data.
3. **Garmin Presence**: Garmin Connect (`com.garmin.android.apps.connectmobile`) actively syncs sleep sessions (including sleep stages: deep, light, REM, awake) and daily resting heart rate to Health Connect / Google Health.
4. **Google Health REST API Data Type Standard**: Google Health REST API endpoints for daily aggregates use hyphenated type IDs:
   - `daily-heart-rate-variability`
   - `daily-resting-heart-rate`
   - `daily-respiratory-rate`
   - `sleep`
   - `weight`
5. **Account Onboarding**: First-time API access requires a one-time Google Health profile activation on the account (`https://fitbit.google.com/auth/signup`).

---

## 2. Source-Provenance Matrix

| Metric Stream | Provider | Origin Package | Payload Fields |
|---|---|---|---|
| **Sleep** | `garmin` | `com.garmin.android.apps.connectmobile` | `sleepSession`, `stages`, `summary` (`minutesAsleep`, `minutesAwake`, `stagesSummary`) |
| **Sleep** | `eight_sleep` | `com.eightsleep.eight` | `sleepSession`, `stages`, `summary` |
| **HRV (RMSSD)** | `eight_sleep` | `com.eightsleep.eight` | `dailyHeartRateVariability`, `rmssd` |
| **Resting HR** | `garmin` | `com.garmin.android.apps.connectmobile` | `dailyRestingHeartRate`, `bpm` |
| **Resting HR** | `eight_sleep` | `com.eightsleep.eight` | `dailyRestingHeartRate`, `bpm` |
| **Respiratory Rate** | `eight_sleep` | `com.eightsleep.eight` | `dailyRespiratoryRate`, `rate` |

---

## 3. Production Safety Verification

- **Storage Isolation**: Ingested observations are stored under `users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}`.
- **Engine Isolation**: Production recommendation engine remains untouched and reads from `daily_recovery_snapshots`.
- **Step Count Lock (`D-MS-STEPS` / `P9`)**: Aggregator step counts from Google Health are strictly filtered out to prevent double-counting structured workout strain.
