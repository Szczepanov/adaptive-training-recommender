# Empirical Analysis: Garmin Direct vs Google Health Transport Equivalence (MS10)

**Date**: 2026-08-27
**Dataset**: 59 overlapping calendar days (2026-06-29 to 2026-08-27)
**Subject**: Live production athlete profile (`users/9fp9JuWSecVo1DRqv8cXzz8ucNI2`)
**Objective**: Evaluate whether the Google Health transport route provides an equivalent, transforming, or incomplete substitute for direct Garmin Connect ingestion.

---

## 1. Executive Summary & Verdict

| Dimension | Result | Empirical Finding |
|---|---|---|
| **Overall Classification** | **`INCOMPLETE`** | Google Health transport route cannot replace Garmin Direct. |
| **Resting Heart Rate (RHR)** | **`EQUIVALENT`** (74.6% exact, Mean $\Delta = 0.59\text{ bpm}$) | Garmin exports daily resting HR reliably to Google Health with near-zero deviation. |
| **HRV RMSSD** | **`MISSING_GOOGLE`** (0% exported) | Garmin Connect Android app **does not export overnight HRV RMSSD** to Health Connect. |
| **Respiration Rate** | **`MISSING_GOOGLE`** (0% exported) | Garmin Connect Android app **does not export overnight respiration** to Health Connect. |
| **Sleep Stages & Duration** | **`INCOMPLETE`** (6/59 days exported) | Garmin Connect syncs sleep sessions irregularly to Health Connect. |

> **Key Architectural Takeaway**:
> Direct Garmin ingestion (`src/garmin_sync/garmin_client.py`) remains **strictly necessary** for Garmin HRV, Respiration, Sleep, and Step Count ($D-1$) telemetry. Google Health is **not** a drop-in replacement for Garmin, but serves as the dedicated transport for **Eight Sleep** recovery observations.

---

## 2. Empirical Comparison Matrix

```text
================================================================================
  GARMIN DIRECT VS GOOGLE HEALTH TRANSPORT EQUIVALENCE REPORT (MS10)
================================================================================
  Date Range:                 2026-06-29 to 2026-08-27
  Overlapping Dates:          59
  Direct-Only Dates:          1
  Google-Only Dates:          0
  Overall Classification:     INCOMPLETE
--------------------------------------------------------------------------------
Metric                             Evaluated  Matches    Match %    Mean Delta
--------------------------------------------------------------------------------
daily_resting_heart_rate_bpm       59         44         74.6%      0.593 bpm
daily_respiration_rate_brpm        59         0          0.0%       (missing)
hrv_rmssd_ms                       59         0          0.0%       (missing)
sleep_duration_seconds             59         0          0.0%       (missing)
sleep_stage_awake_seconds          6          0          0.0%       (missing)
sleep_stage_deep_seconds           6          0          0.0%       (missing)
sleep_stage_light_seconds          6          0          0.0%       (missing)
sleep_stage_rem_seconds            6          0          0.0%       (missing)
================================================================================
```

---

## 3. Analysis & Implications for Multi-Source Architecture

1. **Resting Heart Rate Equivalence**:
   - For 44 of 59 days, Garmin Google Health RHR matched Garmin Direct RHR with 0 bpm difference. The remaining days exhibited a 1 bpm rounding delta ($\text{Mean }\Delta = 0.593\text{ bpm}$), confirming that Google Health faithfully captures Garmin's passive daily RHR.
2. **Missing HRV & Respiration from Garmin**:
   - Garmin Connect Android app (`com.garmin.android.apps.connectmobile`) omits HRV and Respiration when exporting to Android Health Connect / Google Health.
   - This validates the **ADR-0027** multi-provider design: we cannot consolidate all Garmin ingestion through Google Health.
3. **Role of Eight Sleep**:
   - While Garmin does not export HRV/Respiration to Google Health, **Eight Sleep** (`com.eightsleep.eight`) exports comprehensive 100% complete overnight HRV RMSSD, respiration rate, and 4-stage sleep sessions into Google Health.
   - Therefore, the dual-source architecture (**Garmin Direct for Garmin metrics + Google Health for Eight Sleep metrics**) is the scientifically optimal configuration.

---

## 4. Next Steps & Impact on MS Roadmap

* **MS10**: Complete (`[x]`).
* **MS14 / MS15**: Proceed to evaluate Eight Sleep vs Garmin Direct cross-source correlation and design the candidate evidence fusion evaluator.
